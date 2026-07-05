import type { SupabaseClient } from "@supabase/supabase-js";
import type { Game } from "@dac/shared/types";
import { mmrLevelToRank } from "@dac/shared/game-utils";

// Shared match_players query layer used by the match detail page and the
// match OG image route so the row shape / select string / Game mapping only
// exist in one place.

/**
 * Rows whose played_at falls in the same 90-minute bucket are considered
 * candidates for duplicate-upload collapsing (two clients uploading the same
 * match). Shared by the /api/matches list and the player history dedupe.
 */
export const DUPLICATE_MATCH_WINDOW_MS = 90 * 60 * 1000;

/** Bucket a played_at timestamp for duplicate-match signatures. */
export function duplicateMatchTimeBucket(playedAt: string): number {
  const time = new Date(playedAt).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.floor(time / DUPLICATE_MATCH_WINDOW_MS);
}

export interface MatchPlayerRow {
  id: number;
  match_id: string;
  steam_id: string | number | null;
  placement: number | null;
  mmr_level: number | null;
  hero_level: number | null;
  chess_lineup: string | null;
  synergies: string | null;
  talents: string | null;
  relic: string | null;
  relic_history: unknown;
  win_round: number | null;
  lose_round: number | null;
  final_round: number | null;
  played_at: string | null;
}

export const MATCH_PLAYER_SELECT = [
  "id",
  "match_id",
  "steam_id::text",
  "placement",
  "mmr_level",
  "hero_level",
  "chess_lineup",
  "synergies",
  "talents",
  "relic",
  "relic_history",
  "win_round",
  "lose_round",
  "final_round",
  "played_at",
].join(", ");

/** Fetch one match_players row by primary key, or null. */
export async function fetchMatchPlayer(
  supabase: SupabaseClient,
  matchPlayerId: number
): Promise<MatchPlayerRow | null> {
  const { data } = await supabase
    .from("match_players")
    .select(MATCH_PLAYER_SELECT)
    .eq("id", matchPlayerId)
    .single();
  return (data as unknown as MatchPlayerRow | null) ?? null;
}

/** Fetch every match_players row for a match, ordered by placement. */
export async function fetchMatchRoster(
  supabase: SupabaseClient,
  matchId: string
): Promise<MatchPlayerRow[]> {
  const { data } = await supabase
    .from("match_players")
    .select(MATCH_PLAYER_SELECT)
    .eq("match_id", matchId)
    .order("placement", { ascending: true });
  return (data as unknown as MatchPlayerRow[] | null) ?? [];
}

/** Map a match_players row onto the legacy Game shape the UI renders. */
export function matchPlayerToGame(mp: MatchPlayerRow): Game {
  return {
    id: mp.id,
    match_id: mp.match_id,
    user_id: String(mp.steam_id ?? ""),
    placement: mp.placement != null ? String(mp.placement) : "",
    lineup: mp.chess_lineup,
    synergies: mp.synergies,
    talents: mp.talents,
    relic: mp.relic,
    level: mp.hero_level != null ? String(mp.hero_level) : null,
    rank: mp.mmr_level ? mmrLevelToRank(mp.mmr_level) : null,
    rank_change: null,
    wins: mp.win_round,
    losses: mp.lose_round,
    final_round: mp.final_round,
    wl: null,
    screenshot: null,
    notes: null,
    replay: null,
    played_at: mp.played_at || "",
    created_at: "",
  };
}
