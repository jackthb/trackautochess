import { unitStem, synIconName, relicStem } from "@dac/shared/game-utils";
import unitsFullData from "@data/units_full.json";
import synergiesData from "@data/synergies.json";
import relicsData from "@data/relics.json";

interface CmsIconFields {
  icon_url?: string | null;
}

type IconMap = Record<string, string>;

function buildUnitMap(): IconMap {
  const map: IconMap = {};
  for (const [name, data] of Object.entries(
    unitsFullData as Record<string, CmsIconFields>
  )) {
    if (data?.icon_url) map[unitStem(name)] = data.icon_url;
  }
  return map;
}

function buildSynergyMap(): IconMap {
  const map: IconMap = {};
  for (const data of Object.values(
    synergiesData as Record<string, CmsIconFields & { name?: string }>
  )) {
    if (data?.name && data.icon_url) {
      map[synIconName(data.name)] = data.icon_url;
    }
  }
  return map;
}

function buildRelicMap(): IconMap {
  const map: IconMap = {};
  const relics = (relicsData as { relics: Record<string, CmsIconFields & { name?: string }> }).relics;
  for (const data of Object.values(relics)) {
    if (data?.name && data.icon_url) {
      map[relicStem(data.name)] = data.icon_url;
    }
  }
  return map;
}

const ICON_MAPS: Record<string, IconMap> = {
  units: buildUnitMap(),
  synergies: buildSynergyMap(),
  relics: buildRelicMap(),
};

/**
 * Resolve icon URL for a stem produced by unitStem/synIconName/relicStem.
 * Returns the Sanity-hosted URL when present in the JSON cache, otherwise
 * falls back to the local /icons/<type>/<stem>.png path served from
 * web/public/icons (synced from data/icons by web/scripts/sync-icons.mjs).
 */
export function resolveIconUrl(type: string, stem: string): string {
  return ICON_MAPS[type]?.[stem] ?? `/icons/${type}/${stem}.png`;
}
