import { unitStem } from "@dac/shared/game-utils";
import unitsFullData from "@data/units_full.json";
import { slugifyName } from "@/lib/slugs";

interface UnitInfo {
  cost: number;
  synergies?: string[];
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

function buildUnits(): DisplayUnit[] {
  return Object.entries(unitsFullData as Record<string, UnitInfo>)
    .map(([name, data]) => {
      const stem = unitStem(name);
      return {
        slug: slugifyName(name),
        name,
        cost: data.cost ?? 0,
        synergies: data.synergies ?? [],
        iconStem: stem,
        iconUrl: data.icon_url || `/icons/units/${stem}.png`,
        iconDimensions: data.icon_dimensions ?? null,
      };
    })
    .sort((a, b) => {
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.name.localeCompare(b.name);
    });
}

const ALL_UNITS = buildUnits();
const UNITS_BY_SLUG = new Map(ALL_UNITS.map((unit) => [unit.slug, unit]));

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

export function getAllUnits(): DisplayUnit[] {
  return ALL_UNITS;
}

export function getUnitsByCost(): DisplayUnit[][] {
  const tiers: DisplayUnit[][] = [[], [], [], [], []];
  for (const unit of ALL_UNITS) {
    if (unit.cost < 1 || unit.cost > 5) continue;
    tiers[unit.cost - 1].push(unit);
  }
  return tiers;
}

export function getUnitBySlug(slug: string): DisplayUnit | null {
  return UNITS_BY_SLUG.get(slug) ?? null;
}
