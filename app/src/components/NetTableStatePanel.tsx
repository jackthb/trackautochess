import { useMemo, useState } from "react";
import { unitStem } from "../lib/game-utils";
import type { NetTableState } from "../hooks/useNetTableEvents";
import type { UnitFullInfo } from "../types";

interface Props {
  state: NetTableState;
  stateAt: string | null;
  /** Loaded units_full.json — used to resolve internal `chess_*` codes to
   *  display names for the Hidden Legendaries summary. */
  unitsFull: Record<string, UnitFullInfo>;
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
export function NetTableStatePanel({ state, stateAt, unitsFull }: Props) {
  const tables = useMemo(() => {
    return Object.keys(state).sort((a, b) => {
      const aLabel = TABLE_LABELS[a] ?? a;
      const bLabel = TABLE_LABELS[b] ?? b;
      return aLabel.localeCompare(bLabel);
    });
  }, [state]);

  const hiddenLegendaries = useMemo(
    () => extractHiddenLegendaries(state, unitsFull),
    [state, unitsFull],
  );

  const empty = tables.length === 0;

  return (
    <section className="nettable-state-panel">
      <header className="nettable-state-panel-header">
        <h2>Current capture</h2>
        <span className="nettable-state-panel-meta">
          {stateAt ? `last capture · ${formatTime(stateAt)}` : "no capture yet"}
        </span>
      </header>

      {hiddenLegendaries && (
        <HiddenLegendaries
          revealed={hiddenLegendaries.revealed}
          unrevealed={hiddenLegendaries.unrevealed}
        />
      )}

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
  poolShare: number;
}

function HiddenLegendaries({
  revealed,
  unrevealed,
}: {
  revealed: LegendaryEntry[];
  unrevealed: LegendaryEntry[];
}) {
  const fullPool = [...revealed, ...unrevealed];
  const bestBans = rankLegendaryBanPicks(fullPool);

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
            Best bans by legendary pool impact
          </div>
          <ul className="nettable-best-ban-list">
            {bestBans.map((ban) => (
              <li key={ban.synergy} className="nettable-best-ban-card">
                <div className="nettable-best-ban-main">
                  <span className="nettable-best-ban-name">{ban.synergy}</span>
                  <span className="nettable-best-ban-count">
                    {ban.units.length}/{fullPool.length} legendaries
                  </span>
                </div>
                <div className="nettable-best-ban-meter" aria-hidden="true">
                  <span style={{ width: `${ban.poolShare * 100}%` }} />
                </div>
                <div className="nettable-best-ban-units">
                  {ban.units.map((u) => u.name).join(", ")}
                </div>
              </li>
            ))}
          </ul>
          <div className="nettable-best-bans-note">
            One ban removes every legendary sharing that trait from this match's pool.
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

function rankLegendaryBanPicks(pool: LegendaryEntry[]): LegendaryBanPick[] {
  if (pool.length === 0) return [];

  const bySynergy = new Map<string, LegendaryEntry[]>();
  for (const unit of pool) {
    for (const synergy of unit.synergies) {
      const list = bySynergy.get(synergy) ?? [];
      list.push(unit);
      bySynergy.set(synergy, list);
    }
  }

  return Array.from(bySynergy, ([synergy, units]) => ({
    synergy,
    units: units.slice().sort((a, b) => a.name.localeCompare(b.name)),
    poolShare: units.length / pool.length,
  }))
    .filter((ban) => ban.units.length > 1)
    .sort((a, b) => {
      const countDiff = b.units.length - a.units.length;
      if (countDiff !== 0) return countDiff;
      return a.synergy.localeCompare(b.synergy);
    })
    .slice(0, 5);
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
        <span className="nettable-state-block-title">{label}</span>
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
