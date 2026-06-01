/**
 * Twitch Extension stats endpoint.
 *
 * Returns the player's current rank, season stats, and last 10 games in
 * a single JSON payload — sized for the Twitch panel to render directly
 * without further round-trips.
 *
 * Public; CORS open; cached at the edge for 30s.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { mmrToRank } from "@dac/shared/game-utils";
import {
  fetchSteamProfile,
  playerProfilePath,
  resolveSteamInput,
} from "@/lib/steam";

const SITE_HOST =
  process.env.NEXT_PUBLIC_SITE_HOST?.replace(/\/$/, "") ||
  "https://trackautochess.com";

interface SeasonAnchor {
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
  chicken_count: number | null;
}

interface MmrPoint {
  mmr: number | null;
  snapshotted_at: string;
}

interface StatsResponse {
  player: {
    steam_id: string;
    name: string | null;
    avatar_url: string | null;
    profile_url: string;
  };
  stats: {
    mmr: number | null;
    max_mmr: number | null;
    season: string | null;
    rank: string | null;
    mmr_level: number | null;
    games_played: number | null;
    chicken_count: number | null;
    chicken_pct: number | null;
    candy: number | null;
    total_chicken_count: number | null;
    total_games_played: number | null;
    seasons_played: number | null;
    lifetime_peak_mmr: number | null;
  };
  seasons: SeasonAnchor[];
  mmr_history: MmrPoint[];
  generated_at: string;
}

function setCors(res: NextApiResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StatsResponse | { error: string }>
) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const raw = Array.isArray(req.query.steamId)
    ? req.query.steamId[0]
    : req.query.steamId;
  if (!raw) return res.status(400).json({ error: "steamId required" });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const steamId = await resolveSteamInput(raw, supabase, { persist: false });
  if (!steamId) return res.status(404).json({ error: "Player not found" });

  const [profile, drodoRes, seasonsRes, snapshotsRes] = await Promise.all([
    fetchSteamProfile(steamId, supabase, { persist: false }),
    supabase
      .from("users")
      .select(
        "drodo_mmr, drodo_max_mmr, drodo_mmr_level, drodo_season, drodo_season_games, drodo_candy, drodo_chicken_count, drodo_profile_missing"
      )
      .eq("steam_id", steamId)
      .maybeSingle(),
    supabase
      .from("player_seasons")
      .select("season, mmr, max_mmr, games_played, chicken_count")
      .eq("steam_id", steamId)
      .order("season", { ascending: true }),
    supabase
      .from("mmr_snapshots")
      .select("mmr, snapshotted_at")
      .eq("steam_id", steamId)
      .not("mmr", "is", null)
      .order("snapshotted_at", { ascending: false })
      .limit(60),
  ]);

  const drodo = drodoRes.data as {
    drodo_mmr: number | null;
    drodo_max_mmr: number | null;
    drodo_mmr_level: number | null;
    drodo_season: string | null;
    drodo_season_games: number | null;
    drodo_candy: number | null;
    drodo_chicken_count: number | null;
    drodo_profile_missing: boolean | null;
  } | null;

  const hasStats = drodo && !drodo.drodo_profile_missing;
  const mmr = hasStats ? drodo.drodo_mmr : null;
  const games = hasStats ? drodo.drodo_season_games : null;
  const wins = hasStats ? drodo.drodo_chicken_count : null;
  const chickenPct =
    games && wins != null && games > 0
      ? Math.round((wins / games) * 1000) / 10
      : null;

  const seasons = (seasonsRes.data ?? []) as SeasonAnchor[];
  const totalChickens = seasons.reduce(
    (acc, s) => acc + (s.chicken_count ?? 0),
    0
  );
  const totalGames = seasons.reduce(
    (acc, s) => acc + (s.games_played ?? 0),
    0
  );
  const lifetimePeak = seasons.reduce<number | null>((acc, s) => {
    if (s.max_mmr == null) return acc;
    return acc == null || s.max_mmr > acc ? s.max_mmr : acc;
  }, hasStats ? drodo.drodo_max_mmr : null);
  const seasonsPlayed = seasons.filter(
    (s) => (s.games_played ?? 0) > 0 || s.mmr != null
  ).length;

  const payload: StatsResponse = {
    player: {
      steam_id: steamId,
      name: profile.name,
      avatar_url: profile.avatarUrl ?? null,
      profile_url:
        SITE_HOST + playerProfilePath(steamId, profile.customUrl),
    },
    stats: {
      mmr,
      max_mmr: hasStats ? drodo.drodo_max_mmr : null,
      season: hasStats ? drodo.drodo_season : null,
      rank: mmrToRank(mmr) || null,
      mmr_level: hasStats ? drodo.drodo_mmr_level : null,
      games_played: games,
      chicken_count: wins,
      chicken_pct: chickenPct,
      candy: hasStats ? drodo.drodo_candy : null,
      total_chicken_count: totalChickens > 0 ? totalChickens : wins,
      total_games_played: totalGames > 0 ? totalGames : games,
      seasons_played: seasonsPlayed > 0 ? seasonsPlayed : null,
      lifetime_peak_mmr: lifetimePeak,
    },
    seasons,
    mmr_history: ((snapshotsRes.data ?? []) as MmrPoint[])
      .slice()
      .reverse(),
    generated_at: new Date().toISOString(),
  };

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=120"
  );
  return res.status(200).json(payload);
}
