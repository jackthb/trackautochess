import { useMemo } from "react";
import { unitStem } from "../lib/game-utils";
import {
  buildChessCodeUnitLookup,
  parseNettableSynergyBuff,
} from "@dac/shared/game-structure";
import type { LivePlayer, NetTableState } from "../hooks/useNetTableEvents";
import type { SynergyInfo, UnitFullInfo } from "../types";

interface Props {
  state: NetTableState;
  stateAt: string | null;
  /** Loaded units_full.json — used to resolve internal `chess_*` codes to
   *  display names for the Hidden Legendaries summary. */
  unitsFull: Record<string, UnitFullInfo>;
  livePlayers: Record<string, LivePlayer>;
  localSteamIds: string[];
  synergiesData: Record<string, SynergyInfo>;
}

const PREFIX = "CustomNetTable_";

/**
 * Live guidance from the most recent CustomNetTable dump. Updates whenever the
 * backend emits `nettable_state` (which happens after each successful F12
 * dump -> ingest cycle). This intentionally renders only player-facing
 * legendary pool guidance, not the raw current-capture tables.
 *
 * Entirely local UI - nothing on this panel is synced to Supabase or
 * exposed via any web endpoint, so private-to-the-player data
 * (e.g. unrevealed legendary pool) stays on your machine.
 */
export function NetTableStatePanel({
  state,
  stateAt,
  unitsFull,
  livePlayers,
  localSteamIds,
  synergiesData,
}: Props) {
  const hiddenLegendaries = useMemo(
    () => extractHiddenLegendaries(state, unitsFull),
    [state, unitsFull],
  );

  const empty = hiddenLegendaries === null;

  return (
    <section className="nettable-state-panel">
      <header className="nettable-state-panel-header">
        <h2>Legendary guidance</h2>
        <span className="nettable-state-panel-meta">
          {stateAt ? `updated ${formatTime(stateAt)}` : "waiting for match data"}
        </span>
      </header>

      {empty ? (
        <p className="nettable-state-panel-empty">
          Waiting for legendary pool data from the current match.
        </p>
      ) : (
        <div className="nettable-state-panel-list">
          {hiddenLegendaries && (
            <HiddenLegendaries
              revealed={hiddenLegendaries.revealed}
              unrevealed={hiddenLegendaries.unrevealed}
              livePlayers={livePlayers}
              localSteamIds={localSteamIds}
              synergiesData={synergiesData}
            />
          )}
        </div>
      )}
    </section>
  );
}

interface LegendaryEntry {
  /** internal `chess_*` code from the live nettable feed */
  code: string;
  /** Friendly display name, falling back to the raw code if we don't have a map entry */
  name: string;
  /** Unit synergies from units_full.json. Used to rank which trait bans deny the most legendaries. */
  synergies: string[];
}

interface LegendaryBanPick {
  synergy: string;
  units: LegendaryEntry[];
  expendableUnits: LegendaryEntry[];
  protectedUnits: LegendaryEntry[];
  poolShare: number;
  score: number;
}

interface BuildBanContext {
  synergies: Array<{ name: string; count: number }>;
  protectedUnits: LegendaryEntry[];
  protectedUnitCodes: Set<string>;
}

function HiddenLegendaries({
  revealed,
  unrevealed,
  livePlayers,
  localSteamIds,
  synergiesData,
}: {
  revealed: LegendaryEntry[];
  unrevealed: LegendaryEntry[];
  livePlayers: Record<string, LivePlayer>;
  localSteamIds: string[];
  synergiesData: Record<string, SynergyInfo>;
}) {
  const fullPool = [...revealed, ...unrevealed];
  const revealedCodes = new Set(revealed.map((u) => u.code));
  const banContext = inferBanContext(
    fullPool,
    livePlayers,
    localSteamIds,
    synergiesData,
  );
  const bestBans = rankLegendaryBanPicks(
    fullPool,
    banContext.protectedUnitCodes,
  );
  const hasBuildContext = banContext.synergies.length > 0;
  const hasProtectedTargets = banContext.protectedUnits.length > 0;
  const contextLabel = banContext.synergies.map((s) => s.name).join(" / ");
  const protectedUnitNames = banContext.protectedUnits.map((u) => u.name);

  return (
    <div className="nettable-state-block">
      <div className="nettable-state-block-header">
        <span className="nettable-state-block-title">
          Legendaries in pool
        </span>
        <span className="nettable-state-block-count">
          {fullPool.length}
        </span>
      </div>
      {bestBans.length > 0 && (
        <div className="nettable-best-bans" aria-label="Most efficient legendary bans">
          <div className="nettable-best-bans-heading">
            {hasBuildContext
              ? "Pool-thinning bans for your board"
              : "Best bans by legendary pool impact"}
          </div>
          <ul className="nettable-best-ban-list">
            {bestBans.map((ban) => (
              <li key={ban.synergy} className="nettable-best-ban-card">
                <div className="nettable-best-ban-main">
                  <span className="nettable-best-ban-name">{ban.synergy}</span>
                  <span className="nettable-best-ban-count">
                    {hasProtectedTargets
                      ? `${ban.expendableUnits.length}/${fullPool.length} unwanted`
                      : `${ban.units.length}/${fullPool.length} legendaries`}
                  </span>
                </div>
                <div className="nettable-best-ban-meter" aria-hidden="true">
                  <span
                    style={{
                      width: `${
                        hasProtectedTargets
                          ? (ban.expendableUnits.length / fullPool.length) * 100
                          : ban.poolShare * 100
                      }%`,
                    }}
                  />
                </div>
                <div className="nettable-best-ban-units">
                  {(hasProtectedTargets ? ban.expendableUnits : ban.units)
                    .map((u) => u.name)
                    .join(", ")}
                </div>
                {hasProtectedTargets && ban.protectedUnits.length > 0 && (
                  <div className="nettable-best-ban-units">
                    Hits target: {ban.protectedUnits.map((u) => u.name).join(", ")}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="nettable-best-bans-note">
            {hasProtectedTargets
              ? `Protecting ${protectedUnitNames.join(", ")} from your active ${contextLabel} synergies.`
              : hasBuildContext
                ? `No current legendary targets match your active ${contextLabel} synergies, so this is raw pool thinning.`
                : "One ban removes every legendary sharing that trait from this match's pool."}
          </div>
        </div>
      )}

      {fullPool.length === 0 ? (
        <div className="nettable-state-block-empty">
          Waiting for legendary pool data from the current match.
        </div>
      ) : (
        <ul className="nettable-legendary-grid">
          {fullPool.map((u) => {
            const isRevealed = revealedCodes.has(u.code);

            return (
            <li key={u.code} className="nettable-legendary-cell" title={u.code}>
              <img
                className="nettable-legendary-icon"
                src={`icons://units/${unitStem(u.name)}.png`}
                alt=""
                width={36}
                height={36}
                onError={(e) => {
                  // Fall back to hiding the broken image rather than the alt
                  // text — codes like new chess pieces we haven't shipped icons
                  // for would otherwise show the placeholder glyph.
                  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                }}
              />
              <span className="nettable-legendary-name">{u.name}</span>
              <span className="nettable-legendary-status">
                {isRevealed ? "Revealed" : "Hidden"}
              </span>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function extractHiddenLegendaries(
  state: NetTableState,
  unitsFull: Record<string, UnitFullInfo>,
): { revealed: LegendaryEntry[]; unrevealed: LegendaryEntry[] } | null {
  const pool = state["CustomNetTable_chess_pool_table"];
  if (!pool) return null;
  const revealedRaw = pool["revealed_legendary_chess_list"];
  const unrevealedRaw = pool["unrevealed_legendary_chess_list"];
  // Drodo's lua sets both keys at the start of the match; if neither is
  // present, we don't have a capture yet and there's nothing to show.
  if (revealedRaw == null && unrevealedRaw == null) return null;
  const codeToUnit = buildChessCodeUnitLookup(unitsFull);
  return {
    revealed: toEntries(revealedRaw, codeToUnit),
    unrevealed: toEntries(unrevealedRaw, codeToUnit),
  };
}

function rankLegendaryBanPicks(
  pool: LegendaryEntry[],
  protectedUnitCodes: Set<string> = new Set(),
): LegendaryBanPick[] {
  if (pool.length === 0) return [];

  const bySynergy = new Map<string, LegendaryEntry[]>();
  for (const unit of pool) {
    for (const synergy of unit.synergies) {
      const list = bySynergy.get(synergy) ?? [];
      list.push(unit);
      bySynergy.set(synergy, list);
    }
  }

  const picks = Array.from(bySynergy, ([synergy, units]) => {
    const sortedUnits = units.slice().sort((a, b) => a.name.localeCompare(b.name));
    const protectedUnits = sortedUnits.filter((u) => protectedUnitCodes.has(u.code));
    const expendableUnits = sortedUnits.filter((u) => !protectedUnitCodes.has(u.code));
    return {
      synergy,
      units: sortedUnits,
      expendableUnits,
      protectedUnits,
      poolShare: sortedUnits.length / pool.length,
      score: expendableUnits.length - protectedUnits.length * (pool.length + 1),
    };
  });

  const hasProtectedContext = protectedUnitCodes.size > 0;
  const cleanPicks = picks.filter(
    (ban) => ban.protectedUnits.length === 0 && ban.expendableUnits.length > 0,
  );
  const rankedSource =
    hasProtectedContext && cleanPicks.length > 0
      ? cleanPicks
      : picks.filter((ban) =>
          hasProtectedContext ? ban.expendableUnits.length > 0 : ban.units.length > 1,
        );

  return rankedSource
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      const expendableDiff = b.expendableUnits.length - a.expendableUnits.length;
      if (expendableDiff !== 0) return expendableDiff;
      const protectedDiff = a.protectedUnits.length - b.protectedUnits.length;
      if (protectedDiff !== 0) return protectedDiff;
      const countDiff = b.units.length - a.units.length;
      if (countDiff !== 0) return countDiff;
      return a.synergy.localeCompare(b.synergy);
    })
    .slice(0, 5);
}

function inferBanContext(
  pool: LegendaryEntry[],
  livePlayers: Record<string, LivePlayer>,
  localSteamIds: string[],
  synergiesData: Record<string, SynergyInfo>,
): BuildBanContext {
  const localPlayer = findLocalPlayer(livePlayers, localSteamIds);
  const synergies = parseBuildSynergies(localPlayer?.buff, synergiesData).slice(0, 3);
  const protectedSynergies = new Set(synergies.map((s) => s.name));
  const protectedUnits = pool.filter((unit) =>
    unit.synergies.some((synergy) => protectedSynergies.has(synergy)),
  );
  return {
    synergies,
    protectedUnits,
    protectedUnitCodes: new Set(protectedUnits.map((unit) => unit.code)),
  };
}

function findLocalPlayer(
  livePlayers: Record<string, LivePlayer>,
  localSteamIds: string[],
): LivePlayer | undefined {
  for (const steamId of localSteamIds) {
    const player = livePlayers[steamId];
    if (player) return player;
  }
  return undefined;
}

function parseBuildSynergies(
  buff: string | undefined,
  synergiesData: Record<string, SynergyInfo>,
): Array<{ name: string; count: number; score: number }> {
  // One-piece synergies like Demon are often incidental splashes. Keep this
  // inference focused on multi-piece build shape while reusing the same
  // activation-tier rules as live standings and web match display.
  return parseNettableSynergyBuff(buff, synergiesData, {
    includeOnePieceActive: false,
  });
}

function toEntries(
  raw: unknown,
  codeToUnit: Map<string, { name: string; synergies: string[] }>,
): LegendaryEntry[] {
  // Drodo broadcasts this as a Lua array, which round-trips through VBKV →
  // JSON as either an array or a {1: 'chess_x', 2: 'chess_y'} object.
  const list: string[] = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : raw && typeof raw === "object"
    ? Object.values(raw as Record<string, unknown>).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  return list
    .map((code) => {
      const unit = codeToUnit.get(code);
      return {
        code,
        name: unit?.name ?? code,
        synergies: unit?.synergies ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}
