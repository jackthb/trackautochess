import { unitStem } from "@dac/shared/game-utils";
import unitsFullData from "@data/units_full.json";
// units.json is imported solely for its top-level `aliases` map (a handful of
// alt spellings → canonical names). Cost/synergy data is read from the full
// file below; once `aliases` is relocated this import goes away entirely.
import unitsAliasData from "@data/units.json";
import { slugifyName } from "@/lib/slugs";
import { DEFAULT_LOCALE, type Locale, pickLocalized } from "@/lib/i18n";

interface UnitInfo {
  cost: number;
  synergies?: string[];
  names?: Record<string, string>;
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
}

export interface DisplayUnit {
  slug: string;
  name: string;
  cost: number;
  synergies: string[];
  iconStem: string;
  /**
   * Resolved icon URL: Sanity CDN URL when uploaded, otherwise the local
   * `/icons/units/<stem>.png` path served from web/public/icons (synced from
   * data/icons by web/scripts/sync-icons.mjs).
   */
  iconUrl: string;
  iconDimensions: { width: number; height: number } | null;
}

function buildUnitsForLocale(locale: Locale): DisplayUnit[] {
  return Object.entries(unitsFullData as Record<string, UnitInfo>)
    .map(([canonicalName, data]) => {
      const stem = unitStem(canonicalName);
      // Slug uses the English canonical name for stable URLs across locales.
      const localizedName = pickLocalized(data.names, locale) || canonicalName;
      return {
        slug: slugifyName(canonicalName),
        name: localizedName,
        cost: data.cost ?? 0,
        synergies: data.synergies ?? [],
        iconStem: stem,
        iconUrl: data.icon_url || `/icons/units/${stem}.png`,
        iconDimensions: data.icon_dimensions ?? null,
      };
    })
    .sort((a, b) => {
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.name.localeCompare(b.name, locale);
    });
}

const UNIT_CACHE = new Map<Locale, DisplayUnit[]>();
const UNIT_BY_SLUG_CACHE = new Map<Locale, Map<string, DisplayUnit>>();

function ensureLoaded(locale: Locale) {
  if (!UNIT_CACHE.has(locale)) {
    const list = buildUnitsForLocale(locale);
    UNIT_CACHE.set(locale, list);
    UNIT_BY_SLUG_CACHE.set(locale, new Map(list.map((unit) => [unit.slug, unit])));
  }
}

export const COST_LABEL: Record<number, string> = {
  1: "Cost 1",
  2: "Cost 2",
  3: "Cost 3",
  4: "Cost 4",
  5: "Cost 5",
};

export const COST_COLOR: Record<number, string> = {
  1: "#c6ccd8",
  2: "#8ac66e",
  3: "#6aa7ff",
  4: "#d997ff",
  5: "#f2bc64",
};

export function getAllUnits(locale: Locale = DEFAULT_LOCALE): DisplayUnit[] {
  ensureLoaded(locale);
  return UNIT_CACHE.get(locale)!;
}

export function getUnitsByCost(
  locale: Locale = DEFAULT_LOCALE,
): DisplayUnit[][] {
  const tiers: DisplayUnit[][] = [[], [], [], [], []];
  for (const unit of getAllUnits(locale)) {
    if (unit.cost < 1 || unit.cost > 5) continue;
    tiers[unit.cost - 1].push(unit);
  }
  return tiers;
}

export function getUnitBySlug(
  slug: string,
  locale: Locale = DEFAULT_LOCALE,
): DisplayUnit | null {
  ensureLoaded(locale);
  return UNIT_BY_SLUG_CACHE.get(locale)!.get(slug) ?? null;
}

const UNIT_SLUG_ALIASES: Record<string, string> = {
  spectre: "spectres",
  bloodseeker: "blood-seeker",
  "soul-breaker": "spirit-breaker",
  "dark-seer": "darkseer",
  "terror-blade": "terrorblade",
  "centaur-warrior": "centaur-warrunner",
  abbadon: "abaddon",
  "beast-master": "beastmaster",
  "chao-knight": "chaos-knight",
  "tide-hunter": "tidehunter",
  "elter-titan": "elder-titan",
  "ring-master": "ringmaster",
  worlock: "warlock",
  necrolyte: "necrophos",
  antimage: "anti-mage",
  "life-stealer": "lifestealer",
};

export function getUnitSlugByName(name: string): string | null {
  ensureLoaded(DEFAULT_LOCALE);
  const cache = UNIT_BY_SLUG_CACHE.get(DEFAULT_LOCALE)!;

  const bare = name.replace(/\s*-\s+.*$/, "").replace(/\s*\(.*\)$/, "").trim();
  const slug = slugifyName(bare);
  if (cache.has(slug)) return slug;

  const aliased = UNIT_SLUG_ALIASES[slug];
  if (aliased && cache.has(aliased)) return aliased;

  return null;
}

// ── Lineup lookups: unit name → cost / synergies ─────────────────────────────
// The match and game pages (and their OG image handlers) resolve a unit *name*
// — as it appears in a stored lineup string, including a few alias spellings —
// to its cost and synergy list. This was duplicated inline in four files;
// it now lives here, built once from units_full.json plus the alias map.

function buildNameLookups() {
  const cost: Record<string, number> = {};
  const synergies: Record<string, string[]> = {};
  for (const [name, data] of Object.entries(
    unitsFullData as Record<string, UnitInfo>,
  )) {
    cost[name] = data.cost ?? 0;
    if (data.synergies) synergies[name] = data.synergies;
  }
  const aliases =
    (unitsAliasData as { aliases?: Record<string, string> }).aliases ?? {};
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (cost[canonical] !== undefined) cost[alias] = cost[canonical];
    if (synergies[canonical]) synergies[alias] = synergies[canonical];
  }
  return { cost, synergies };
}

const NAME_LOOKUPS = buildNameLookups();

/** Unit name (including alias spellings) → buy cost. Pass to parseLineup(). */
export const UNIT_COSTS: Readonly<Record<string, number>> = NAME_LOOKUPS.cost;

/** Unit name (including alias spellings) → synergy list. */
export const UNIT_SYNERGIES: Readonly<Record<string, string[]>> =
  NAME_LOOKUPS.synergies;

/**
 * Derive active synergies from a lineup when the stored synergies field is
 * empty: count synergy occurrences across the lineup, keep those with 2+,
 * sorted by count descending.
 */
export function computeSynergies(
  lineup: { name: string; stars: number }[],
): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const u of lineup) {
    for (const syn of UNIT_SYNERGIES[u.name] || []) {
      counts[syn] = (counts[syn] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .filter((s) => s.count > 1)
    .sort((a, b) => b.count - a.count);
}
