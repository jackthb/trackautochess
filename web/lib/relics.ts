import { relicStem } from "@dac/shared/game-utils";
import { relicsData } from "@/generated/content-data";
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
  iconStem: string;
  iconUrl: string;
  iconDimensions: { width: number; height: number } | null;
}

function buildRelicsForLocale(locale: Locale): DisplayRelic[] {
  return Object.values(RELICS_MAP)
    .filter((relic) => relic.name && relic.name.trim())
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
        iconStem: stem,
        iconUrl: relic.icon_url || `/icons/relics/${stem}.png`,
        iconDimensions: relic.icon_dimensions ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

const RELICS_CACHE = new Map<Locale, DisplayRelic[]>();
const RELICS_BY_SLUG_CACHE = new Map<Locale, Map<string, DisplayRelic>>();

function ensureLoaded(locale: Locale) {
  if (!RELICS_CACHE.has(locale)) {
    const list = buildRelicsForLocale(locale);
    RELICS_CACHE.set(locale, list);
    RELICS_BY_SLUG_CACHE.set(locale, new Map(list.map((r) => [r.slug, r])));
  }
}

export function getAllRelics(locale: Locale = DEFAULT_LOCALE): DisplayRelic[] {
  ensureLoaded(locale);
  return RELICS_CACHE.get(locale)!;
}

export function getRelicBySlug(
  slug: string,
  locale: Locale = DEFAULT_LOCALE,
): DisplayRelic | null {
  ensureLoaded(locale);
  return RELICS_BY_SLUG_CACHE.get(locale)!.get(slug) ?? null;
}

export function getRelicSlugByName(name: string): string | null {
  ensureLoaded(DEFAULT_LOCALE);
  const slug = slugifyName(name);
  return RELICS_BY_SLUG_CACHE.get(DEFAULT_LOCALE)!.has(slug) ? slug : null;
}
