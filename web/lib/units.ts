import { unitStem } from "@dac/shared/game-utils";
import unitsFullData from "@data/units_full.json";
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
