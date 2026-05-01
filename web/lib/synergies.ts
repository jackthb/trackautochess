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
  category: "species" | "class" | "other";
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
      category: inferCategory(syn.description ?? ""),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inferCategory(description: string): "species" | "class" | "other" {
  const lower = description.toLowerCase();
  if (lower.includes("species trait")) return "species";
  if (lower.includes("class perk")) return "class";
  return "other";
}

const ALL_SYNERGIES = buildSynergies();
const SYNERGIES_BY_SLUG = new Map(ALL_SYNERGIES.map((syn) => [syn.slug, syn]));

export function getAllSynergies(): DisplaySynergy[] {
  return ALL_SYNERGIES;
}

export function getSynergyBySlug(slug: string): DisplaySynergy | null {
  return SYNERGIES_BY_SLUG.get(slug) ?? null;
}

export function getSpecies(): DisplaySynergy[] {
  return ALL_SYNERGIES.filter((syn) => syn.category === "species");
}

export function getClasses(): DisplaySynergy[] {
  return ALL_SYNERGIES.filter((syn) => syn.category === "class");
}
