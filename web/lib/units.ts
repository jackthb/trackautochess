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

export function getAllUnits(): DisplayUnit[] {
  return ALL_UNITS;
}

export function getUnitBySlug(slug: string): DisplayUnit | null {
  return UNITS_BY_SLUG.get(slug) ?? null;
}
