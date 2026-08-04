import type { ItemFullInfo, RelicInfo } from "./types";

/**
 * Placement/cost palettes live here as single tables so every surface agrees.
 *
 * Renderers that can read CSS custom properties use the `var(--…)` variants;
 * renderers that cannot — Satori/`ImageResponse` in the OG routes — use the
 * `…Hex` variants. Both are derived from the same tier lookup, so a palette
 * change lands everywhere at once instead of drifting per call site.
 */
export type PlacementTier = "first" | "top3" | "fourth" | "bottom";

export function placementTier(p: number): PlacementTier {
  if (p === 1) return "first";
  if (p <= 3) return "top3";
  if (p === 4) return "fourth";
  return "bottom";
}

const PLACEMENT_COLOR_VAR: Record<PlacementTier, string> = {
  first: "var(--gold)",
  top3: "var(--silver)",
  fourth: "var(--text-secondary)",
  bottom: "var(--red-bright)",
};

// Resolved values of the tokens above (see shared/tokens.css).
const PLACEMENT_COLOR_HEX: Record<PlacementTier, string> = {
  first: "#c9a84c",
  top3: "#8a92a8",
  fourth: "#9096ac",
  bottom: "#c44e4e",
};

const PLACEMENT_BG: Record<PlacementTier, string> = {
  first: "rgba(201,168,76,0.08)",
  top3: "rgba(138,146,168,0.05)",
  fourth: "transparent",
  bottom: "rgba(155,58,58,0.05)",
};

export function placementColor(p: number): string {
  return PLACEMENT_COLOR_VAR[placementTier(p)];
}

export function placementColorHex(p: number): string {
  return PLACEMENT_COLOR_HEX[placementTier(p)];
}

export function placementBg(p: number): string {
  return PLACEMENT_BG[placementTier(p)];
}

const COST_BORDER_COLOR: Record<number, string> = {
  1: "#5c6278",
  2: "#5a8fd5",
  3: "#2a4a8a",
  4: "#c44ea0",
  5: "#c9a84c",
};

/** Already a literal hex, so it doubles as the OG-image (Satori) palette. */
export function costBorderColor(cost: number): string {
  return COST_BORDER_COLOR[cost] ?? COST_BORDER_COLOR[1];
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

export function normalizeDisplaySynergyCount(name: string, count: number): number {
  if (name.toLowerCase() === "demon") return Math.min(count, 1);
  return count;
}

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
      return { name, count: normalizeDisplaySynergyCount(name, parseInt(count) || 0) };
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

export function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1) return "";
  if (level > RANK_BRACKETS.length) return "Queen";
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

const SHORT_MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

export function formatIsoDateParts(
  iso: string
): { month: string; day: string; year: string } {
  // Parse YYYY-MM-DD without timezone drift.
  const [year, month, day] = iso.split("-").map((part) => parseInt(part, 10));
  return {
    month: SHORT_MONTHS[(month || 1) - 1] ?? "",
    day: String(day || 1).padStart(2, "0"),
    year: String(year || ""),
  };
}
// ── Shared date/time rendering ───────────────────────────────────────────────
// "Jul 28, 2026" and "14:32" were each being rebuilt inline in several
// components — some with a module-level Intl formatter, some with an ad-hoc
// toLocaleDateString call — which is how the site ended up rendering the same
// kind of value four different ways. These are the two shapes worth sharing.

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Intl formatters are expensive to construct and these render inside lists,
// so keep one per distinct option set.
const mediumDateFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Medium date, e.g. "Jul 28, 2026".
 *
 * Pass `timeZone: "UTC"` for date-only values (a bare `YYYY-MM-DD`, or a
 * timestamp whose calendar date is the fact being shown) so a viewer west of
 * UTC doesn't see the previous day. `fallback` is returned for null/unparseable
 * input and defaults to "".
 */
export function formatMediumDate(
  value: DateInput,
  options: { timeZone?: string; fallback?: string } = {},
): string {
  const date = toDate(value);
  if (!date) return options.fallback ?? "";

  const key = options.timeZone ?? "local";
  let formatter = mediumDateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    });
    mediumDateFormatters.set(key, formatter);
  }
  return formatter.format(date);
}

/**
 * Hour and minute, e.g. "14:32". Renders in the viewer's locale unless
 * `hour12` forces a clock; pass `timeZone: "UTC"` to pin the zone.
 */
export function formatTimeLabel(
  value: DateInput,
  options: { timeZone?: string; hour12?: boolean } = {},
): string {
  const date = toDate(value);
  if (!date) return "";

  const key = `${options.timeZone ?? "local"}|${options.hour12 ?? "auto"}`;
  let formatter = timeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
      ...(options.hour12 === undefined ? {} : { hour12: options.hour12 }),
    });
    timeFormatters.set(key, formatter);
  }
  return formatter.format(date);
}

