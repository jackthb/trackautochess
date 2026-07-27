import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerGame, UnitFullInfo } from "@dac/shared/types";
import { mmrLevelToRank } from "@dac/shared/game-utils";
import {
  buildChessCodeUnitLookup,
  resolveChessLineup,
} from "@dac/shared/game-structure";
import { unitsFullData } from "@/generated/content-data";
import { duplicateMatchTimeBucket } from "@/lib/matches";

// Player match-history loading/shaping for the player profile page: fetch
// match_players rows, collapse duplicate uploads, and map rows onto the
// legacy Game shape the UI renders.

const CHESS_CODE_UNITS = buildChessCodeUnitLookup(
  unitsFullData as Record<string, UnitFullInfo>
);

const PLAYER_HISTORY_LIMIT = 100;

type HistoryRow = Record<string, unknown>;

function playerHistoryDuplicateKey(row: HistoryRow): string {
  const playedAt = typeof row.played_at === "string" ? row.played_at : "";
  return [
    duplicateMatchTimeBucket(playedAt),
    row.steam_id ?? "",
    row.placement ?? "",
    row.chess_lineup ?? "",
    row.synergies ?? "",
    row.relic ?? "",
    row.win_round ?? "",
    row.lose_round ?? "",
  ].join("::");
}

function dedupePlayerHistoryRows(rows: HistoryRow[]): HistoryRow[] {
  const bySignature = new Map<string, HistoryRow>();
  for (const row of rows) {
    const key = playerHistoryDuplicateKey(row);
    const current = bySignature.get(key);
    const rowId = typeof row.id === "number" ? row.id : 0;
    const currentId = typeof current?.id === "number" ? current.id : 0;
    if (!current || rowId > currentId) {
      bySignature.set(key, row);
    }
  }
  return [...bySignature.values()].sort((a, b) => {
    const aTime = typeof a.played_at === "string" ? a.played_at : "";
    const bTime = typeof b.played_at === "string" ? b.played_at : "";
    return bTime.localeCompare(aTime);
  });
}

function serializeResolvedLineup(lineup: { name: string; stars: number }[]): string {
  return lineup
    .map((unit) => `${unit.name}${unit.stars > 1 ? `(${unit.stars})` : ""}`)
    .join("|");
}

/** Fetch the raw recent match_players rows for one player. */
export async function fetchPlayerHistoryRows(
  supabase: SupabaseClient,
  steamId: string
): Promise<HistoryRow[]> {
  const { data } = await supabase
    .from("match_players")
    .select("*, steam_id::text")
    .filter("steam_id", "eq", steamId)
    .order("played_at", { ascending: false })
    .limit(PLAYER_HISTORY_LIMIT);
  return (data as HistoryRow[]) ?? [];
}

/** Dedupe raw history rows and map them onto the legacy Game render shape. */
export function playerHistoryToGames(rows: HistoryRow[]): PlayerGame[] {
  return dedupePlayerHistoryRows(rows).map((row) => {
    const resolvedLineup = resolveChessLineup(
      row.chess_lineup as string | undefined,
      CHESS_CODE_UNITS
    );
    const lineup = resolvedLineup.length
      ? serializeResolvedLineup(resolvedLineup)
      : (row.chess_lineup as string | null);
    return {
      ...row,
      user_id: String(row.steam_id),
      placement: row.placement != null ? String(row.placement) : "",
      played_at: (row.played_at as string) ?? "",
      created_at: (row.created_at as string) ?? "",
      lineup,
      // `synergies` stays the raw in-game `buff` capture. GameRowDisplay
      // derives the badges from the lineup and uses this only as a bounded
      // floor — pre-computing here would erase the one record of a
      // Ringmaster class roll before the row ever reaches the UI.
      synergies: row.synergies as string | null,
      level: row.hero_level ? String(row.hero_level) : null,
      rank:
        typeof row.mmr_level === "number"
          ? mmrLevelToRank(row.mmr_level) || null
          : null,
      rank_change: null,
      wl: null,
      wins: row.win_round as number | null,
      losses: row.lose_round as number | null,
      match_id: (row.match_id as string) ?? null,
    };
  }) as PlayerGame[];
}
