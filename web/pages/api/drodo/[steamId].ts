import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchSteamProfile, resolveSteamInput } from "../../../lib/steam";

const DRODO_BASE = "http://autochess.ppbizon.com";
const DRODO_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const EMPTY_DRODO_PROFILE_ERROR =
  "Steam account has no Dota Auto Chess MMR or stats.";

interface SeasonSnapshotRow {
  steam_id: string;
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
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
  data: Record<string, unknown>
): SeasonSnapshotRow[] {
  const now = new Date().toISOString();
  const seasons: SeasonSnapshotRow[] = [];
  for (const key of Object.keys(data)) {
    const m = key.match(/^mmr_s(\d+)$/);
    if (m) {
      const n = m[1];
      seasons.push({
        steam_id: steamId,
        season: `s${n}`,
        mmr: Number(data[`mmr_s${n}`]) || null,
        max_mmr: Number(data[`max_mmr_s${n}`]) || null,
        games_played: Number(data[`match_s${n}`]) || null,
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
    seasonRows: extractAllSeasons(steamId, drodoData),
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
    .from("drodo_profiles")
    .delete()
    .eq("steam_id", steamId);
  if (profileError) {
    console.error("Failed to delete stale drodo profile:", profileError.message);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { steamId: rawSteamId, refresh } = req.query;
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return res.status(400).json({ error: "Invalid steam ID" });
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

  // Check cache unless force refresh
  if (supabase && refresh !== "1") {
    const { data: cached } = await supabase
      .from("drodo_profiles")
      .select("*")
      .eq("steam_id", steamId)
      .single();

    if (isFreshCache(cached?.fetched_at)) {
      const { data: seasons } = await supabase
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played")
        .eq("steam_id", steamId)
        .order("season", { ascending: true });

      if (hasDrodoStats(cached, seasons ?? [])) {
        return res.status(200).json({ ...cached, seasons: seasons ?? [] });
      }

      await purgeDrodoCache(steamId, supabase);
    }
  }

  // Fetch from Drodo
  let drodoData: Record<string, unknown>;
  try {
    const resp = await fetch(`${DRODO_BASE}/courier/get/@${steamId}`);
    if (!resp.ok) {
      return res.status(502).json({ error: "Drodo API error", status: resp.status });
    }
    const json = await resp.json();
    if (json.err !== 0 || !json.user_info?.[steamId]) {
      return res.status(404).json({ error: "Player not found on Drodo" });
    }
    drodoData = json.user_info[steamId];
  } catch (e) {
    return res.status(502).json({ error: "Failed to reach Drodo API" });
  }

  const { profile, seasonRows } = buildDrodoProfile(steamId, drodoData);

  if (!hasDrodoStats(profile, seasonRows)) {
    if (supabase) await purgeDrodoCache(steamId, supabase);
    return res.status(404).json({ error: EMPTY_DRODO_PROFILE_ERROR });
  }

  await fetchSteamProfile(steamId, supabase ?? undefined);

  if (!supabase) {
    return res.status(200).json({ ...profile, seasons: seasonRows });
  }

  const { error: upsertError } = await supabase
    .from("drodo_profiles")
    .upsert(profile, { onConflict: "steam_id" });

  if (upsertError) {
    console.error("Failed to cache drodo profile:", upsertError.message);
  }

  // Upsert all season snapshots
  if (seasonRows.length > 0) {
    const { error: seasonsError } = await supabase
      .from("player_seasons")
      .upsert(seasonRows, { onConflict: "steam_id,season" });
    if (seasonsError) {
      console.error("Failed to upsert player_seasons:", seasonsError.message);
    }
  }

  // Fetch full season history from DB (includes previously saved seasons)
  const { data: seasons } = await supabase
    .from("player_seasons")
    .select("season, mmr, max_mmr, games_played")
    .eq("steam_id", steamId)
    .order("season", { ascending: true });

  return res.status(200).json({ ...profile, seasons: seasons ?? [] });
}
