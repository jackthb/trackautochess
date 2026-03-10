import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { steamId, refresh } = req.query;
  if (!steamId || typeof steamId !== "string" || !/^\d+$/.test(steamId)) {
    return res.status(400).json({ error: "Invalid steam ID" });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

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
        return res.status(200).json(cached);
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

  return res.status(200).json(profile);
}
