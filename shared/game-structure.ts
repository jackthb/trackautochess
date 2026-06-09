import type { SynergyInfo, UnitFullInfo } from "./types";

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
): boolean {
  return synergy.count >= (synergyMinCount[synergy.name] ?? 2);
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

export function filterActiveSynergiesWithThresholds<T extends { name: string; count: number }>(
  synergies: T[],
  synergyMinCount: Record<string, number>,
): T[] {
  return synergies.filter((synergy) => isSynergyActive(synergy, synergyMinCount));
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

/** Unit display-name → buy cost for icon borders and lineup sorting. */
export function buildUnitCostLookup(
  unitsFull: Record<string, UnitFullInfo>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, info] of Object.entries(unitsFull)) {
    out[name] = Number((info as { cost?: unknown }).cost) || 0;
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
  for (const token of raw.replace(/\|/g, ",").split(",")) {
    const code = token.trim();
    if (!code || code === "placeholder") continue;
    const base = code.replace(/1+$/, "");
    const unit = codeToUnit.get(base);
    if (!unit) continue;
    const stars = Math.max(1, Math.min(1 + (code.length - base.length), 3));
    resolved.push({ name: unit.name, stars, cost: unit.cost });
  }
  resolved.sort((a, b) => b.stars - a.stars || b.cost - a.cost);
  return resolved.map(({ name, stars }) => ({ name, stars }));
}
