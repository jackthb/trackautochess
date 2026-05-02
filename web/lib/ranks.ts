// Source of truth: panorama/scripts/custom_game/dac.vjs_c
//   GetMMRLevelByScore: mmr_level = clamp(floor((mmr - 340) / 80), 1, 38)
//   < 5 games: mmr_level = 0 (Unranked)
// Labels per resource/addon_english.txt (text_player_level_*).

const STEP = 80;
const OFFSET = 340;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 38;

const TIERS: { tier: string; start: number; count: number }[] = [
  { tier: "Pawn", start: 1, count: 9 },
  { tier: "Knight", start: 10, count: 9 },
  { tier: "Bishop", start: 19, count: 9 },
  { tier: "Rook", start: 28, count: 9 },
  { tier: "King", start: 37, count: 1 },
  { tier: "Queen", start: 38, count: 1 },
];

export function mmrToLevel(mmr: number | null | undefined): number {
  if (mmr == null || !Number.isFinite(mmr)) return 0;
  let level = Math.floor((mmr - OFFSET) / STEP);
  if (level > MAX_LEVEL) level = MAX_LEVEL;
  if (level < MIN_LEVEL) level = MIN_LEVEL;
  return level;
}

export function levelToRankName(level: number): string {
  if (level <= 0) return "Unranked";
  for (const { tier, start, count } of TIERS) {
    if (level >= start && level < start + count) {
      return count > 1 ? `${tier}-${level - start + 1}` : tier;
    }
  }
  return "";
}

export function levelMinMmr(level: number): number {
  if (level <= MIN_LEVEL) return 0;
  if (level > MAX_LEVEL) return MAX_LEVEL * STEP + OFFSET;
  return level * STEP + OFFSET;
}
