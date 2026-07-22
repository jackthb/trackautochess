import { synIconName } from "@dac/shared/game-utils";
import { synergiesData } from "@/generated/content-data";
import { slugifyName } from "@/lib/slugs";
import { DEFAULT_LOCALE, type Locale, pickLocalized } from "@/lib/i18n";

interface SynergyInfo {
  name: string;
  description: string;
  lore: string;
  commentary?: string;
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
  lore_i18n?: Record<string, string>;
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
}

export interface DisplaySynergy {
  /** Optional CMS identity, reserved for editor integrations. */
  _id?: string;
  _type?: string;
  slug: string;
  name: string;
  description: string;
  lore: string;
  commentary?: string;
  iconStem: string;
  iconUrl: string;
  iconDimensions: { width: number; height: number } | null;
  category: "species" | "class" | "other";
}

function normalizeDescription(desc: string): string {
  return desc
    .replace(/\bspecies perk\b/gi, "SPECIES TRAIT")
    .replace(/\bspecies trait\b/gi, "SPECIES TRAIT")
    .replace(/\bclass perk\b/gi, "CLASS PERK");
}

function buildSynergiesForLocale(locale: Locale): DisplaySynergy[] {
  return Object.values(synergiesData as Record<string, SynergyInfo>)
    .filter((syn) => syn.name && syn.name.trim())
    .map((syn) => {
      const stem = synIconName(syn.name);
      // Slug always derives from the English canonical name so URLs are
      // stable across locales.
      const slug = slugifyName(syn.name);
      const description = normalizeDescription(
        pickLocalized(syn.descriptions, locale) || syn.description || "",
      );
      const localizedName = pickLocalized(syn.names, locale) || syn.name;
      const lore = pickLocalized(syn.lore_i18n, locale) || syn.lore || "";
      return {
        slug,
        name: localizedName,
        description,
        lore,
        commentary: syn.commentary,
        iconStem: stem,
        iconUrl: syn.icon_url || `/icons/synergies/${stem}.png`,
        iconDimensions: syn.icon_dimensions ?? null,
        // Category infers from English description so it doesn't drift
        // when a description happens to translate "class perk" loosely.
        category: inferCategory(syn.description ?? ""),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

function inferCategory(description: string): "species" | "class" | "other" {
  const lower = description.toLowerCase();
  if (lower.includes("species trait")) return "species";
  if (lower.includes("class perk")) return "class";
  return "other";
}

const SYNERGY_CACHE = new Map<Locale, DisplaySynergy[]>();
const SLUG_CACHE = new Map<Locale, Map<string, DisplaySynergy>>();

function ensureLoaded(locale: Locale) {
  if (!SYNERGY_CACHE.has(locale)) {
    const list = buildSynergiesForLocale(locale);
    SYNERGY_CACHE.set(locale, list);
    SLUG_CACHE.set(locale, new Map(list.map((syn) => [syn.slug, syn])));
  }
}

export function getAllSynergies(locale: Locale = DEFAULT_LOCALE): DisplaySynergy[] {
  ensureLoaded(locale);
  return SYNERGY_CACHE.get(locale)!;
}

export function getSynergyBySlug(
  slug: string,
  locale: Locale = DEFAULT_LOCALE,
): DisplaySynergy | null {
  ensureLoaded(locale);
  return SLUG_CACHE.get(locale)!.get(slug) ?? null;
}

export function getSpecies(locale: Locale = DEFAULT_LOCALE): DisplaySynergy[] {
  return getAllSynergies(locale).filter((syn) => syn.category === "species");
}

export function getClasses(locale: Locale = DEFAULT_LOCALE): DisplaySynergy[] {
  return getAllSynergies(locale).filter((syn) => syn.category === "class");
}

/**
 * Returns a function that maps an English synergy name (the form units
 * store in their `synergies` array) to the active locale's display name.
 * Use at render time to show localized synergy names alongside units —
 * the unit's stored synergies stay English-canonical so cross-language
 * lookups remain stable.
 */
export function getSynergySlugByName(name: string): string | null {
  ensureLoaded(DEFAULT_LOCALE);
  const bare = name.replace(/\s*-\s+.*$/, "").replace(/\s*\(.*\)$/, "").trim();
  const slug = slugifyName(bare);
  return SLUG_CACHE.get(DEFAULT_LOCALE)!.has(slug) ? slug : null;
}

export function getSynergyNameTranslator(
  locale: Locale,
): (englishName: string) => string {
  if (locale === DEFAULT_LOCALE) return (n) => n;
  const localizedBySlug = new Map(
    getAllSynergies(locale).map((s) => [s.slug, s]),
  );
  const map = new Map<string, string>();
  for (const e of getAllSynergies(DEFAULT_LOCALE)) {
    const l = localizedBySlug.get(e.slug);
    if (l) map.set(e.name, l.name);
  }
  return (en) => map.get(en) ?? en;
}

const SYNERGY_TIERS_BY_NAME: Record<string, number[]> = (() => {
  const map: Record<string, number[]> = {};
  for (const info of Object.values(
    synergiesData as Record<string, { name?: string; tiers?: number[] }>,
  )) {
    if (info?.name && Array.isArray(info.tiers) && info.tiers.length > 0) {
      map[info.name] = info.tiers;
    }
  }
  return map;
})();

/** Highest synergy tier threshold satisfied by `count` (Beasts ×3 with tiers 2/4/6 → 2). */
export function getActiveSynergyTier(name: string, count: number): number {
  const tiers = SYNERGY_TIERS_BY_NAME[name];
  if (!tiers) return count;
  let active = tiers[0];
  for (const tier of tiers) {
    if (count >= tier) active = tier;
  }
  return active;
}
