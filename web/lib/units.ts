import { unitStem } from "@dac/shared/game-utils";
import {
  buildItemSynergyLookup,
  buildSynergyMinCountByName,
  computeLineupSynergies,
  type SynergyCountPiece,
} from "@dac/shared/game-structure";
import type { ItemFullInfo } from "@dac/shared/types";
// aliasesData is a flat { alt-spelling: canonical } map. Cost/synergy data
// comes from content/game/units via the generated runtime module.
import {
  aliasesData,
  abilitiesData,
  itemLinksData,
  itemsFullData,
  synergiesData,
  unitsFullData,
} from "@/generated/content-data";
import { slugifyName } from "@/lib/slugs";
import { DEFAULT_LOCALE, type Locale, pickLocalized } from "@/lib/i18n";

export interface UnitAbility {
  id: string;
  name: string;
  description: string;
  cooldown: string;
  manaCost: string;
  castRange: string;
  abilitySpecial: Record<string, string>;
}

interface UnitAbilitySource {
  id: string;
  name: string;
  description: string;
}

interface AbilityInfo {
  name?: string;
  names?: Record<string, string>;
  description?: string;
  descriptions?: Record<string, string>;
  cooldown?: string;
  mana_cost?: string;
  cast_range?: string;
  ability_special?: Record<string, string>;
}

export interface UnitStats {
  hp: number;
  mana: number;
  atk: number[];
  armor: number;
  magic_resist: number;
  atk_rate: number;
  atk_range: number;
}

export interface UnitStatsByStar {
  "1_star"?: UnitStats;
  "2_star"?: UnitStats;
  "3_star"?: UnitStats;
}

interface UnitInfo {
  cost: number;
  synergies?: string[];
  attack_type?: string;
  abilities?: UnitAbilitySource[] | null;
  stats?: UnitStatsByStar;
  names?: Record<string, string>;
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
  commentary?: string;
}

export interface DisplayUnit {
  /** Optional CMS identity, reserved for editor integrations. */
  _id?: string;
  _type?: string;
  slug: string;
  name: string;
  cost: number;
  synergies: string[];
  attackType: string;
  abilities: UnitAbility[];
  stats: UnitStatsByStar | null;
  iconStem: string;
  /**
   * Resolved icon URL: remote URL when present, otherwise the local
   * `/icons/units/<stem>.png` path served from web/public/icons (synced from
   * data/icons by web/scripts/sync-icons.mjs).
   */
  iconUrl: string;
  iconDimensions: { width: number; height: number } | null;
  /** Editorial commentary authored in the CMS; empty string when none. */
  commentary: string;
}

function resolveAbility(ability: UnitAbilitySource, locale: Locale): UnitAbility {
  const details = (abilitiesData as Record<string, AbilityInfo>)[ability.id];
  return {
    id: ability.id,
    name: pickLocalized(details?.names, locale) || details?.name || ability.name,
    description:
      pickLocalized(details?.descriptions, locale) ||
      details?.description ||
      ability.description,
    cooldown: details?.cooldown ?? "",
    manaCost: details?.mana_cost ?? "",
    castRange: details?.cast_range ?? "",
    abilitySpecial: details?.ability_special ?? {},
  };
}

function buildUnitsForLocale(locale: Locale): DisplayUnit[] {
  return Object.entries(unitsFullData as Record<string, UnitInfo>)
    .map(([canonicalName, data]) => {
      const stem = unitStem(canonicalName);
      // Slug uses the English canonical name for stable URLs across locales.
      const localizedName = pickLocalized(data.names, locale) || canonicalName;
      return {
        slug: slugifyName(canonicalName),
        name: localizedName,
        cost: data.cost ?? 0,
        synergies: data.synergies ?? [],
        attackType: data.attack_type ?? "",
        abilities: (data.abilities ?? []).map((ability) =>
          resolveAbility(ability, locale)
        ),
        stats: data.stats ?? null,
        iconStem: stem,
        iconUrl: data.icon_url || `/icons/units/${stem}.png`,
        iconDimensions: data.icon_dimensions ?? null,
        commentary: data.commentary ?? "",
      };
    })
    .sort((a, b) => {
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.name.localeCompare(b.name, locale);
    });
}

const UNIT_CACHE = new Map<Locale, DisplayUnit[]>();
const UNIT_BY_SLUG_CACHE = new Map<Locale, Map<string, DisplayUnit>>();

function ensureLoaded(locale: Locale) {
  if (!UNIT_CACHE.has(locale)) {
    const list = buildUnitsForLocale(locale);
    UNIT_CACHE.set(locale, list);
    UNIT_BY_SLUG_CACHE.set(locale, new Map(list.map((unit) => [unit.slug, unit])));
  }
}

export const COST_LABEL: Record<number, string> = {
  1: "Cost 1",
  2: "Cost 2",
  3: "Cost 3",
  4: "Cost 4",
  5: "Cost 5",
};

export const COST_COLOR: Record<number, string> = {
  1: "#c6ccd8",
  2: "#8ac66e",
  3: "#6aa7ff",
  4: "#d997ff",
  5: "#f2bc64",
};

export function getAllUnits(locale: Locale = DEFAULT_LOCALE): DisplayUnit[] {
  ensureLoaded(locale);
  return UNIT_CACHE.get(locale)!;
}

export function getUnitsByCost(
  locale: Locale = DEFAULT_LOCALE,
): DisplayUnit[][] {
  const tiers: DisplayUnit[][] = [[], [], [], [], []];
  for (const unit of getAllUnits(locale)) {
    if (unit.cost < 1 || unit.cost > 5) continue;
    tiers[unit.cost - 1].push(unit);
  }
  return tiers;
}

export function getUnitBySlug(
  slug: string,
  locale: Locale = DEFAULT_LOCALE,
): DisplayUnit | null {
  ensureLoaded(locale);
  return UNIT_BY_SLUG_CACHE.get(locale)!.get(slug) ?? null;
}

// ── Lineup lookups: unit name → cost / synergies ─────────────────────────────
// The match and game pages (and their OG image handlers) resolve a unit *name*
// — as it appears in a stored lineup string, including a few alias spellings —
// to its cost and synergy list. This was duplicated inline in four files;
// it now lives here, built once from content/game/units plus the alias map.

function buildNameLookups() {
  const cost: Record<string, number> = {};
  const synergies: Record<string, string[]> = {};
  for (const [name, data] of Object.entries(
    unitsFullData as Record<string, UnitInfo>,
  )) {
    cost[name] = data.cost ?? 0;
    if (data.synergies) synergies[name] = data.synergies;
  }
  const aliases = aliasesData as Record<string, string>;
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (cost[canonical] !== undefined) cost[alias] = cost[canonical];
    if (synergies[canonical]) synergies[alias] = synergies[canonical];
  }
  return { cost, synergies };
}

const NAME_LOOKUPS = buildNameLookups();

/** Unit name (including alias spellings) → buy cost. Pass to parseLineup(). */
export const UNIT_COSTS: Readonly<Record<string, number>> = NAME_LOOKUPS.cost;

/** Unit name (including alias spellings) → synergy list. */
export const UNIT_SYNERGIES: Readonly<Record<string, string[]>> =
  NAME_LOOKUPS.synergies;

// Synergy name → minimum unit count to activate (its first tier). Most
// synergies activate at 2, but a few (Demon, Pandaren) activate at 1. A lineup
// holding a single Beast or Faceless has NOT activated that synergy, so it must
// not be shown; a single Demon HAS.
export const SYNERGY_MIN_COUNT = buildSynergyMinCountByName(
  synergiesData as Record<string, { name: string; tiers?: number[] }>,
);

/** Item id/display name → counts-as synergy (Spider Leg → Aqir, Kobold Cup →
 *  Kobold), keyed by both internal item id and display name. */
export const ITEM_SYNERGIES: Readonly<Record<string, string>> =
  buildItemSynergyLookup(
    itemLinksData as { links?: { item?: string; synergy?: string; category?: string }[] },
    itemsFullData as Record<string, ItemFullInfo>,
  );

/**
 * Derive the active synergies a player actually has from their fielded
 * pieces: unique species per synergy (duplicate copies never add), plus
 * counts-as items (Spider Leg → Aqir, Kobold Cup → Kobold) when pieces carry
 * item data, plus the stored in-game count as a top-up for item-linkable
 * synergies when they don't (`storedSynergies`). Active tiers only, sorted by
 * count descending.
 */
export function computeSynergies(
  pieces: SynergyCountPiece[],
  storedSynergies?: { name: string; count: number }[],
): { name: string; count: number }[] {
  return computeLineupSynergies(pieces, {
    unitSynergies: UNIT_SYNERGIES as Record<string, string[]>,
    synergyMinCount: SYNERGY_MIN_COUNT,
    itemCountsAsSynergy: ITEM_SYNERGIES as Record<string, string>,
    storedSynergies,
  });
}
