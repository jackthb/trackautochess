import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse } from "@/lib/abuseLog";
import { fetchSteamProfile, resolveSteamInput } from "../../../lib/steam";
import {
  consumeManualRefreshQuota,
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const path = "/api/drodo/[steamId]";
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  const botCheck = await checkBotId({ advancedOptions: { headers: req.headers } });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    logAbuse("bot_blocked", { path, ip, ua });
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    await ipRateLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip, ua });
    return res.status(429).json({ error: "Too many requests" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { steamId: rawSteamId, refresh } = req.query;
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return res.status(400).json({ error: "Invalid steam ID" });
  }

  // Reject obvious automation on forced-refresh calls.
  if (refresh === "1") {
    if (BOT_UA_RE.test(ua)) {
      logAbuse("bot_blocked", { path, ip, ua, steam_id: rawSteamId, reason: "ua_pattern_on_refresh" });
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase: SupabaseClient | null =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;

  const steamId = await resolveSteamInput(rawSteamId, supabase ?? undefined, {
    persist: false,
  });
  if (!steamId) {
    return res.status(400).json({ error: "Invalid steam ID" });
  }

  if (supabase) {
    const { data: bannedRow } = await supabase
      .from("users")
      .select("banned")
      .eq("steam_id", steamId)
      .maybeSingle<{ banned: boolean | null }>();
    if (bannedRow?.banned) {
      return res.status(404).json({ error: "Player not found" });
    }
  }

  const forceRefresh = refresh === "1" && req.method === "POST";

  // Manual refresh: must be the profile owner (or an admin) and admins
  // bypass the daily quota. Anonymous and cross-profile refreshes are rejected.
  let refreshQuota: ManualRefreshQuota | undefined;
  if (forceRefresh) {
    const session = await getSessionUser(req, supabase);
    const isOwnProfile = session.steamId === steamId;
    const isAdmin = isAdminSteamId(session.steamId);

    if (!isOwnProfile && !isAdmin) {
      return res.status(403).json({
        error: "Sign in with Steam to refresh your own profile.",
      });
    }

    if (!isAdmin) {
      const quotaResult = consumeManualRefreshQuota(req.headers.cookie);
      refreshQuota = quotaResult.quota;
      res.setHeader("Set-Cookie", quotaResult.cookie);
      if (!quotaResult.allowed) {
        logAbuse("manual_refresh_quota_exceeded", {
          path,
          ip,
          ua,
          steam_id: steamId,
        });
        res.setHeader(
          "Retry-After",
          Math.max(
            1,
            Math.ceil(
              (new Date(refreshQuota.reset_at).getTime() - Date.now()) / 1000
            )
          ).toString()
        );
        return res.status(429).json({
          error: "Daily manual refresh limit reached",
          refresh_quota: refreshQuota,
        });
      }
    }
  }

  // Check cache unless an authorised manual refresh is in flight.
  if (supabase && !forceRefresh) {
    const { data: cached } = await supabase
      .from("users")
      .select(USER_DRODO_SELECT)
      .eq("steam_id", steamId)
      .maybeSingle<CachedUserDrodoRow>();

    if (
      cached?.drodo_profile_missing &&
      isFreshCache(cached.drodo_last_fetched_at, true)
    ) {
      return res.status(404).json({
        error: EMPTY_DRODO_PROFILE_ERROR,
        fetched_at: cached.drodo_last_fetched_at,
      });
    }

    if (cached && isFreshCache(cached.drodo_last_fetched_at, false)) {
      const cachedProfile = cachedUserToDrodoProfile(cached);
      const { data: seasons } = await supabase
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played, chicken_count")
        .eq("steam_id", steamId)
        .order("season", { ascending: true });

      if (hasDrodoStats(cachedProfile, seasons ?? [])) {
        return res.status(200).json({ ...cachedProfile, seasons: seasons ?? [] });
      }

      await purgeDrodoCache(steamId, supabase);
    }
  }

  const result = await fetchAndCacheDrodo(steamId, supabase, {
    snapshotOnSuccess: forceRefresh,
  });

  if (!result.ok) {
    if (result.kind === "missing") {
      return res.status(404).json({
        error: result.error,
        fetched_at: result.fetchedAt,
        ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
      });
    }
    return res.status(502).json({
      error: result.error,
      ...(result.status ? { status: result.status } : {}),
      ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
    });
  }

  await fetchSteamProfile(steamId, supabase ?? undefined);

  if (!supabase) {
    return res.status(200).json({
      ...result.profile,
      seasons: result.seasonRows,
      ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
    });
  }

  // Re-read season history so the response reflects merged historical rows.
  const { data: seasons } = await supabase
    .from("player_seasons")
    .select("season, mmr, max_mmr, games_played, chicken_count")
    .eq("steam_id", steamId)
    .order("season", { ascending: true });

  return res.status(200).json({
    ...result.profile,
    seasons: seasons ?? [],
    ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
  });
}
