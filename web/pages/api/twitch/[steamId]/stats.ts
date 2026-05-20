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

interface RecentGame {
  id: number;
  played_at: string | null;
  placement: number | null;
  level: number | null;
  wins: number | null;
  losses: number | null;
  lineup: string | null;
  synergies: string | null;
  relic: string | null;
  match_id: string | null;
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
    games_played: number | null;
    chicken_count: number | null;
    chicken_pct: number | null;
  };
  recent_games: RecentGame[];
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

  // Banned users are silently 404'd, same as the OG endpoint did.
  const { data: bannedRow } = await supabase
    .from("users")
    .select("banned")
    .eq("steam_id", steamId)
    .maybeSingle<{ banned: boolean | null }>();
  if (bannedRow?.banned) {
    return res.status(404).json({ error: "Player not found" });
  }

  const [profile, drodoRes, gamesRes] = await Promise.all([
    fetchSteamProfile(steamId, supabase, { persist: false }),
    supabase
      .from("users")
      .select(
        "drodo_mmr, drodo_max_mmr, drodo_season, drodo_season_games, drodo_chicken_count, drodo_profile_missing"
      )
      .eq("steam_id", steamId)
      .maybeSingle(),
    supabase
      .from("games")
      .select(
        "id, played_at, placement, level, wins, losses, lineup, synergies, relic, match_id"
      )
      .eq("user_id", steamId)
      .order("played_at", { ascending: false })
      .limit(10),
  ]);

  const drodo = drodoRes.data as {
    drodo_mmr: number | null;
    drodo_max_mmr: number | null;
    drodo_season: string | null;
    drodo_season_games: number | null;
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
      games_played: games,
      chicken_count: wins,
      chicken_pct: chickenPct,
    },
    recent_games: (gamesRes.data ?? []) as RecentGame[],
    generated_at: new Date().toISOString(),
  };

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=120"
  );
  return res.status(200).json(payload);
}
