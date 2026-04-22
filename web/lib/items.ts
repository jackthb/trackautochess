import itemsFull from "@data/items_full.json";
import itemsSimple from "@data/items.json";
import { slugifyName } from "@/lib/slugs";

interface FullItem {
  name: string;
  description: string;
  lore: string;
  quality: string;
  texture: string;
  notes: string[];
}

interface SimpleItem {
  tier: number;
  icon: string;
}

export interface DisplayItem {
  slug: string;
  name: string;
  description: string;
  lore: string;
  quality: string;
  notes: string[];
  tier: number;
  icon: string;
  texture: string;
}

export const TIER_LABEL: Record<number, string> = {
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
  4: "Tier 4",
  5: "Tier 5",
};

export const TIER_COLOR: Record<number, string> = {
  1: "var(--text-secondary)",
  2: "#5a8fd5",
  3: "#4eaa62",
  4: "#a85fd2",
  5: "var(--gold)",
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

function buildItems(): DisplayItem[] {
  const simple = (itemsSimple as { items: Record<string, SimpleItem> }).items;
  const fullByNorm = new Map<string, FullItem>();

  for (const value of Object.values(itemsFull as Record<string, FullItem>)) {
    if (!value.name?.trim()) continue;
    fullByNorm.set(norm(value.name), value);
  }

  return Object.entries(simple)
    .map(([simpleName, basic]) => {
      const full = fullByNorm.get(norm(simpleName));
      const name = full?.name ?? simpleName;

      return {
        slug: slugifyName(name),
        name,
        description: normalizePunct(full?.description ?? ""),
        lore: normalizePunct(full?.lore ?? ""),
        quality: full?.quality ?? "",
        notes: (full?.notes ?? []).map(normalizePunct),
        tier: basic.tier,
        icon: basic.icon,
        texture: full?.texture ?? "",
      };
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.name.localeCompare(b.name);
    });
}

const ALL_ITEMS = buildItems();
const ITEMS_BY_SLUG = new Map(ALL_ITEMS.map((item) => [item.slug, item]));

export function getAllItems(): DisplayItem[] {
  return ALL_ITEMS;
}

export function getItemBySlug(slug: string): DisplayItem | null {
  return ITEMS_BY_SLUG.get(slug) ?? null;
}

export function getItemSlugByName(name: string): string | null {
  const slug = slugifyName(name);
  return ITEMS_BY_SLUG.has(slug) ? slug : null;
}

export function iconUrl(item: Pick<DisplayItem, "icon" | "texture">): string {
  if (item.icon) return `/icons/items/${item.icon}`;
  const stem = (item.texture || "")
    .replace(/^item_custom\//, "")
    .replace(/^custom\//, "")
    .replace(/^item_/, "");
  return stem ? `/icons/items/${stem}.png` : "";
}
