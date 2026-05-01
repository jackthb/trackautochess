import { unitStem } from "@dac/shared/game-utils";
import unitsFullData from "@data/units_full.json";
import { slugifyName } from "@/lib/slugs";

interface UnitInfo {
  cost: number;
  synergies?: string[];
}

export interface DisplayUnit {
  slug: string;
  name: string;
  cost: number;
  synergies: string[];
  iconStem: string;
}

function buildUnits(): DisplayUnit[] {
  return Object.entries(unitsFullData as Record<string, UnitInfo>)
    .map(([name, data]) => ({
      slug: slugifyName(name),
      name,
      cost: data.cost ?? 0,
      synergies: data.synergies ?? [],
      iconStem: unitStem(name),
    }))
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
