import type { NetTableDebugState } from "../hooks/useNetTableEvents";

interface NetTableDebugPanelProps {
  debug: NetTableDebugState;
}

// The six dump keys the F10 sequence fires, in order, with human labels.
const TABLES: { key: string; label: string }[] = [
  { key: "dac_table", label: "End board" },
  { key: "player_info_table", label: "Live player state" },
  { key: "game_info", label: "Game info" },
  { key: "player_id_table", label: "Player IDs" },
  { key: "chess_pool_table", label: "Shop pool" },
  { key: "unit_table", label: "Board units" },
];

type Cell = { text: string; cls: "ok" | "empty" | "fail" | "idle" };

function cellFor(
  result: { detected: boolean; rows: number | null } | undefined,
  running: boolean,
): Cell {
  if (!result) return { text: running ? "…" : "—", cls: "idle" };
  if (!result.detected) return { text: "no dump", cls: "fail" };
  if (!result.rows) return { text: "empty", cls: "empty" };
  return { text: `${result.rows} row${result.rows === 1 ? "" : "s"}`, cls: "ok" };
}

export function NetTableDebugPanel({ debug }: NetTableDebugPanelProps) {
  const byTable = new Map(debug.results.map((r) => [r.table, r]));
  const hasRun = debug.results.length > 0 || debug.reason !== null;

  return (
    <div className="nettable-debug">
      <div className="nettable-debug-header">
        <span className="nettable-debug-title">Capture debug</span>
        {debug.running && <span className="nettable-debug-running">running…</span>}
      </div>

      <div className="nettable-debug-hint">
        Press <kbd>F10</kbd> with Dota focused to fire each dump key in sequence
        and confirm what lands.
      </div>

      {debug.reason === "dota_not_foreground" && (
        <div className="nettable-debug-warn">
          Dota wasn’t focused — alt-tab to the game and press F10.
        </div>
      )}

      <ul className="nettable-debug-list">
        {TABLES.map(({ key, label }) => {
          const cell = cellFor(byTable.get(key), debug.running);
          return (
            <li key={key} className="nettable-debug-row">
              <span className="nettable-debug-label">{label}</span>
              <code className="nettable-debug-code">{key}</code>
              <span className={`nettable-debug-status is-${cell.cls}`}>
                {hasRun ? cell.text : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
