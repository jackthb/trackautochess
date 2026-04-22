import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { fetchSteamProfile, resolveSteamInput } from "../../../lib/steam";

const DRODO_BASE = "http://autochess.ppbizon.com";

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
): { steam_id: string; season: string; mmr: number | null; max_mmr: number | null; games_played: number | null; fetched_at: string }[] {
  const now = new Date().toISOString();
  const seasons: ReturnType<typeof extractAllSeasons> = [];
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
  return seasons;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { steamId: rawSteamId, refresh } = req.query;
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return res.status(400).json({ error: "Invalid steam ID" });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const steamId = await resolveSteamInput(rawSteamId, supabase);
  if (!steamId) {
    return res.status(400).json({ error: "Invalid steam ID" });
  }

  await fetchSteamProfile(steamId, supabase);

  // Check cache unless force refresh
  if (refresh !== "1") {
    const { data: cached } = await supabase
      .from("drodo_profiles")
      .select("*")
      .eq("steam_id", steamId)
      .single();

    if (cached?.fetched_at) {
      const fetchedDate = new Date(cached.fetched_at).toDateString();
      const today = new Date().toDateString();
      if (fetchedDate === today) {
        const { data: seasons } = await supabase
          .from("player_seasons")
          .select("season, mmr, max_mmr, games_played")
          .eq("steam_id", steamId)
          .order("season", { ascending: true });
        return res.status(200).json({ ...cached, seasons: seasons ?? [] });
      }
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

  const season = currentSeason(drodoData);
  const mmrKey = season ? `mmr_${season}` : null;
  const maxMmrKey = season ? `max_mmr_${season}` : null;
  const matchKey = season ? `match_${season}` : null;

  const profile = {
    steam_id: steamId,
    mmr: mmrKey ? Number(drodoData[mmrKey]) || null : null,
    max_mmr: maxMmrKey ? Number(drodoData[maxMmrKey]) || null : null,
    mmr_level: Number(drodoData.mmr_level) || null,
    season,
    season_games: matchKey ? Number(drodoData[matchKey]) || null : null,
    chicken_count: Number(drodoData.chicken_count) || 0,
    raw_data: drodoData,
    fetched_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("drodo_profiles")
    .upsert(profile, { onConflict: "steam_id" });

  if (upsertError) {
    console.error("Failed to cache drodo profile:", upsertError.message);
  }

  // Upsert all season snapshots
  const seasonRows = extractAllSeasons(steamId, drodoData);
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
