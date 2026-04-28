// Re-export all shared utilities from the monorepo shared package
export {
  placementColor,
  placementBg,
  costBorderColor,
  unitStem,
  relicStem,
  SYN_ICON_MAP,
  synIconName,
  parseLineup,
  parseSynergies,
  parseRelics,
  parseWL,
  RANK_BRACKETS,
  RANK_TIERS,
  NUMBERED_RANK_TIERS,
  mmrToRank,
  formatSize,
  formatDate,
} from "../../../shared/game-utils";

export function toDatetimeLocal(isoStr: string): string {
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
