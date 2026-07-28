import type { ItemFullInfo, SynergyInfo, UnitFullInfo } from "./types";
import { normalizeDisplaySynergyCount } from "./game-utils";

export interface UnitCodeInfo {
  name: string;
  cost: number;
  synergies: string[];
}

export interface ResolvedChessUnit {
  name: string;
  stars: number;
}

export interface NettableSynergy {
  /** Raw nettable key, e.g. `is_mage`. */
  key: string;
  /** Nettable stem without the `is_` prefix, e.g. `mage`. */
  stem: string;
  /** Display name from synergies data when known; otherwise title-cased stem. */
  name: string;
  count: number;
  firstTier: number;
  /** How far this count is through its first active tier. */
  score: number;
}

export interface ParseNettableSynergyBuffOptions {
  /** Drop synergies below their first active tier. Defaults to true. */
  activeOnly?: boolean;
  /**
   * Drop active one-piece splashes such as a lone Demon. Useful when inferring
   * a build shape from the local board, but not for displaying exact live state.
   */
  includeOnePieceActive?: boolean;
}

function displayNameFromSynergyKey(key: string): string {
  return key
    .replace(/^is_/, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSynergyInfo(
  keyOrStem: string,
  synergiesData: Record<string, SynergyInfo>,
): SynergyInfo | undefined {
  return synergiesData[keyOrStem] ?? synergiesData[`is_${keyOrStem.replace(/^is_/, "")}`];
}

export function firstSynergyTier(
  keyOrStem: string,
  synergiesData: Record<string, SynergyInfo>,
): number {
  const info = getSynergyInfo(keyOrStem, synergiesData);
  const tier = Array.isArray(info?.tiers) ? info.tiers[0] : undefined;
  return typeof tier === "number" ? tier : 2;
}

export function isSynergyActive(
  synergy: { name: string; count: number },
  synergyMinCount: Record<string, number>,
  wizardDiscount = 0,
  synergyTiers?: Record<string, number[]>,
): boolean {
  const tiers = synergyTiers?.[synergy.name];
  if (tiers && tiers.length > 0) {
    return activeSynergyTier(synergy.count, tiers, wizardDiscount) > 0;
  }
  const minCount = synergyMinCount[synergy.name] ?? 2;
  const required =
    minCount >= WIZARD_DISCOUNT_MIN_TIER ? minCount - wizardDiscount : minCount;
  return synergy.count >= required;
}

export function buildSynergyMinCountByName(
  synergiesData: Record<string, SynergyInfo>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const data of Object.values(synergiesData)) {
    if (data?.name && Array.isArray(data.tiers) && data.tiers.length > 0) {
      map[data.name] = data.tiers[0];
    }
  }
  return map;
}

/** Synergy display name → ascending tier thresholds (Beast → [2, 4, 6]). */
export function buildSynergyTiersByName(
  synergiesData: Record<string, SynergyInfo>,
): Record<string, number[]> {
  const map: Record<string, number[]> = {};
  for (const data of Object.values(synergiesData)) {
    if (data?.name && Array.isArray(data.tiers) && data.tiers.length > 0) {
      map[data.name] = data.tiers;
    }
  }
  return map;
}

export const WIZARD_SYNERGY_NAME = "Wizard";
/** Wizard pieces needed before the threshold discount applies. */
export const WIZARD_DISCOUNT_MIN_PIECES = 2;
/** Only thresholds this large or larger are discounted. */
export const WIZARD_DISCOUNT_MIN_TIER = 4;

/**
 * Wizard's class perk ("Something from Nothing"): with (2) different Wizard
 * pieces on board, every race/class tier that needs (4) or more pieces
 * activates one piece early. Eight Mages therefore activate the 9-Mage tier.
 *
 * The (4) Wizard half of the perk — unlocking every layer of a triggered
 * non-Wizard skill — is a combat-time effect on the skill itself, not on tier
 * activation, so it does not change the tier shown here.
 */
export function wizardTierDiscount(wizardCount: number): number {
  return wizardCount >= WIZARD_DISCOUNT_MIN_PIECES ? 1 : 0;
}

/**
 * The tier a fielded count has activated — the highest threshold it meets,
 * after the Wizard discount. Returns the nominal tier (9), not the discounted
 * requirement (8), because that is the bonus actually in play. 0 = inactive.
 */
export function activeSynergyTier(
  count: number,
  tiers: number[] | undefined,
  discount = 0,
): number {
  if (!tiers || tiers.length === 0) return count;
  let active = 0;
  for (const tier of tiers) {
    const required = tier >= WIZARD_DISCOUNT_MIN_TIER ? tier - discount : tier;
    if (count >= required) active = tier;
  }
  return active;
}

export function filterActiveSynergiesWithThresholds<T extends { name: string; count: number }>(
  synergies: T[],
  synergyMinCount: Record<string, number>,
  wizardDiscount = 0,
  synergyTiers?: Record<string, number[]>,
): T[] {
  return synergies.filter((synergy) =>
    isSynergyActive(synergy, synergyMinCount, wizardDiscount, synergyTiers),
  );
}

/**
 * Parse Drodo's live nettable `buff` string, e.g.
 * `is_mage:6,is_human:3,is_demon:1,`, into active synergy counts using the
 * same first-tier thresholds as the rest of the app.
 */
export function parseNettableSynergyBuff(
  buff: string | undefined,
  synergiesData: Record<string, SynergyInfo>,
  options: ParseNettableSynergyBuffOptions = {},
): NettableSynergy[] {
  if (!buff) return [];
  const { activeOnly = true, includeOnePieceActive = true } = options;
  return buff
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawKey, rawCount] = entry.split(":");
      const key = rawKey.trim();
      const stem = key.replace(/^is_/, "");
      const count = Number(rawCount) || 0;
      const firstTier = firstSynergyTier(key, synergiesData);
      const info = getSynergyInfo(key, synergiesData);
      return {
        key,
        stem,
        name: info?.name || displayNameFromSynergyKey(key),
        count,
        firstTier,
        score: count / Math.max(firstTier || 1, 1),
      };
    })
    .filter((synergy) => {
      if (activeOnly && synergy.count < synergy.firstTier) return false;
      if (!includeOnePieceActive && synergy.firstTier <= 1 && synergy.count <= 1) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return b.count - a.count;
    });
}

/** A fielded piece for synergy counting: display name plus carried items
 *  (ids or display names) when board data is available. */
export interface SynergyCountPiece {
  name: string;
  items?: string[];
}

export interface ComputeLineupSynergiesOptions {
  /** Unit display name → synergy display names ("Aqir", "Demon Hunter", …). */
  unitSynergies: Record<string, string[]>;
  /** Per-match trait overrides, consulted before `unitSynergies`. Ringmaster
   *  rolls three classes per match and the roll is captured in the match's
   *  `chess_rm_class`, so where that reached us we count it exactly instead of
   *  inferring it from the game's synergy counts. */
  unitSynergyOverrides?: Record<string, string[]>;
  /** Synergy display name → first active tier (buildSynergyMinCountByName). */
  synergyMinCount: Record<string, number>;
  /** Synergy display name → every tier (buildSynergyTiersByName). Needed to
   *  report the activated tier; without it `tier` falls back to the count. */
  synergyTiers?: Record<string, number[]>;
  /** Item id/display name → synergy the carrier counts as (counts_as_synergy
   *  links: Spider Leg → Aqir, Minotaur Horn → Dragon). */
  itemCountsAsSynergy?: Record<string, string>;
  /** Synergy counts captured from the game (`buff`). Used as a bounded floor:
   *  items can raise a count above the species count, and pieces whose traits
   *  are not in content — Ringmaster rolls 3 random classes per match — are
   *  invisible to the static lookup. Safe to pass alongside board items. */
  storedSynergies?: { name: string; count: number }[];
}

export interface LineupSynergy {
  name: string;
  /** Pieces contributing: unique bodies plus counts-as item carriers. */
  count: number;
  /** Nominal tier those pieces have activated, Wizard discount included. */
  tier: number;
}

/**
 * Derive the synergies a player actually has from their fielded pieces.
 *
 * Synergy counts in DAC are per unique species — duplicate copies of a unit
 * never add to a count — plus item carriers for counts_as_synergy items.
 * This is the single source of truth for synergy badges; the game's raw
 * `buff` capture is unreliable (often stale from an earlier round, and full
 * of inactive one-piece entries), so it is only ever used as a bounded floor
 * (see `storedSynergies`), never displayed directly.
 *
 * Returns active synergies only — each with the piece count and the tier that
 * count activates — sorted by tier descending.
 */
export function computeLineupSynergies(
  pieces: SynergyCountPiece[],
  options: ComputeLineupSynergiesOptions,
): LineupSynergy[] {
  const {
    unitSynergies,
    unitSynergyOverrides,
    synergyMinCount,
    synergyTiers,
    itemCountsAsSynergy,
    storedSynergies,
  } = options;

  // Species contributing to each synergy; a species counts at most once per
  // synergy whether via its own traits or a counts_as item.
  const speciesBySynergy = new Map<string, Set<string>>();
  const add = (synergy: string, species: string) => {
    let set = speciesBySynergy.get(synergy);
    if (!set) {
      set = new Set();
      speciesBySynergy.set(synergy, set);
    }
    set.add(species);
  };

  // Pieces whose traits are still unknown after the per-match overrides: a
  // Ringmaster from a match captured before the class roll was recorded, or a
  // unit newer than the local content snapshot. Each can be worth at most one
  // body in any single synergy, which is what bounds the floor below.
  let unresolvedPieces = 0;
  for (const piece of pieces) {
    if (!piece.name) continue;
    const traits = unitSynergyOverrides?.[piece.name] ?? unitSynergies[piece.name];
    if (!traits || traits.length === 0) unresolvedPieces += 1;
    for (const synergy of traits ?? []) {
      add(synergy, piece.name);
    }
    if (itemCountsAsSynergy) {
      for (const item of piece.items ?? []) {
        const synergy = itemCountsAsSynergy[item];
        if (synergy) add(synergy, piece.name);
      }
    }
  }

  const counts = new Map<string, number>();
  for (const [synergy, species] of speciesBySynergy) {
    counts.set(synergy, species.size);
  }

  // The game's own count can legitimately exceed what the pieces show: a
  // counts-as item on a row with no per-piece item data, or a Ringmaster class
  // roll. Let it raise a synergy the board already has, but never by more than
  // those two sources could account for — that keeps a stale `buff` from
  // inventing bodies the player no longer fields.
  if (storedSynergies) {
    const itemLinkable = new Set(Object.values(itemCountsAsSynergy ?? {}));
    for (const stored of storedSynergies) {
      const derived = counts.get(stored.name);
      if (derived == null) continue;
      const headroom = itemLinkable.has(stored.name)
        ? pieces.length
        : unresolvedPieces;
      const raised = Math.min(stored.count, derived + headroom);
      if (raised > derived) counts.set(stored.name, raised);
    }
  }

  const wizardDiscount = wizardTierDiscount(
    counts.get(WIZARD_SYNERGY_NAME) ?? 0,
  );

  return filterActiveSynergiesWithThresholds(
    [...counts.entries()].map(([name, count]) => ({
      name,
      count: normalizeDisplaySynergyCount(name, count),
    })),
    synergyMinCount,
    wizardDiscount,
    synergyTiers,
  )
    .map(({ name, count }) => ({
      name,
      count,
      tier: activeSynergyTier(count, synergyTiers?.[name], wizardDiscount),
    }))
    .sort((a, b) => b.tier - a.tier || b.count - a.count || a.name.localeCompare(b.name));
}

interface ItemLinkEntry {
  item?: string;
  synergy?: string;
  category?: string;
}

/**
 * Build the item → counts-as-synergy lookup from content item-links plus the
 * items catalog, keyed by both display name ("Spider Leg") and internal id
 * ("item_wangchongtui") so board piece item ids resolve directly.
 */
export function buildItemSynergyLookup(
  itemLinks: { links?: ItemLinkEntry[] } | ItemLinkEntry[] | null | undefined,
  itemsFull?: Record<string, ItemFullInfo>,
): Record<string, string> {
  const links = Array.isArray(itemLinks) ? itemLinks : itemLinks?.links ?? [];
  const byName: Record<string, string> = {};
  for (const link of links) {
    if (link?.category === "counts_as_synergy" && link.item && link.synergy) {
      byName[link.item] = link.synergy;
    }
  }
  const out: Record<string, string> = { ...byName };
  if (itemsFull) {
    for (const [id, info] of Object.entries(itemsFull)) {
      const synergy = info?.name ? byName[info.name] : undefined;
      if (synergy) out[id] = synergy;
    }
  }
  return out;
}

/** Unit display name → synergy display names, from a units_full payload. */
export function buildUnitSynergyLookup(
  unitsFull: Record<string, UnitFullInfo>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, info] of Object.entries(unitsFull)) {
    if (Array.isArray(info?.synergies)) {
      out[name] = info.synergies.filter(
        (synergy): synergy is string => typeof synergy === "string",
      );
    }
  }
  return out;
}

/** Build a `chess_*` code lookup from units_full.json once per units payload. */
export function buildChessCodeUnitLookup(
  unitsFull: Record<string, UnitFullInfo>,
): Map<string, UnitCodeInfo> {
  const out = new Map<string, UnitCodeInfo>();
  for (const [displayName, info] of Object.entries(unitsFull)) {
    const id = (info as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    out.set(id, {
      name: displayName,
      cost: Number((info as { cost?: unknown }).cost) || 0,
      synergies: Array.isArray(info.synergies)
        ? info.synergies.filter((synergy): synergy is string => typeof synergy === "string")
        : [],
    });
  }
  return out;
}

/**
 * Resolve a raw nettable `chess_lineup` string into display names and stars.
 * Star level is encoded by trailing `1`s (`chess_wl1` = 2★,
 * `chess_br11` = 3★). Unknown ids and placeholders are skipped.
 */
export function resolveChessLineup(
  raw: string | undefined,
  codeToUnit: Map<string, Pick<UnitCodeInfo, "name" | "cost">>,
): ResolvedChessUnit[] {
  if (!raw) return [];
  const resolved: Array<ResolvedChessUnit & { cost: number }> = [];
  const displayUnitCostByName = new Map(
    Array.from(codeToUnit.values()).map((entry) => [entry.name, entry.cost]),
  );
  for (const token of raw.replace(/\|/g, ",").split(",")) {
    const code = token.trim();
    if (!code || code === "placeholder") continue;
    if (code.startsWith("chess_")) {
      const base = code.replace(/1+$/, "");
      const unit = codeToUnit.get(base);
      if (!unit) continue;
      const stars = Math.max(1, Math.min(1 + (code.length - base.length), 3));
      resolved.push({ name: unit.name, stars, cost: unit.cost });
      continue;
    }

    // The Rust backend may already normalize live nettable lineups into
    // display names (`Lion|Chaos Knight(2)`). Accept that shape too so the
    // live board does not drop every unit while waiting for raw `chess_*` codes.
    const displayMatch = code.match(/^(.*?)(?:\((\d+)\))?$/);
    const name = displayMatch?.[1]?.trim();
    if (!name) continue;
    const stars = Math.max(1, Math.min(Number(displayMatch?.[2]) || 1, 3));
    resolved.push({ name, stars, cost: displayUnitCostByName.get(name) ?? 0 });
  }
  resolved.sort((a, b) => b.stars - a.stars || b.cost - a.cost);
  return resolved.map(({ name, stars }) => ({ name, stars }));
}
