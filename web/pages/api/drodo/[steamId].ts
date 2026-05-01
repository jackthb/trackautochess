import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkBotId } from "botid/server";
import { fetchSteamProfile, resolveSteamInput } from "../../../lib/steam";
import {
  consumeManualRefreshQuota,
  type ManualRefreshQuota,
} from "@/lib/manualRefreshQuota";

const DRODO_BASE = "http://autochess.ppbizon.com";
const DRODO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_DRODO_PROFILE_ERROR =
  "Steam account has no Dota Auto Chess MMR or stats.";

// --- Bot / rate-limit protection ---

const BOT_UA_RE =
  /bot|crawl|spider|slurp|python|curl|wget|java|scrapy|httpclient|go-http|okhttp|libwww|axios|node-fetch/i;

interface SeasonSnapshotRow {
  steam_id: string;
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
  chicken_count: number | null;
  fetched_at: string;
}

interface DrodoProfileRow {
  steam_id: string;
  mmr: number | null;
  max_mmr: number | null;
  mmr_level: number | null;
  season: string | null;
  season_games: number | null;
  candy: number | null;
  chicken_count: number;
  raw_data: Record<string, unknown>;
  fetched_at: string;
}

interface CachedUserDrodoRow {
  steam_id: string;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_candy: number | null;
  drodo_chicken_count: number | null;
  drodo_raw_data: Record<string, unknown> | null;
  drodo_last_fetched_at: string | null;
  drodo_profile_missing: boolean | null;
}

const USER_DRODO_SELECT = [
  "steam_id::text",
  "drodo_mmr",
  "drodo_max_mmr",
  "drodo_mmr_level",
  "drodo_season",
  "drodo_season_games",
  "drodo_candy",
  "drodo_chicken_count",
  "drodo_raw_data",
  "drodo_last_fetched_at",
  "drodo_profile_missing",
].join(", ");

function currentSeason(data: Record<string, unknown>): string | null {
  // Find the highest season number in the response keys (mmr_s42, mmr_s41, etc.)
  let max = 0;
  let season = "";
  for (const key of Object.keys(data)) {
    const m = key.match(/^mmr_s(\d+)$/);
    if (m) {
      const n = parseInt(m[1]);
      if (n > max) {
        max = n;
        season = `s${n}`;
      }
    }
  }
  return season || null;
}

function extractAllSeasons(
  steamId: string,
  data: Record<string, unknown>,
  currentSeasonKey: string | null
): SeasonSnapshotRow[] {
  const now = new Date().toISOString();
  const seasons: SeasonSnapshotRow[] = [];
  for (const key of Object.keys(data)) {
    const m = key.match(/^mmr_s(\d+)$/);
    if (m) {
      const n = m[1];
      const seasonKey = `s${n}`;
      seasons.push({
        steam_id: steamId,
        season: seasonKey,
        mmr: Number(data[`mmr_s${n}`]) || null,
        max_mmr: Number(data[`max_mmr_s${n}`]) || null,
        games_played: Number(data[`match_s${n}`]) || null,
        // chicken_count is a running total on Drodo — only valid for the current season.
        // Historical seasons keep whatever we last stored; null here means "don't overwrite".
        chicken_count: seasonKey === currentSeasonKey ? (Number(data.chicken_count) || null) : null,
        fetched_at: now,
      });
    }
  }
  return seasons.sort(
    (a, b) =>
      Number(a.season.slice(1)) - Number(b.season.slice(1))
  );
}

function buildDrodoProfile(
  steamId: string,
  drodoData: Record<string, unknown>
): { profile: DrodoProfileRow; seasonRows: SeasonSnapshotRow[] } {
  const season = currentSeason(drodoData);
  const mmrKey = season ? `mmr_${season}` : null;
  const maxMmrKey = season ? `max_mmr_${season}` : null;
  const matchKey = season ? `match_${season}` : null;

  return {
    profile: {
      steam_id: steamId,
      mmr: mmrKey ? Number(drodoData[mmrKey]) || null : null,
      max_mmr: maxMmrKey ? Number(drodoData[maxMmrKey]) || null : null,
      mmr_level: Number(drodoData.mmr_level) || null,
      season,
      season_games: matchKey ? Number(drodoData[matchKey]) || null : null,
      candy: Number(drodoData.candy) || null,
      chicken_count: Number(drodoData.chicken_count) || 0,
      raw_data: drodoData,
      fetched_at: new Date().toISOString(),
    },
    seasonRows: extractAllSeasons(steamId, drodoData, season),
  };
}

function hasDrodoStats(
  profile: Pick<
    DrodoProfileRow,
    "mmr" | "max_mmr" | "season_games" | "chicken_count"
  >,
  seasonRows: Array<
    Pick<SeasonSnapshotRow, "mmr" | "max_mmr" | "games_played">
  >
): boolean {
  if (
    profile.mmr != null ||
    profile.max_mmr != null ||
    profile.season_games != null ||
    profile.chicken_count > 0
  ) {
    return true;
  }

  return seasonRows.some(
    (row) =>
      row.mmr != null ||
      row.max_mmr != null ||
      row.games_played != null
  );
}

function isFreshCache(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return false;
  const fetchedTime = new Date(fetchedAt).getTime();
  return Number.isFinite(fetchedTime) && Date.now() - fetchedTime < DRODO_CACHE_TTL_MS;
}

function cachedUserToDrodoProfile(row: CachedUserDrodoRow): DrodoProfileRow {
  return {
    steam_id: String(row.steam_id),
    mmr: row.drodo_mmr,
    max_mmr: row.drodo_max_mmr,
    mmr_level: row.drodo_mmr_level,
    season: row.drodo_season,
    season_games: row.drodo_season_games,
    candy: row.drodo_candy,
    chicken_count: row.drodo_chicken_count ?? 0,
    raw_data: row.drodo_raw_data ?? {},
    fetched_at: row.drodo_last_fetched_at ?? new Date(0).toISOString(),
  };
}

function drodoProfileToUserPayload(
  profile: DrodoProfileRow
): Record<string, unknown> {
  return {
    steam_id: profile.steam_id,
    drodo_mmr: profile.mmr,
    drodo_max_mmr: profile.max_mmr,
    drodo_mmr_level: profile.mmr_level,
    drodo_season: profile.season,
    drodo_season_games: profile.season_games,
    drodo_candy: profile.candy,
    drodo_chicken_count: profile.chicken_count,
    drodo_raw_data: profile.raw_data,
    drodo_last_fetched_at: profile.fetched_at,
    drodo_profile_missing: false,
  };
}

async function markDrodoMissing(
  steamId: string,
  supabase?: SupabaseClient | null
): Promise<string> {
  const fetchedAt = new Date().toISOString();
  if (!supabase) return fetchedAt;
  const { error } = await supabase.from("users").upsert(
    {
      steam_id: steamId,
      drodo_mmr: null,
      drodo_max_mmr: null,
      drodo_mmr_level: null,
      drodo_season: null,
      drodo_season_games: null,
      drodo_candy: null,
      drodo_chicken_count: 0,
      drodo_raw_data: null,
      drodo_last_fetched_at: fetchedAt,
      drodo_profile_missing: true,
    },
    { onConflict: "steam_id" }
  );
  if (error) {
    console.error("Failed to cache missing Drodo profile:", error.message);
  }
  return fetchedAt;
}

async function purgeDrodoCache(
  steamId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { error: seasonsError } = await supabase
    .from("player_seasons")
    .delete()
    .eq("steam_id", steamId);
  if (seasonsError) {
    console.error("Failed to delete stale player_seasons:", seasonsError.message);
  }

  const { error: profileError } = await supabase
    .from("users")
    .update({
      drodo_mmr: null,
      drodo_max_mmr: null,
      drodo_mmr_level: null,
      drodo_season: null,
      drodo_season_games: null,
      drodo_candy: null,
      drodo_chicken_count: 0,
      drodo_raw_data: null,
      drodo_last_fetched_at: new Date().toISOString(),
      drodo_profile_missing: true,
    })
    .eq("steam_id", steamId);
  if (profileError) {
    console.error("Failed to delete stale drodo profile:", profileError.message);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const botCheck = await checkBotId({ advancedOptions: { headers: req.headers } });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { steamId: rawSteamId, refresh } = req.query;
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return res.status(400).json({ error: "Invalid steam ID" });
  }

  const ua = req.headers["user-agent"] ?? "";

  // Reject obvious automation on forced-refresh calls.
  if (refresh === "1") {
    if (BOT_UA_RE.test(ua)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase =
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

  const forceRefresh = refresh === "1" && req.method === "POST";
  let refreshQuota: ManualRefreshQuota | undefined;
  if (forceRefresh) {
    const quotaResult = consumeManualRefreshQuota(req.headers.cookie);
    refreshQuota = quotaResult.quota;
    res.setHeader("Set-Cookie", quotaResult.cookie);
    if (!quotaResult.allowed) {
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

  // Check cache unless a user-triggered POST force refresh is requested.
  if (supabase && !forceRefresh) {
    const { data: cached } = await supabase
      .from("users")
      .select(USER_DRODO_SELECT)
      .eq("steam_id", steamId)
      .maybeSingle<CachedUserDrodoRow>();

    if (
      cached?.drodo_profile_missing &&
      isFreshCache(cached.drodo_last_fetched_at)
    ) {
      return res.status(404).json({
        error: EMPTY_DRODO_PROFILE_ERROR,
        fetched_at: cached.drodo_last_fetched_at,
      });
    }

    if (cached && isFreshCache(cached.drodo_last_fetched_at)) {
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

  // Fetch from Drodo
  let drodoData: Record<string, unknown>;
  try {
    const resp = await fetch(`${DRODO_BASE}/courier/get/@${steamId}`);
    if (!resp.ok) {
      return res.status(502).json({
        error: "Drodo API error",
        status: resp.status,
        ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
      });
    }
    const json = await resp.json();
    if (json.err !== 0 || !json.user_info?.[steamId]) {
      const fetchedAt = await markDrodoMissing(steamId, supabase);
      return res.status(404).json({
        error: "Player not found on Drodo",
        fetched_at: fetchedAt,
        ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
      });
    }
    drodoData = json.user_info[steamId];
  } catch (e) {
    return res.status(502).json({
      error: "Failed to reach Drodo API",
      ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
    });
  }

  const { profile, seasonRows } = buildDrodoProfile(steamId, drodoData);

  if (!hasDrodoStats(profile, seasonRows)) {
    const fetchedAt = await markDrodoMissing(steamId, supabase);
    return res.status(404).json({
      error: EMPTY_DRODO_PROFILE_ERROR,
      fetched_at: fetchedAt,
      ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
    });
  }

  await fetchSteamProfile(steamId, supabase ?? undefined);

  if (!supabase) {
    return res.status(200).json({
      ...profile,
      seasons: seasonRows,
      ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
    });
  }

  const { error: upsertError } = await supabase
    .from("users")
    .upsert(drodoProfileToUserPayload(profile), { onConflict: "steam_id" });

  if (upsertError) {
    console.error("Failed to cache Drodo profile:", upsertError.message);
  }

  // Upsert season snapshots, preserving chicken_count for historical seasons.
  // Drodo only returns the current season's chicken_count so we must not overwrite
  // previously saved values for older seasons with null.
  if (seasonRows.length > 0) {
    const { data: existingSeasons } = await supabase
      .from("player_seasons")
      .select("season, chicken_count")
      .eq("steam_id", steamId);
    const existingChickenCounts = new Map(
      (existingSeasons ?? []).map((r) => [r.season, r.chicken_count as number | null])
    );
    const mergedRows = seasonRows.map((row) => ({
      ...row,
      chicken_count: row.chicken_count ?? existingChickenCounts.get(row.season) ?? null,
    }));
    const { error: seasonsError } = await supabase
      .from("player_seasons")
      .upsert(mergedRows, { onConflict: "steam_id,season" });
    if (seasonsError) {
      console.error("Failed to upsert player_seasons:", seasonsError.message);
    }
  }

  // Fetch full season history from DB (includes previously saved seasons)
  const { data: seasons } = await supabase
    .from("player_seasons")
    .select("season, mmr, max_mmr, games_played, chicken_count")
    .eq("steam_id", steamId)
    .order("season", { ascending: true });

  return res.status(200).json({
    ...profile,
    seasons: seasons ?? [],
    ...(refreshQuota ? { refresh_quota: refreshQuota } : {}),
  });
}
