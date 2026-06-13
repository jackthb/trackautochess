import type { SupabaseClient } from "@supabase/supabase-js";

export interface QueenRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  stream_link: string | null;
  drodo_mmr: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
  drodo_queen_rank: number | null;
  drodo_last_fetched_at: string | null;
  queen_ladder_rank: number | null;
  queen_ladder_season: string | null;
  queen_ladder_last_seen_at: string | null;
}

export const QUEEN_TABLE_LIMIT = 100;
export const QUEEN_CANDIDATE_LIMIT = 300;

export const QUEEN_SELECT = [
  "steam_id::text",
  "name",
  "custom_url",
  "avatar_url",
  "stream_link",
  "drodo_mmr",
  "drodo_season",
  "drodo_season_games",
  "drodo_chicken_count",
  "drodo_queen_rank",
  "drodo_last_fetched_at",
  "queen_ladder_rank",
  "queen_ladder_season",
  "queen_ladder_last_seen_at",
].join(", ");

export function profileQueenRank(row: QueenRow): number | null {
  const value = row.drodo_queen_rank;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function effectiveQueenRank(row: QueenRow): number | null {
  return profileQueenRank(row) ?? row.queen_ladder_rank;
}

export function queenMmr(row: QueenRow): number | null {
  return row.drodo_mmr ?? null;
}

export function compareQueenRows(a: QueenRow, b: QueenRow): number {
  const aRank = effectiveQueenRank(a) ?? Number.MAX_SAFE_INTEGER;
  const bRank = effectiveQueenRank(b) ?? Number.MAX_SAFE_INTEGER;
  return aRank - bRank || (queenMmr(b) ?? -1) - (queenMmr(a) ?? -1);
}

function isBetterRankRow(candidate: QueenRow, current: QueenRow): boolean {
  const candidateProfileRank = profileQueenRank(candidate);
  const currentProfileRank = profileQueenRank(current);
  if (candidateProfileRank != null && currentProfileRank == null) return true;
  if (candidateProfileRank == null && currentProfileRank != null) return false;

  const candidateFetchedAt = candidate.drodo_last_fetched_at;
  const currentFetchedAt = current.drodo_last_fetched_at;
  if (candidateFetchedAt && currentFetchedAt && candidateFetchedAt !== currentFetchedAt) {
    return candidateFetchedAt > currentFetchedAt;
  }
  if (candidateFetchedAt && !currentFetchedAt) return true;
  if (!candidateFetchedAt && currentFetchedAt) return false;

  const candidateSeenAt = candidate.queen_ladder_last_seen_at;
  const currentSeenAt = current.queen_ladder_last_seen_at;
  if (candidateSeenAt && !currentSeenAt) return true;
  if (!candidateSeenAt && currentSeenAt) return false;
  if (candidateSeenAt && currentSeenAt && candidateSeenAt !== currentSeenAt) {
    return candidateSeenAt > currentSeenAt;
  }
  return (queenMmr(candidate) ?? -1) > (queenMmr(current) ?? -1);
}

function dedupeQueenRanks(rows: QueenRow[]): QueenRow[] {
  const ranked = new Map<number, QueenRow>();
  const unranked: QueenRow[] = [];
  for (const row of rows) {
    const rank = effectiveQueenRank(row);
    if (rank == null) {
      unranked.push(row);
      continue;
    }
    const current = ranked.get(rank);
    if (!current || isBetterRankRow(row, current)) {
      ranked.set(rank, row);
    }
  }
  return [...ranked.values(), ...unranked].sort(compareQueenRows);
}

export function selectDisplayedQueens(rows: QueenRow[]): QueenRow[] {
  const latestSeenAt = rows[0]?.queen_ladder_last_seen_at ?? null;
  const rankedRows = (latestSeenAt
    ? rows.filter(
        (row) =>
          row.queen_ladder_last_seen_at === latestSeenAt ||
          profileQueenRank(row) != null
      )
    : rows.filter((row) => profileQueenRank(row) != null)
  )
    .sort(compareQueenRows)
    .filter((row) => {
      const rank = effectiveQueenRank(row);
      return rank == null || rank <= QUEEN_TABLE_LIMIT;
    });
  return dedupeQueenRanks(rankedRows).slice(0, QUEEN_TABLE_LIMIT);
}

function normalizeQueenRows(rows: QueenRow[]): QueenRow[] {
  return rows.map((row) => ({
    ...row,
    steam_id: String(row.steam_id),
  }));
}

export async function loadQueenCandidates(
  supabase: SupabaseClient,
): Promise<QueenRow[]> {
  const { data, error } = await supabase
    .from("users")
    .select(QUEEN_SELECT)
    .or("queen_ladder_last_seen_at.not.is.null,drodo_queen_rank.not.is.null")
    .order("queen_ladder_last_seen_at", { ascending: false, nullsFirst: false })
    .order("queen_ladder_rank", { ascending: true, nullsFirst: false })
    .order("drodo_mmr", { ascending: false, nullsFirst: false })
    .limit(QUEEN_CANDIDATE_LIMIT);

  if (error) throw new Error(error.message);
  return normalizeQueenRows((data ?? []) as unknown as QueenRow[]);
}
