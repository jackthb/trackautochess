import { relicStem } from "@dac/shared/game-utils";
import { relicsData } from "@/generated/content-data";
import { createLocaleRegistry } from "@/lib/localeRegistry";
import { slugifyName } from "@/lib/slugs";
import { DEFAULT_LOCALE, type Locale, pickLocalized } from "@/lib/i18n";

/** Raw relic record shape emitted into generated content data. */
export interface RawRelic {
  name: string;
  description: string;
  commentary?: string;
  lore: string;
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
  lore_i18n?: Record<string, string>;
  icon?: string | null;
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
  hidden?: boolean;
  [key: string]: unknown;
}

const RELICS_MAP = (relicsData as { relics: Record<string, RawRelic> }).relics;

/**
 * Raw relic records keyed by internal item id (e.g. "item_super_uprank").
 * Single accessor so callers don't each unwrap the generated JSON shape.
 */
export function getRelicsMap(): Record<string, RawRelic> {
  return RELICS_MAP;
}

export interface DisplayRelic {
  /** Optional CMS identity, reserved for editor integrations. */
  _id?: string;
  _type?: string;
  slug: string;
  name: string;
  description: string;
  commentary: string;
  lore: string;
  /** Where the relic is acquired, in English (e.g. "Relic Chest"). Empty when
   *  the game ships no acquisition line for it. */
  source: string;
  iconStem: string;
  iconUrl: string;
  iconDimensions: { width: number; height: number } | null;
}

// Relics have no English flavour lore — the game only ships a Chinese
// acquisition line (the `来自：…` = "From: …" string in lore_i18n). We surface
// that as a plain English source fact rather than leaving relic pages blank.
// Keyed on the Simplified value, which every relic carries.
const RELIC_SOURCE_EN: Record<string, string> = {
  "来自：圣物宝箱": "Relic Chest",
  "来自：放弃圣物选择": "Forgoing a relic choice",
};

function relicSource(relic: RawRelic): string {
  const zh = relic.lore_i18n?.["zh-cn"] || relic.lore_i18n?.["zh-tw"] || "";
  return RELIC_SOURCE_EN[zh] ?? "";
}

function buildRelicsForLocale(locale: Locale): DisplayRelic[] {
  return Object.values(RELICS_MAP)
    .filter((relic) => relic.name && relic.name.trim() && !relic.hidden)
    .map((relic) => {
      const stem = relicStem(relic.name);
      const localizedName = pickLocalized(relic.names, locale) || relic.name;
      const description =
        pickLocalized(relic.descriptions, locale) || relic.description;
      const commentary = relic.commentary || "";
      const lore = pickLocalized(relic.lore_i18n, locale) || relic.lore || "";
      return {
        // Slug always uses the English canonical name.
        slug: slugifyName(relic.name),
        name: localizedName,
        description,
        commentary,
        lore,
        source: relicSource(relic),
        iconStem: stem,
        iconUrl: relic.icon_url || `/icons/relics/${stem}.png`,
        iconDimensions: relic.icon_dimensions ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

const RELICS = createLocaleRegistry(buildRelicsForLocale, (relic) => relic.slug);

export function getAllRelics(locale: Locale = DEFAULT_LOCALE): DisplayRelic[] {
  return RELICS.getAll(locale);
}

export function getRelicBySlug(
  slug: string,
  locale: Locale = DEFAULT_LOCALE,
): DisplayRelic | null {
  return RELICS.getByKey(slug, locale);
}
