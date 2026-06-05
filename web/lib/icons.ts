import { relicStem, synIconName, unitStem } from "@dac/shared/game-utils";
import { itemIconStem } from "../../shared/game-utils";
import type { ItemFullInfo } from "../../shared/types";
import {
  itemsFullData,
  relicsData,
  synergiesData,
  unitsFullData,
} from "@/generated/content-data";

interface CmsIconFields {
  icon?: string | null;
  icon_url?: string | null;
}

type IconMap = Record<string, string>;

function iconPath(data: CmsIconFields): string | null {
  if (data.icon) return `/icons/${data.icon}`;
  return data.icon_url ?? null;
}

function buildUnitMap(): IconMap {
  const map: IconMap = {};
  for (const [name, data] of Object.entries(
    unitsFullData as Record<string, CmsIconFields>
  )) {
    const icon = iconPath(data);
    if (icon) map[unitStem(name)] = icon;
  }
  return map;
}

function buildSynergyMap(): IconMap {
  const map: IconMap = {};
  for (const data of Object.values(
    synergiesData as Record<string, CmsIconFields & { name?: string }>
  )) {
    const icon = iconPath(data);
    if (data?.name && icon) {
      map[synIconName(data.name)] = icon;
    }
  }
  return map;
}

function buildRelicMap(): IconMap {
  const map: IconMap = {};
  const relics = (relicsData as { relics: Record<string, CmsIconFields & { name?: string }> }).relics;
  for (const data of Object.values(relics)) {
    const icon = iconPath(data);
    if (data?.name && icon) {
      map[relicStem(data.name)] = icon;
    }
  }
  return map;
}

function buildItemMap(): IconMap {
  const map: IconMap = {};
  const items = itemsFullData as Record<string, ItemFullInfo & CmsIconFields>;
  for (const [id, data] of Object.entries(items)) {
    const icon = iconPath(data);
    if (icon) {
      map[itemIconStem(id, items)] = icon;
    }
  }
  return map;
}

const ICON_MAPS: Record<string, IconMap> = {
  units: buildUnitMap(),
  synergies: buildSynergyMap(),
  relics: buildRelicMap(),
  items: buildItemMap(),
};

/**
 * Resolve icon URL for a stem produced by unitStem/synIconName/relicStem.
 * Returns the committed icon reference from the JSON cache, otherwise falls
 * back to the local /icons/<type>/<stem>.png path served from web/public/icons
 * (synced from data/icons by web/scripts/sync-icons.mjs).
 */
export function resolveIconUrl(type: string, stem: string): string {
  return ICON_MAPS[type]?.[stem] ?? `/icons/${type}/${stem}.png`;
}
