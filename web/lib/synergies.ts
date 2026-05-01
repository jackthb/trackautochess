import { synIconName } from "@dac/shared/game-utils";
import synergiesData from "@data/synergies.json";
import { slugifyName } from "@/lib/slugs";

interface SynergyInfo {
  name: string;
  description: string;
  lore: string;
}

export interface DisplaySynergy {
  slug: string;
  name: string;
  description: string;
  lore: string;
  iconStem: string;
}

function normalizeDescription(desc: string): string {
  return desc
    .replace(/\bspecies perk\b/gi, "SPECIES TRAIT")
    .replace(/\bspecies trait\b/gi, "SPECIES TRAIT")
    .replace(/\bclass perk\b/gi, "CLASS PERK");
}

function buildSynergies(): DisplaySynergy[] {
  return Object.values(synergiesData as Record<string, SynergyInfo>)
    .filter((syn) => syn.name && syn.name.trim())
    .map((syn) => ({
      slug: slugifyName(syn.name),
      name: syn.name,
      description: normalizeDescription(syn.description ?? ""),
      lore: syn.lore ?? "",
      iconStem: synIconName(syn.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const ALL_SYNERGIES = buildSynergies();
const SYNERGIES_BY_SLUG = new Map(ALL_SYNERGIES.map((syn) => [syn.slug, syn]));

export function getAllSynergies(): DisplaySynergy[] {
  return ALL_SYNERGIES;
}

export function getSynergyBySlug(slug: string): DisplaySynergy | null {
  return SYNERGIES_BY_SLUG.get(slug) ?? null;
}
