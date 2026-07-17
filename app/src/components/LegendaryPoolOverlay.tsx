import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { unitStem } from "../lib/game-utils";
import { buildChessCodeUnitLookup } from "@dac/shared/game-structure";
import type { NetTableState } from "../hooks/useNetTableEvents";
import type { UnitFullInfo } from "../types";

interface Props {
  state: NetTableState;
  stateAt: string | null;
  unitsFull: Record<string, UnitFullInfo>;
}

interface LegendaryEntry {
  code: string;
  name: string;
}

/**
 * Admin-only floating overlay for legendaries still in the match pool.
 * No ban-efficiency meters — just revealed vs hidden units.
 */
export function LegendaryPoolOverlay({ state, stateAt, unitsFull }: Props) {
  const [open, setOpen] = useState(true);
  const pool = useMemo(
    () => extractHiddenLegendaries(state, unitsFull),
    [state, unitsFull],
  );

  if (!pool) return null;

  const { revealed, unrevealed } = pool;
  const fullPool = [...revealed, ...unrevealed];
  const revealedCodes = new Set(revealed.map((u) => u.code));

  if (!open) {
    return createPortal(
      <button
        type="button"
        className="legendary-pool-fab"
        onClick={() => setOpen(true)}
        title="Show legendary pool"
      >
        Legendaries ({fullPool.length})
      </button>,
      document.body,
    );
  }

  return createPortal(
    <aside className="legendary-pool-overlay" aria-label="Legendaries in pool">
      <header className="legendary-pool-overlay-header">
        <div>
          <div className="legendary-pool-overlay-title">Legendaries in pool</div>
          <div className="legendary-pool-overlay-meta">
            {stateAt ? `updated ${formatTime(stateAt)}` : "waiting for match data"}
            {" · "}
            {fullPool.length} total
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost legendary-pool-overlay-close"
          onClick={() => setOpen(false)}
          aria-label="Hide legendary pool"
        >
          Hide
        </button>
      </header>

      {fullPool.length === 0 ? (
        <p className="legendary-pool-overlay-empty">
          Waiting for legendary pool data from the current match.
        </p>
      ) : (
        <ul className="legendary-pool-grid">
          {fullPool.map((u) => {
            const isRevealed = revealedCodes.has(u.code);
            return (
              <li key={u.code} className="legendary-pool-cell" title={u.code}>
                <img
                  className="legendary-pool-icon"
                  src={`icons://units/${unitStem(u.name)}.png`}
                  alt=""
                  width={36}
                  height={36}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility =
                      "hidden";
                  }}
                />
                <span className="legendary-pool-name">{u.name}</span>
                <span className="legendary-pool-status">
                  {isRevealed ? "Revealed" : "Hidden"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>,
    document.body,
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
  if (revealedRaw == null && unrevealedRaw == null) return null;
  const codeToUnit = buildChessCodeUnitLookup(unitsFull);
  return {
    revealed: toEntries(revealedRaw, codeToUnit),
    unrevealed: toEntries(unrevealedRaw, codeToUnit),
  };
}

function toEntries(
  raw: unknown,
  codeToUnit: Map<string, { name: string; synergies: string[] }>,
): LegendaryEntry[] {
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
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
