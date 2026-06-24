import type { NextApiRequest } from "next";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse, toIncomingHeaders } from "@/lib/abuseLog";
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
import { revalidateQueenPages } from "@/lib/queensRevalidate";
import { getSessionUser } from "@/lib/sessionUser";
import type { CachedUserDrodoRow } from "@/lib/drodo";
import {
  isCachedQueenProfile,
  loadCachedDrodoRow,
  readThroughDrodoProfile,
} from "@/lib/drodoReadThrough";

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
  // cooldown. Queen profiles use that same priority bucket even when viewed by
  // someone else, while normal cross-profile refreshes are daily per profile.
  // Admins bypass the quota.
  let refreshQuota: ManualRefreshQuota | undefined;
  let forceSteamProfileRefresh = false;
  if (forceRefresh) {
    const session = await getSessionUser(reqShim, supabase);
    const isOwnProfile = session.steamId === steamId;
    const isAdmin = isAdminSteamId(session.steamId);
    forceSteamProfileRefresh = isAdmin;
    let cachedProfileRow: CachedUserDrodoRow | null = null;
    if (supabase && !isOwnProfile) {
      cachedProfileRow = await loadCachedDrodoRow(supabase, steamId);
    }
    const refreshCadence: ManualRefreshCadence =
      isOwnProfile || isCachedQueenProfile(cachedProfileRow)
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

  const result = await readThroughDrodoProfile({
    steamId,
    supabase,
    forceRefresh,
    snapshotOnSuccess: true,
    onQueenChange: revalidateQueenPages,
  });
  const steamProfile = forceRefresh
    ? await fetchSteamProfile(steamId, supabase ?? undefined, {
        force: forceSteamProfileRefresh,
      })
    : null;

  if (result.kind === "profile") {
    if (forceRefresh) {
      revalidatePlayerProfilePaths(steamId, steamProfile?.customUrl);
    }
    return Response.json(
      {
        ...result.payload,
        ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
      },
      { status: 200, headers: responseHeaders }
    );
  }

  if (result.kind === "missing") {
    if (forceRefresh) {
      revalidatePlayerProfilePaths(steamId, steamProfile?.customUrl);
    }
    return Response.json(
      {
        error: result.error,
        fetched_at: result.fetched_at,
        ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
      },
      { status: 404, headers: responseHeaders }
    );
  }

  if (result.kind === "refresh_in_progress") {
    return Response.json(
      {
        error: "Refresh already in progress.",
        refresh_pending: true,
        ...(result.stale ?? {}),
        ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
      },
      { status: result.stale ? 200 : 202, headers: responseHeaders }
    );
  }

  return Response.json(
    {
      error: result.error,
      ...(result.status ? { status: result.status } : {}),
      ...(result.stale ? { ...result.stale } : {}),
      ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
    },
    { status: result.stale ? 200 : 502, headers: responseHeaders }
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
