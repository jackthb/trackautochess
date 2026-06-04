import { useMemo, useState } from "react";
import { unitStem } from "../lib/game-utils";
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

const TABLE_LABELS: Record<string, string> = {
  CustomNetTable_ranking_top_table: "Queen ladder",
  CustomNetTable_match_history_table: "Match history",
  CustomNetTable_dac_table: "Game state",
  CustomNetTable_player_id_table: "Lobby slots",
  CustomNetTable_player_info_table: "Player info",
  CustomNetTable_game_info: "Game info",
};

const HIDDEN_CURRENT_CAPTURE_TABLES = new Set([
  "CustomNetTable_chess_pool_table",
]);

/**
 * Live view of the most recent CustomNetTable dump. Updates whenever the
 * backend emits `nettable_state` (which happens after each successful F12
 * dump → ingest cycle). Renders one collapsible section per table with the
 * decoded entries as JSON underneath — drill-down for debugging, not a
 * pretty data view.
 *
 * Entirely local UI — nothing on this panel is synced to Supabase or
 * exposed via any web endpoint, so private-to-the-player data
 * (e.g. unrevealed legendary pool) stays on your machine.
 */
export function NetTableStatePanel({
  state,
  stateAt,
}: Props) {
  const tables = useMemo(() => {
    return Object.keys(state)
      .filter((table) => !HIDDEN_CURRENT_CAPTURE_TABLES.has(table))
      .sort((a, b) => {
        const aLabel = TABLE_LABELS[a] ?? a;
        const bLabel = TABLE_LABELS[b] ?? b;
        return aLabel.localeCompare(bLabel);
      });
  }, [state]);

  const empty = tables.length === 0;

  return (
    <section className="nettable-state-panel">
      <header className="nettable-state-panel-header">
        <h2>Current capture</h2>
        <span className="nettable-state-panel-meta">
          {stateAt ? `last capture · ${formatTime(stateAt)}` : "no capture yet"}
        </span>
      </header>

      {empty ? (
        <p className="nettable-state-panel-empty">
          Press Pause in Dota (or wait for the auto-trigger) to capture the
          current lobby state.
        </p>
      ) : (
        <div className="nettable-state-panel-list">
          {tables.map((table) => (
            <TableBlock key={table} table={table} entries={state[table]} />
          ))}
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
          Hidden legendaries (yours only)
        </span>
        <span className="nettable-state-block-count">
          {unrevealed.length}
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

      {unrevealed.length === 0 ? (
        <div className="nettable-state-block-empty">
          {revealed.length === 0
            ? "Waiting for a capture — the pool is set once the match starts."
            : "Every legendary in this match's pool has been revealed."}
        </div>
      ) : (
        <ul className="nettable-legendary-grid">
          {unrevealed.map((u) => (
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
            </li>
          ))}
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
  const codeToUnit = chessCodeToUnit(unitsFull);
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
  if (!buff) return [];

  return buff
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawKey, rawCount] = entry.split(":");
      const key = rawKey.trim();
      const info = synergiesData[key];
      const count = Number(rawCount) || 0;
      const firstTier =
        Array.isArray(info?.tiers) && typeof info.tiers[0] === "number"
          ? info.tiers[0]
          : 2;
      return {
        name: info?.name || displayNameFromSynergyKey(key),
        count,
        firstTier,
        score: count / Math.max(firstTier || 1, 1),
      };
    })
    .filter((synergy) => {
      if (synergy.count < synergy.firstTier) return false;
      // One-piece synergies like Demon are often incidental splashes. Keep
      // this first pass focused on multi-piece build shape.
      if (synergy.firstTier <= 1 && synergy.count <= 1) return false;
      return true;
    })
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return b.count - a.count;
    });
}

function displayNameFromSynergyKey(key: string): string {
  return key
    .replace(/^is_/, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function chessCodeToUnit(
  unitsFull: Record<string, UnitFullInfo>,
): Map<string, { name: string; synergies: string[] }> {
  const out = new Map<string, { name: string; synergies: string[] }>();
  for (const [displayName, info] of Object.entries(unitsFull)) {
    const id = (info as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    out.set(id, {
      name: displayName,
      synergies: Array.isArray(info.synergies)
        ? info.synergies.filter((s): s is string => typeof s === "string")
        : [],
    });
  }
  return out;
}

function TableBlock({
  table,
  entries,
}: {
  table: string;
  entries: Record<string, unknown>;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const label = TABLE_LABELS[table] ?? table.replace(PREFIX, "");
  const keys = Object.keys(entries);

  return (
    <div className="nettable-state-block">
      <div className="nettable-state-block-header">
        <span className="nettable-state-block-heading">
          <span className="nettable-state-block-title">{label}</span>
          <code className="nettable-state-block-table">{table}</code>
        </span>
        <span className="nettable-state-block-count">{keys.length}</span>
      </div>
      {keys.length === 0 ? (
        <div className="nettable-state-block-empty">no entries</div>
      ) : (
        <ul className="nettable-state-keys">
          {keys.map((k) => {
            const isOpen = openKey === k;
            const value = entries[k];
            return (
              <li key={k} className="nettable-state-key">
                <button
                  type="button"
                  className="nettable-state-key-toggle"
                  onClick={() => setOpenKey(isOpen ? null : k)}
                  aria-expanded={isOpen}
                >
                  <span className="nettable-state-key-name">{k}</span>
                  <span className="nettable-state-key-summary">
                    {summarize(value)}
                  </span>
                </button>
                {isOpen && (
                  <pre className="nettable-state-key-body">
                    {safeStringify(value)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function summarize(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") {
    if (value.length === 0) return '""';
    return value.length > 60 ? `"${value.slice(0, 60)}…"` : `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("_decode_error" in obj) return "decode error";
    const keys = Object.keys(obj);
    return `{${keys.length} field${keys.length === 1 ? "" : "s"}}`;
  }
  return typeof value;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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
