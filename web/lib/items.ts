import { itemsFullData, itemsSimpleData } from "@/generated/content-data";
import { slugifyName } from "@/lib/slugs";
import { DEFAULT_LOCALE, type Locale, pickLocalized } from "@/lib/i18n";

interface FullItem {
  name: string;
  description: string;
  lore: string;
  quality: string;
  texture: string;
  notes: string[];
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
  lore_i18n?: Record<string, string>;
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
}

interface SimpleItem {
  tier?: number;
  icon?: string;
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
}

export interface DisplayItem {
  /** Optional CMS identity, reserved for editor integrations. */
  _id?: string;
  _type?: string;
  slug: string;
  name: string;
  description: string;
  lore: string;
  quality: string;
  notes: string[];
  tier: number;
  icon: string;
  texture: string;
  /**
   * Resolved icon URL: remote URL when present, otherwise the local
   * `/icons/items/<file>.png` fallback (synced from data/icons at build time).
   */
  iconUrl: string;
  iconDimensions: { width: number; height: number } | null;
}

export const TIER_LABEL: Record<number, string> = {
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
  4: "Tier 4",
  5: "Tier 5",
  0: "Special",
};

export const TIER_COLOR: Record<number, string> = {
  1: "var(--text-secondary)",
  2: "#5a8fd5",
  3: "#4eaa62",
  4: "#a85fd2",
  5: "var(--gold)",
  0: "var(--accent-dim)",
};

function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").replace(/'/g, "");
}

// Raw descriptions still carry fullwidth CJK punctuation from the VPK extract
// (e.g. "Armor +5。"). Map the punctuation we see in practice back to ASCII.
const CJK_PUNCT: Record<string, string> = {
  "。": ".",
  "，": ",",
  "、": ",",
  "！": "!",
  "？": "?",
  "：": ":",
  "；": ";",
  "（": "(",
  "）": ")",
};

function normalizePunct(value: string): string {
  return value
    .replace(/[　-〿＀-￯]/g, (ch) => CJK_PUNCT[ch] ?? ch)
    .replace(/\.\s*\./g, ".");
}

function buildItemsForLocale(locale: Locale): DisplayItem[] {
  const simple = (itemsSimpleData as { items: Record<string, SimpleItem> }).items;
  const fullByNorm = new Map<string, FullItem>();

  for (const value of Object.values(itemsFullData as Record<string, FullItem>)) {
    if (!value.name?.trim()) continue;
    fullByNorm.set(norm(value.name), value);
  }

  return Object.keys(simple)
    .map((simpleName) => {
      const basic = simple[simpleName];
      const full = fullByNorm.get(norm(simpleName));
      // Slug always uses the English canonical name so URLs are stable
      // across locales.
      const canonicalName = full?.name ?? simpleName;
      const localizedName = full
        ? pickLocalized(full.names, locale) || full.name
        : simpleName;
      const remoteUrl = basic?.icon_url || full?.icon_url || null;
      const localUrl = legacyIconUrl({ icon: basic?.icon ?? "", texture: full?.texture ?? "" });

      return {
        slug: slugifyName(canonicalName),
        name: localizedName,
        description: normalizePunct(
          pickLocalized(full?.descriptions, locale) || full?.description || "",
        ),
        lore: normalizePunct(
          pickLocalized(full?.lore_i18n, locale) || full?.lore || "",
        ),
        quality: full?.quality ?? "",
        notes: (full?.notes ?? []).map(normalizePunct),
        tier: basic?.tier ?? 0,
        icon: basic?.icon ?? "",
        texture: full?.texture ?? "",
        iconUrl: remoteUrl || localUrl,
        iconDimensions: basic?.icon_dimensions ?? full?.icon_dimensions ?? null,
      };
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.name.localeCompare(b.name, locale);
    });
}

const ITEMS_CACHE = new Map<Locale, DisplayItem[]>();
const ITEMS_BY_SLUG_CACHE = new Map<Locale, Map<string, DisplayItem>>();

function ensureLoaded(locale: Locale) {
  if (!ITEMS_CACHE.has(locale)) {
    const list = buildItemsForLocale(locale);
    ITEMS_CACHE.set(locale, list);
    ITEMS_BY_SLUG_CACHE.set(locale, new Map(list.map((item) => [item.slug, item])));
  }
}

export function getAllItems(locale: Locale = DEFAULT_LOCALE): DisplayItem[] {
  ensureLoaded(locale);
  return ITEMS_CACHE.get(locale)!;
}

export function getItemBySlug(
  slug: string,
  locale: Locale = DEFAULT_LOCALE,
): DisplayItem | null {
  ensureLoaded(locale);
  return ITEMS_BY_SLUG_CACHE.get(locale)!.get(slug) ?? null;
}

export function getItemSlugByName(name: string): string | null {
  ensureLoaded(DEFAULT_LOCALE);
  const slug = slugifyName(name);
  return ITEMS_BY_SLUG_CACHE.get(DEFAULT_LOCALE)!.has(slug) ? slug : null;
}

/**
 * Resolve an icon URL. Prefers the remote URL when `iconUrl` is set on
 * the DisplayItem, falls back to the local `/icons/items/<file>.png` path
 * (synced from data/icons at build time) otherwise.
 *
 * Accepts either a full DisplayItem (uses its precomputed iconUrl) or a
 * lighter shape derived from content item data.
 */
export function iconUrl(
  item: Partial<Pick<DisplayItem, "iconUrl">> & Pick<DisplayItem, "icon" | "texture">
): string {
  if (item.iconUrl) return item.iconUrl;
  return legacyIconUrl(item);
}

function legacyIconUrl(item: Pick<DisplayItem, "icon" | "texture">): string {
  if (item.icon) return `/icons/items/${item.icon}`;
  const stem = (item.texture || "")
    .replace(/^item_custom\//, "")
    .replace(/^custom\//, "")
    .replace(/^item_/, "");
  return stem ? `/icons/items/${stem}.png` : "";
}
