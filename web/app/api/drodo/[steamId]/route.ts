import type { NextApiRequest } from "next";
import { revalidatePath } from "next/cache";
import type { IncomingHttpHeaders } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse } from "@/lib/abuseLog";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import {
  fetchSteamProfile,
  playerProfilePath,
  resolveSteamInput,
} from "@/lib/steam";
import {
  consumeManualRefreshQuota,
  type ManualRefreshCadence,
  type ManualRefreshQuota,
} from "@/lib/manualRefreshQuota";
import { isAdminSteamId } from "@/lib/admin";
import { getSessionUser } from "@/lib/sessionUser";
import {
  cachedUserToDrodoProfile,
  EMPTY_DRODO_PROFILE_ERROR,
  fetchAndCacheDrodo,
  hasDrodoStats,
  isFreshCache,
  purgeDrodoCache,
  USER_DRODO_SELECT,
  type CachedUserDrodoRow,
} from "@/lib/drodo";

// --- Bot / rate-limit protection ---

const BOT_UA_RE =
  /bot|crawl|spider|slurp|python|curl|wget|java|scrapy|httpclient|go-http|okhttp|libwww|axios|node-fetch/i;

// Caps how often a single IP can hit this route. Drodo upstream is the
// upstream cost: even cache hits surface here, but cache misses sweep
// through fetchAndCacheDrodo. 60/min is generous for normal browsing
// and cuts off scrape patterns before they reach the upstream.
const ipRateLimiter = new RateLimiterMemory({ points: 60, duration: 60 });

function revalidatePlayerProfilePaths(
  steamId: string,
  customUrl?: string | null
) {
  revalidatePath(playerProfilePath(steamId));
  if (customUrl) {
    revalidatePath(playerProfilePath(steamId, customUrl));
  }
}

// Web `Request` headers expose a `Headers` instance; the shared abuse/session
// helpers expect Node-style `IncomingHttpHeaders`. Build the plain map once and
// hand the helpers a NextApiRequest-shaped shim so their logic is unchanged.
function toIncomingHeaders(req: Request): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

async function handle(req: Request, ctx: { params: Promise<{ steamId: string }> }) {
  const path = "/api/drodo/[steamId]";
  const nodeHeaders = toIncomingHeaders(req);
  const reqShim = { headers: nodeHeaders } as unknown as NextApiRequest;
  const ip = getClientIp(reqShim);
  const ua = getUserAgent(reqShim);

  const botCheck = await checkBotId({ advancedOptions: { headers: nodeHeaders } });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    logAbuse("bot_blocked", { path, ip, ua });
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await ipRateLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip, ua });
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, POST" } }
    );
  }

  const { steamId: rawSteamId } = await ctx.params;
  const refresh = new URL(req.url).searchParams.get("refresh");
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return Response.json({ error: "Invalid steam ID" }, { status: 400 });
  }

  // Reject obvious automation on forced-refresh calls.
  if (refresh === "1") {
    if (BOT_UA_RE.test(ua)) {
      logAbuse("bot_blocked", { path, ip, ua, steam_id: rawSteamId, reason: "ua_pattern_on_refresh" });
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const supabase: SupabaseClient | null = createSupabaseServiceRoleClient();

  const steamId = await resolveSteamInput(rawSteamId, supabase ?? undefined, {
    persist: false,
  });
  if (!steamId) {
    return Response.json({ error: "Invalid steam ID" }, { status: 400 });
  }

  const forceRefresh = refresh === "1" && req.method === "POST";

  // Response headers accumulated alongside the JSON body (Set-Cookie / Retry-After).
  const responseHeaders: Record<string, string> = {};

  // Manual refreshes are allowed for everyone: signed-in owners get a shorter
  // cooldown, while anonymous and cross-profile refreshes are daily per profile.
  // Admins bypass the quota.
  let refreshQuota: ManualRefreshQuota | undefined;
  if (forceRefresh) {
    const session = await getSessionUser(reqShim, supabase);
    const isOwnProfile = session.steamId === steamId;
    const isAdmin = isAdminSteamId(session.steamId);
    const refreshCadence: ManualRefreshCadence = isOwnProfile
      ? "owner"
      : "public";

    if (!isAdmin) {
      const nowMs = Date.now();
      const quotaResult = consumeManualRefreshQuota(nodeHeaders.cookie, nowMs, {
        cadence: refreshCadence,
        target: steamId,
      });
      refreshQuota = quotaResult.quota;
      responseHeaders["Set-Cookie"] = quotaResult.cookie;
      if (!quotaResult.allowed) {
        logAbuse("manual_refresh_quota_exceeded", {
          path,
          ip,
          ua,
          steam_id: steamId,
          reason: refreshCadence,
        });
        responseHeaders["Retry-After"] = Math.max(
          1,
          Math.ceil(
            (new Date(refreshQuota.reset_at).getTime() - nowMs) / 1000
          )
        ).toString();
        return Response.json(
          {
            error:
              refreshCadence === "owner"
                ? "Refresh is temporarily unavailable. Try again later."
                : "This profile has already been refreshed today.",
            refresh_quota: refreshQuota,
          },
          { status: 429, headers: responseHeaders }
        );
      }
    }
  }

  // Check cache unless an authorised manual refresh is in flight.
  if (supabase && !forceRefresh) {
    const { data: cached } = await supabase
      .from("users")
      .select(USER_DRODO_SELECT)
      .filter("steam_id", "eq", steamId)
      .maybeSingle<CachedUserDrodoRow>();

    if (
      cached?.drodo_profile_missing &&
      isFreshCache(cached.drodo_last_fetched_at, true)
    ) {
      return Response.json(
        {
          error: EMPTY_DRODO_PROFILE_ERROR,
          fetched_at: cached.drodo_last_fetched_at,
        },
        { status: 404, headers: responseHeaders }
      );
    }

    if (cached && isFreshCache(cached.drodo_last_fetched_at, false)) {
      const cachedProfile = cachedUserToDrodoProfile(cached);
      const { data: seasons } = await supabase
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played, chicken_count")
        .filter("steam_id", "eq", steamId)
        .order("season", { ascending: true });

      if (hasDrodoStats(cachedProfile, seasons ?? [])) {
        return Response.json(
          { ...cachedProfile, seasons: seasons ?? [] },
          { status: 200, headers: responseHeaders }
        );
      }

      await purgeDrodoCache(steamId, supabase);
    }
  }

  const result = await fetchAndCacheDrodo(steamId, supabase, {
    snapshotOnSuccess: forceRefresh,
  });

  if (!result.ok) {
    if (result.kind === "missing") {
      if (forceRefresh) {
        revalidatePlayerProfilePaths(steamId);
      }
      return Response.json(
        {
          error: result.error,
          fetched_at: result.fetchedAt,
          ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
        },
        { status: 404, headers: responseHeaders }
      );
    }
    return Response.json(
      {
        error: result.error,
        ...(result.status ? { status: result.status } : {}),
        ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
      },
      { status: 502, headers: responseHeaders }
    );
  }

  const steamProfile = await fetchSteamProfile(steamId, supabase ?? undefined);
  if (forceRefresh) {
    revalidatePlayerProfilePaths(steamId, steamProfile.customUrl);
  }

  if (!supabase) {
    return Response.json(
      {
        ...result.profile,
        seasons: result.seasonRows,
        ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
      },
      { status: 200, headers: responseHeaders }
    );
  }

  // Re-read season history so the response reflects merged historical rows.
  const { data: seasons } = await supabase
    .from("player_seasons")
    .select("season, mmr, max_mmr, games_played, chicken_count")
    .filter("steam_id", "eq", steamId)
    .order("season", { ascending: true });

  return Response.json(
    {
      ...result.profile,
      seasons: seasons ?? [],
      ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
    },
    { status: 200, headers: responseHeaders }
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ steamId: string }> }
) {
  return handle(req, ctx);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ steamId: string }> }
) {
  return handle(req, ctx);
}
