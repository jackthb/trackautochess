import { useMemo, useState } from "react";
import type { NetTableState } from "../hooks/useNetTableEvents";

interface Props {
  state: NetTableState;
  stateAt: string | null;
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
 */
export function NetTableStatePanel({ state, stateAt }: Props) {
  const tables = useMemo(() => {
    return Object.keys(state).sort((a, b) => {
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
          {stateAt ? `last F12 · ${formatTime(stateAt)}` : "no capture yet"}
        </span>
      </header>

      {empty ? (
        <p className="nettable-state-panel-empty">
          Press F12 in Dota (or wait for the auto-trigger) to capture the
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
