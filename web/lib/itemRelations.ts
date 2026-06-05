import { itemLinksData } from "@/generated/content-data";
import { getAllItems, getItemSlugByName, iconUrl, type DisplayItem } from "@/lib/items";
import { getAllSynergies, getSynergySlugByName, type DisplaySynergy } from "@/lib/synergies";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

export type ItemRelationCategory =
  | "counts_as_synergy"
  | "synergy_reward"
  | "generated_token"
  | "generated_item";

export interface ItemRelation {
  item?: string;
  relic?: string;
  relatedItem?: string;
  synergy?: string;
  category: ItemRelationCategory;
  label: string;
  description: string;
}

export interface RelatedItemLink {
  item: DisplayItem;
  relation: ItemRelation;
}

export interface RelatedSynergyLink {
  synergy: DisplaySynergy;
  relation: ItemRelation;
}

const RELATIONS = (itemLinksData as { links: ItemRelation[] }).links;

export const ITEM_RELATION_CATEGORY_LABEL: Record<ItemRelationCategory, string> = {
  counts_as_synergy: "Synergy-enabling item",
  synergy_reward: "Synergy reward",
  generated_token: "Generated token",
  generated_item: "Generated item",
};

export function getItemRelations(): ItemRelation[] {
  return RELATIONS;
}

export function getRelatedItemsForSynergy(
  synergyName: string,
  locale: Locale = DEFAULT_LOCALE,
): RelatedItemLink[] {
  const itemsBySlug = new Map(getAllItems(locale).map((item) => [item.slug, item]));
  return RELATIONS.filter((link) => link.synergy === synergyName && link.item)
    .map((relation) => {
      const slug = relation.item ? getItemSlugByName(relation.item) : null;
      const item = slug ? itemsBySlug.get(slug) : null;
      return item ? { item, relation } : null;
    })
    .filter((entry): entry is RelatedItemLink => entry !== null);
}

export function getRelatedItemsForItem(
  itemName: string,
  locale: Locale = DEFAULT_LOCALE,
): RelatedItemLink[] {
  const itemsBySlug = new Map(getAllItems(locale).map((item) => [item.slug, item]));
  return RELATIONS.filter((link) => link.item === itemName && link.relatedItem)
    .map((relation) => {
      const slug = relation.relatedItem
        ? getItemSlugByName(relation.relatedItem)
        : null;
      const item = slug ? itemsBySlug.get(slug) : null;
      return item ? { item, relation } : null;
    })
    .filter((entry): entry is RelatedItemLink => entry !== null);
}

export function getRelatedItemsForRelic(
  relicName: string,
  locale: Locale = DEFAULT_LOCALE,
): RelatedItemLink[] {
  const itemsBySlug = new Map(getAllItems(locale).map((item) => [item.slug, item]));
  return RELATIONS.filter((link) => link.relic === relicName && link.relatedItem)
    .map((relation) => {
      const slug = relation.relatedItem
        ? getItemSlugByName(relation.relatedItem)
        : null;
      const item = slug ? itemsBySlug.get(slug) : null;
      return item ? { item, relation } : null;
    })
    .filter((entry): entry is RelatedItemLink => entry !== null);
}

export function getRelatedSynergiesForItem(
  itemName: string,
  locale: Locale = DEFAULT_LOCALE,
): RelatedSynergyLink[] {
  const synergiesBySlug = new Map(
    getAllSynergies(locale).map((synergy) => [synergy.slug, synergy]),
  );
  return RELATIONS.filter((link) => link.item === itemName)
    .map((relation) => {
      if (!relation.synergy) return null;
      const slug = getSynergySlugByName(relation.synergy);
      const synergy = slug ? synergiesBySlug.get(slug) : null;
      return synergy ? { synergy, relation } : null;
    })
    .filter((entry): entry is RelatedSynergyLink => entry !== null);
}

export function relatedItemIcon(item: DisplayItem): string {
  return iconUrl(item);
}
