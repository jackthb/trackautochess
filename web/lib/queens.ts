import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSteamId64 } from "@dac/shared/steam";
import { fetchSteamProfile } from "@/lib/steam";
import { STEAM_ID_TEXT_SELECT } from "@/lib/supabaseSelect";

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
  drodo_last_fetched_at: string | null;
  queen_ladder_rank: number | null;
  queen_ladder_season: string | null;
  queen_ladder_last_seen_at: string | null;
}

export const QUEEN_TABLE_LIMIT = 100;
export const QUEEN_CANDIDATE_LIMIT = 300;

export const QUEEN_SELECT =
  `${STEAM_ID_TEXT_SELECT}, name, custom_url, avatar_url, stream_link, drodo_mmr, drodo_season, drodo_season_games, drodo_chicken_count, drodo_last_fetched_at, queen_ladder_rank, queen_ladder_season, queen_ladder_last_seen_at` as const;

export function effectiveQueenRank(row: QueenRow): number | null {
  return row.queen_ladder_rank;
}

export function queenMmr(row: QueenRow): number | null {
  return row.drodo_mmr ?? null;
}

export function queenDisplayName(row: QueenRow, rank?: number | null): string {
  const display = row.name?.trim() || row.custom_url?.trim();
  if (display) return display;
  return rank ? `Queen #${rank}` : "Queen Player";
}

export function queenNeedsSteamProfile(row: QueenRow): boolean {
  return !row.name || !row.avatar_url;
}

function applySteamProfile(row: QueenRow, profile: {
  name?: string | null;
  customUrl?: string | null;
  avatarUrl?: string | null;
}): QueenRow {
  return {
    ...row,
    name: row.name || profile.name || null,
    custom_url: row.custom_url || profile.customUrl || null,
    avatar_url: row.avatar_url || profile.avatarUrl || null,
  };
}

function steamProfileImproved(row: QueenRow, next: QueenRow): boolean {
  return (
    row.name !== next.name ||
    row.custom_url !== next.custom_url ||
    row.avatar_url !== next.avatar_url
  );
}

export async function hydrateQueenSteamProfiles(
  rows: QueenRow[],
  supabase: SupabaseClient,
  options: {
    concurrency?: number;
    limit?: number;
    onProfileChange?: (row: QueenRow) => void;
  } = {}
): Promise<{ rows: QueenRow[]; changed: number }> {
  const candidates = rows
    .filter(queenNeedsSteamProfile)
    .slice(0, options.limit ?? rows.length);
  if (candidates.length === 0) return { rows, changed: 0 };

  const nextRows = new Map(rows.map((row) => [row.steam_id, row]));
  const concurrency = Math.max(1, options.concurrency ?? 6);
  let changed = 0;

  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (row) => {
        const steamId = parseSteamId64(row.steam_id);
        if (!steamId) return;
        try {
          const profile = await fetchSteamProfile(steamId, supabase, {
            persist: true,
            force: !row.name,
            requireAvatar: true,
          });
          const next = applySteamProfile(row, profile);
          if (!steamProfileImproved(row, next)) return;
          nextRows.set(row.steam_id, next);
          changed += 1;
          options.onProfileChange?.(next);
        } catch (error) {
          console.error("Failed to refresh Queen Steam profile:", {
            steamId: row.steam_id,
            error,
          });
        }
      })
    );
  }

  return {
    rows: rows.map((row) => nextRows.get(row.steam_id) ?? row),
    changed,
  };
}

export function compareQueenRows(a: QueenRow, b: QueenRow): number {
  const aRank = effectiveQueenRank(a) ?? Number.MAX_SAFE_INTEGER;
  const bRank = effectiveQueenRank(b) ?? Number.MAX_SAFE_INTEGER;
  return aRank - bRank || (queenMmr(b) ?? -1) - (queenMmr(a) ?? -1);
}

function isBetterRankRow(candidate: QueenRow, current: QueenRow): boolean {
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
  const rankedRows = rows
    .filter((row) => row.queen_ladder_rank != null)
    .sort(compareQueenRows);
  return dedupeQueenRanks(rankedRows).slice(0, QUEEN_TABLE_LIMIT);
}

export function selectQueensRefreshRows(rows: QueenRow[]): QueenRow[] {
  const displayed = selectDisplayedQueens(rows);
  const bySteamId = new Map(displayed.map((row) => [row.steam_id, row]));
  const topRankCounts = new Map<number, number>();

  for (const row of rows) {
    const rank = effectiveQueenRank(row);
    if (rank == null || rank > QUEEN_TABLE_LIMIT) continue;
    topRankCounts.set(rank, (topRankCounts.get(rank) ?? 0) + 1);
  }

  const duplicateRankRows = rows
    .filter((row) => {
      const rank = effectiveQueenRank(row);
      return (
        rank != null &&
        rank <= QUEEN_TABLE_LIMIT &&
        (topRankCounts.get(rank) ?? 0) > 1
      );
    })
    .sort(compareQueenRows);

  for (const row of duplicateRankRows) {
    bySteamId.set(row.steam_id, row);
  }

  return [...bySteamId.values()];
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
    .not("queen_ladder_rank", "is", null)
    .order("queen_ladder_last_seen_at", { ascending: false, nullsFirst: false })
    .order("queen_ladder_rank", { ascending: true, nullsFirst: false })
    .order("drodo_mmr", { ascending: false, nullsFirst: false })
    .limit(QUEEN_CANDIDATE_LIMIT);

  if (error) throw new Error(error.message);
  return normalizeQueenRows((data ?? []) as unknown as QueenRow[]);
}
