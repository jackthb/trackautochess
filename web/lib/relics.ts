import { relicStem } from "@dac/shared/game-utils";
import relicsData from "@data/relics.json";
import { slugifyName } from "@/lib/slugs";

interface RelicInfo {
  name: string;
  description: string;
  lore: string;
}

export interface DisplayRelic {
  slug: string;
  name: string;
  description: string;
  lore: string;
  iconStem: string;
}

function buildRelics(): DisplayRelic[] {
  return Object.values(
    (relicsData as { relics: Record<string, RelicInfo> }).relics
  )
    .filter((relic) => relic.name && relic.name.trim())
    .map((relic) => ({
      slug: slugifyName(relic.name),
      name: relic.name,
      description: relic.description,
      lore: relic.lore,
      iconStem: relicStem(relic.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const ALL_RELICS = buildRelics();
const RELICS_BY_SLUG = new Map(ALL_RELICS.map((relic) => [relic.slug, relic]));

export function getAllRelics(): DisplayRelic[] {
  return ALL_RELICS;
}

export function getRelicBySlug(slug: string): DisplayRelic | null {
  return RELICS_BY_SLUG.get(slug) ?? null;
}

export function getRelicSlugByName(name: string): string | null {
  const slug = slugifyName(name);
  return RELICS_BY_SLUG.has(slug) ? slug : null;
}
