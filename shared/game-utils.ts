import type { ItemFullInfo, RelicInfo } from "./types";

export function placementColor(p: number): string {
  if (p === 1) return "var(--gold)";
  if (p <= 3) return "var(--silver)";
  if (p === 4) return "var(--text-secondary)";
  return "var(--red-bright)";
}

export function placementBg(p: number): string {
  if (p === 1) return "rgba(201,168,76,0.08)";
  if (p <= 3) return "rgba(138,146,168,0.05)";
  if (p === 4) return "transparent";
  return "rgba(155,58,58,0.05)";
}

export function costBorderColor(cost: number): string {
  switch (cost) {
    case 1: return "#5c6278";
    case 2: return "#5a8fd5";
    case 3: return "#2a4a8a";
    case 4: return "#c44ea0";
    case 5: return "#c9a84c";
    default: return "#5c6278";
  }
}

// Canonical unit name → icon filename stem overrides.
// Add entries here whenever the scraper's canonical name doesn't match the icon file.
const UNIT_STEM_MAP: Record<string, string> = {
  "Blood Seeker": "bloodseeker",
  "Spectres": "spectre",
  "DarkSeer": "dark_seer",
};

export function unitStem(name: string): string {
  if (UNIT_STEM_MAP[name]) return UNIT_STEM_MAP[name];
  return name.toLowerCase().replace(/ /g, "_").replace(/-/g, "_").replace(/'/g, "");
}

export function relicStem(name: string): string {
  return name.toLowerCase().replace(/ /g, "_").replace(/-/g, "_");
}

export function itemIconStem(itemId: string, itemsFull?: Record<string, ItemFullInfo>): string {
  const texture = itemsFull?.[itemId]?.texture;
  const stem = texture || itemId;
  return stem
    .replace(/^item_custom\//, "")
    .replace(/^custom\//, "")
    .replace(/^item_/, "")
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/-/g, "_");
}

export function itemDisplayName(itemId: string, itemsFull?: Record<string, ItemFullInfo>): string {
  return itemsFull?.[itemId]?.name || itemId.replace(/^item_/, "").replace(/_/g, " ");
}

export const SYN_ICON_MAP: Record<string, string> = {
  "Demon Hunter": "demonhunter",
  "Elemental": "element",
  "Faceless": "nraqi",
  "Pandaren": "pandaman",
};

export function synIconName(name: string): string {
  if (SYN_ICON_MAP[name]) return SYN_ICON_MAP[name];
  return name.toLowerCase().replace(/ /g, "");
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const SYNERGY_STEM_TO_NAME: Record<string, string> = {
  demonhunter: "Demon Hunter",
  nraqi: "Faceless",
  pandaman: "Pandaren",
  element: "Elemental",
};

export function parseLineup(
  lineup: string | null,
  unitCosts: Record<string, number>
): { name: string; stars: number }[] {
  if (!lineup) return [];
  return lineup
    .split("|")
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^(.+?)(?:\((\d)\))?$/);
      if (!m) return { name: entry, stars: 1 };
      return { name: m[1], stars: m[2] ? parseInt(m[2]) : 1 };
    })
    .sort(
      (a, b) =>
        b.stars - a.stars ||
        (unitCosts[b.name] || 1) - (unitCosts[a.name] || 1)
    );
}

export function parseSynergies(
  syn: string | null
): { name: string; count: number }[] {
  if (!syn) return [];
  return syn
    .split("|")
    .filter(Boolean)
    .map((entry) => {
      const [raw, count] = entry.split(":");
      const name = SYNERGY_STEM_TO_NAME[raw.toLowerCase()] || capitalize(raw);
      return { name, count: parseInt(count) || 0 };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function parseRelics(relic: string | null): string[] {
  if (!relic) return [];
  return relic.split("|").filter(Boolean);
}

export interface RelicTimelineEntry {
  round: number;
  name: string;
}

/**
 * Parse a player's raw `relic_history` jsonb into a round-ordered list of
 * relic picks. Accepts both the dict shape the backend writes
 * (`{"1": {relic, round}, …}`) and a plain array. Internal `item_*` ids are
 * mapped to display names via `relicsData`, falling back to the raw id when
 * unknown. Returns `[]` for empty/CV-captured rows that carry no history.
 */
export function parseRelicHistory(
  raw: unknown,
  relicsData?: Record<string, RelicInfo>
): RelicTimelineEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const entries: { relic?: unknown; round?: unknown }[] = Array.isArray(raw)
    ? (raw as { relic?: unknown; round?: unknown }[])
    : Object.values(raw as Record<string, { relic?: unknown; round?: unknown }>);
  const out: RelicTimelineEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const rawId = typeof e.relic === "string" ? e.relic : "";
    if (!rawId) continue;
    const round =
      typeof e.round === "number" ? e.round : parseInt(String(e.round)) || 0;
    out.push({ round, name: relicsData?.[rawId]?.name || rawId });
  }
  out.sort((a, b) => a.round - b.round);
  return out;
}

export function parseWL(
  wl: string | null
): { w: number; l: number } | null {
  if (!wl) return null;
  const parts = wl.split("-");
  if (parts.length !== 2) return null;
  return { w: parseInt(parts[0]) || 0, l: parseInt(parts[1]) || 0 };
}

export const RANK_BRACKETS = [
  { rank: "Pawn-1", mmr: 0 },
  { rank: "Pawn-2", mmr: 500 },
  { rank: "Pawn-3", mmr: 580 },
  { rank: "Pawn-4", mmr: 660 },
  { rank: "Pawn-5", mmr: 740 },
  { rank: "Pawn-6", mmr: 820 },
  { rank: "Pawn-7", mmr: 900 },
  { rank: "Pawn-8", mmr: 980 },
  { rank: "Pawn-9", mmr: 1060 },
  { rank: "Knight-1", mmr: 1140 },
  { rank: "Knight-2", mmr: 1220 },
  { rank: "Knight-3", mmr: 1300 },
  { rank: "Knight-4", mmr: 1380 },
  { rank: "Knight-5", mmr: 1460 },
  { rank: "Knight-6", mmr: 1540 },
  { rank: "Knight-7", mmr: 1620 },
  { rank: "Knight-8", mmr: 1700 },
  { rank: "Knight-9", mmr: 1780 },
  { rank: "Bishop-1", mmr: 1860 },
  { rank: "Bishop-2", mmr: 1940 },
  { rank: "Bishop-3", mmr: 2020 },
  { rank: "Bishop-4", mmr: 2100 },
  { rank: "Bishop-5", mmr: 2180 },
  { rank: "Bishop-6", mmr: 2260 },
  { rank: "Bishop-7", mmr: 2340 },
  { rank: "Bishop-8", mmr: 2420 },
  { rank: "Bishop-9", mmr: 2500 },
  { rank: "Rook-1", mmr: 2580 },
  { rank: "Rook-2", mmr: 2660 },
  { rank: "Rook-3", mmr: 2740 },
  { rank: "Rook-4", mmr: 2820 },
  { rank: "Rook-5", mmr: 2900 },
  { rank: "Rook-6", mmr: 2980 },
  { rank: "Rook-7", mmr: 3060 },
  { rank: "Rook-8", mmr: 3140 },
  { rank: "Rook-9", mmr: 3220 },
  { rank: "King", mmr: 3300 },
  { rank: "Queen", mmr: 3380 },
] as const;

export const RANK_TIERS = ["Pawn", "Knight", "Bishop", "Rook", "King", "Queen"] as const;
export const NUMBERED_RANK_TIERS = ["Pawn", "Knight", "Bishop", "Rook"] as const;

export function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1 || level > RANK_BRACKETS.length) return "";
  return RANK_BRACKETS[level - 1].rank.replace("-", " ");
}

export function mmrToRank(mmr: number | null | undefined): string {
  if (mmr == null || !Number.isFinite(mmr)) return "";
  let rank: string = RANK_BRACKETS[0].rank;
  for (const bracket of RANK_BRACKETS) {
    if (mmr < bracket.mmr) break;
    rank = bracket.rank;
  }
  return rank.replace("-", " ");
}

export function formatIsoDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7)
    return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`
  );
}
