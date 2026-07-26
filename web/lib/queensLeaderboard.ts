import { createSupabaseServerClient } from "@/lib/supabase";
import {
  hydrateQueenSteamProfiles,
  loadQueenCandidates,
  queenNeedsSteamProfile,
  selectDisplayedQueens,
  type QueenRow,
} from "@/lib/queens";
import { mostRecentTimestamp } from "@/lib/timestamps";

// Server-side data layer for the /queens leaderboard page: row loading,
// 24h rank-movement derivation, and staleness/season helpers. Rendering
// stays in app/queens/page.tsx.

export const QUEEN_MOVE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const QUEEN_MOVE_LOOKBACK_LABEL = "24h";

export interface QueenMove {
  latestRank: number;
  previousRank: number | null;
  delta: number | null;
}

export interface QueenLeaderboardRow extends QueenRow {
  move?: QueenMove | null;
}

interface QueenSnapshotRow {
  steam_id: string;
  queen_rank: number | null;
  snapshotted_at: string;
}

function buildQueenMoves(snapshots: QueenSnapshotRow[]): Map<string, QueenMove> {
  const bySteamId = new Map<string, QueenSnapshotRow[]>();
  for (const snapshot of snapshots) {
    if (typeof snapshot.queen_rank !== "number") continue;
    const steamId = String(snapshot.steam_id);
    const list = bySteamId.get(steamId) ?? [];
    list.push({ ...snapshot, steam_id: steamId });
    bySteamId.set(steamId, list);
  }

  const moves = new Map<string, QueenMove>();
  for (const [steamId, list] of bySteamId) {
    const ordered = [...list].sort(
      (a, b) =>
        new Date(b.snapshotted_at).getTime() - new Date(a.snapshotted_at).getTime()
    );
    const latestRank = ordered[0]?.queen_rank ?? null;
    if (latestRank == null) continue;
    const previousRank = ordered.length > 1 ? ordered[ordered.length - 1]?.queen_rank ?? null : null;
    moves.set(steamId, {
      latestRank,
      previousRank,
      delta: previousRank == null ? null : previousRank - latestRank,
    });
  }
  return moves;
}

export async function loadQueensLeaderboard(): Promise<{
  rows: QueenLeaderboardRow[];
  error: string | null;
}> {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return { rows: [], error: "Database is not configured." };
  }

  let rows: QueenLeaderboardRow[];
  try {
    rows = selectDisplayedQueens(await loadQueenCandidates(supabase));
    if (rows.some(queenNeedsSteamProfile)) {
      rows = (await hydrateQueenSteamProfiles(rows, supabase)).rows;
    }
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "Failed to load Queen rows",
    };
  }

  if (rows.length === 0) {
    return { rows, error: null };
  }

  const movementCutoff = new Date(Date.now() - QUEEN_MOVE_LOOKBACK_MS).toISOString();
  const { data: snapshots, error: snapshotsError } = await supabase
    .from("mmr_snapshots")
    .select("steam_id::text, queen_rank, snapshotted_at")
    .filter("steam_id", "in", `(${rows.map((row) => row.steam_id).join(",")})`)
    .not("queen_rank", "is", null)
    .gte("snapshotted_at", movementCutoff)
    .order("steam_id", { ascending: true })
    .order("snapshotted_at", { ascending: false })
    .limit(rows.length * 8);

  if (snapshotsError) {
    console.error("Failed to load Queen rank movement:", snapshotsError.message);
  }

  const moves = buildQueenMoves((snapshots ?? []) as unknown as QueenSnapshotRow[]);

  return {
    rows: rows.map((row) => ({ ...row, move: moves.get(row.steam_id) ?? null })),
    error: null,
  };
}

// --- Season-scoped stat helpers -----------------------------------------
// The ladder capture and the Drodo profile can disagree on season; only show
// season stats when both agree (or either side is unknown).

function normalizeSeason(value: string | null): string | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/\d+/);
  return match ? `s${Number(match[0])}` : raw;
}

function seasonMatches(row: QueenRow): boolean {
  const ladderSeason = normalizeSeason(row.queen_ladder_season);
  const drodoSeason = normalizeSeason(row.drodo_season);
  return !ladderSeason || !drodoSeason || ladderSeason === drodoSeason;
}

export function queenSeasonGames(row: QueenRow): number | null {
  if (!seasonMatches(row)) return null;
  return row.drodo_season_games;
}

export function queenSeasonWins(row: QueenRow): number | null {
  if (!seasonMatches(row)) return null;
  return row.drodo_chicken_count;
}

// --- Staleness helpers ----------------------------------------------------

export function newestQueenLadderSeenAt(rows: QueenRow[]): string | null {
  return mostRecentTimestamp(
    ...rows.map((row) => row.queen_ladder_last_seen_at)
  );
}
