// Level-oriented helpers for the rank ladder UI, derived from the canonical
// rank table in @dac/shared/game-utils so there is a single source of truth
// for MMR thresholds.
//
// Game source of truth: panorama/scripts/custom_game/dac.vjs_c
//   GetMMRLevelByScore: mmr_level = clamp(floor((mmr - 340) / 80), 1, 38)
//   < 5 games: mmr_level = 0 (Unranked)

import { RANK_BRACKETS } from "@dac/shared/game-utils";

export const MIN_LEVEL = 1;
export const MAX_LEVEL = RANK_BRACKETS.length;

export function mmrToLevel(mmr: number | null | undefined): number {
  if (mmr == null || !Number.isFinite(mmr)) return 0;
  let level = MIN_LEVEL;
  for (let i = 0; i < RANK_BRACKETS.length; i++) {
    if (mmr >= RANK_BRACKETS[i].mmr) level = i + 1;
    else break;
  }
  return level;
}

export function levelToRankName(level: number): string {
  if (level <= 0) return "Unranked";
  if (level > MAX_LEVEL) return "";
  return RANK_BRACKETS[level - 1].rank;
}

export function levelMinMmr(level: number): number {
  if (level <= MIN_LEVEL) return 0;
  return RANK_BRACKETS[Math.min(level, MAX_LEVEL) - 1].mmr;
}
