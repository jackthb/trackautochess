import {
  itemLinksData,
  itemsFullData,
  relicsData,
} from "@/generated/content-data";
import type { RelatedEntity } from "@/components/EntityDetail";
import { getAllItems, getItemSlugByName, iconUrl, type DisplayItem } from "@/lib/items";
import { getAllSynergies, getSynergySlugByName, type DisplaySynergy } from "@/lib/synergies";
import { getAllRelics } from "@/lib/relics";
import { getAllUnits } from "@/lib/units";
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

interface CmsRelatedEntity {
  entity_type: "unit" | "item" | "synergy" | "relic" | "talent";
  entity_slug: string;
  label?: string;
  description?: string;
}

interface RuntimeEntityWithRelations {
  name: string;
  relatedEntities?: CmsRelatedEntity[];
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
  if (getCmsRelationsForItem(itemName).length > 0) return [];
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
  if (getCmsRelationsForRelic(relicName).length > 0) return [];
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
  if (getCmsRelationsForItem(itemName).length > 0) return [];
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

function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").replace(/'/g, "");
}

function getCmsRelationsForItem(itemName: string): CmsRelatedEntity[] {
  const item = Object.values(
    itemsFullData as Record<string, RuntimeEntityWithRelations>,
  ).find((candidate) => norm(candidate.name) === norm(itemName));
  return item?.relatedEntities ?? [];
}

function getCmsRelationsForRelic(relicName: string): CmsRelatedEntity[] {
  const relic = Object.values(
    (relicsData as { relics: Record<string, RuntimeEntityWithRelations> }).relics,
  ).find((candidate) => norm(candidate.name) === norm(relicName));
  return relic?.relatedEntities ?? [];
}

function resolveCmsRelatedEntity(
  relation: CmsRelatedEntity,
  locale: Locale,
): RelatedEntity | null {
  if (relation.entity_type === "item") {
    const item = getAllItems(locale).find((candidate) => candidate.slug === relation.entity_slug);
    return item
      ? {
          slug: item.slug,
          name: item.name,
          description: relation.description || relation.label,
          iconSrc: iconUrl(item),
          variant: "item",
          level: undefined,
        }
      : null;
  }

  if (relation.entity_type === "relic") {
    const relic = getAllRelics(locale).find((candidate) => candidate.slug === relation.entity_slug);
    return relic
      ? {
          slug: relic.slug,
          name: relic.name,
          description: relation.description || relation.label,
          iconSrc: relic.iconUrl,
          variant: "relic",
        }
      : null;
  }

  if (relation.entity_type === "synergy") {
    const synergy = getAllSynergies(locale).find(
      (candidate) => candidate.slug === relation.entity_slug,
    );
    return synergy
      ? {
          slug: synergy.slug,
          name: synergy.name,
          description: relation.description || relation.label,
          iconSrc: synergy.iconUrl,
          variant: "synergy",
        }
      : null;
  }

  if (relation.entity_type === "unit") {
    const unit = getAllUnits(locale).find((candidate) => candidate.slug === relation.entity_slug);
    return unit
      ? {
          slug: unit.slug,
          name: unit.name,
          description: relation.description || relation.label,
          iconSrc: unit.iconUrl,
          variant: "unit",
        }
      : null;
  }

  return null;
}

export function getRelatedEntitiesForItem(
  itemName: string,
  locale: Locale = DEFAULT_LOCALE,
): RelatedEntity[] {
  return getCmsRelationsForItem(itemName)
    .map((relation) => resolveCmsRelatedEntity(relation, locale))
    .filter((entry): entry is RelatedEntity => entry !== null);
}

export function getRelatedEntitiesForRelic(
  relicName: string,
  locale: Locale = DEFAULT_LOCALE,
): RelatedEntity[] {
  return getCmsRelationsForRelic(relicName)
    .map((relation) => resolveCmsRelatedEntity(relation, locale))
    .filter((entry): entry is RelatedEntity => entry !== null);
}

export function relatedItemIcon(item: DisplayItem): string {
  return iconUrl(item);
}
