import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { unitStem } from "../lib/game-utils";
import { buildChessCodeUnitLookup } from "@dac/shared/game-structure";
import type { NetTableState } from "../hooks/useNetTableEvents";
import type { UnitFullInfo } from "../types";

export interface LegendaryEntry {
  code: string;
  name: string;
}

export interface LegendaryPoolPayload {
  revealed: LegendaryEntry[];
  unrevealed: LegendaryEntry[];
  stateAt: string | null;
}

/**
 * Pushes legendary pool state to a Discord-styled always-on-top overlay window.
 * Renders nothing in the main app.
 */
export function LegendaryPoolOverlay({ state, stateAt, unitsFull }: Props) {
  const pool = useMemo(
    () => extractHiddenLegendaries(state, unitsFull),
    [state, unitsFull],
  );

  useEffect(() => {
    const api = window.legendaryOverlay;
    if (!api) return;

    if (!pool) {
      void api.update(null);
      return;
    }

    void api.update({
      revealed: pool.revealed,
      unrevealed: pool.unrevealed,
      stateAt,
    } satisfies LegendaryPoolPayload);
  }, [pool, stateAt]);

  useEffect(() => {
    return () => {
      void window.legendaryOverlay?.update(null);
    };
  }, []);

  return null;
}

interface Props {
  state: NetTableState;
  stateAt: string | null;
  unitsFull: Record<string, UnitFullInfo>;
}

/** Discord-styled panel rendered inside the always-on-top overlay window. */
export function LegendaryDiscordOverlayApp() {
  const [payload, setPayload] = useState<LegendaryPoolPayload | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = window.legendaryOverlay;
    if (!api) return;
    const unsub = api.onPush((next) => setPayload(next));
    api.ready();
    return unsub;
  }, []);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !window.legendaryOverlay?.resize) return;
    const rect = el.getBoundingClientRect();
    window.legendaryOverlay.resize({
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    });
  }, [payload]);

  const revealed = payload?.revealed ?? [];
  const unrevealed = payload?.unrevealed ?? [];
  const fullPool = [...revealed, ...unrevealed];
  const revealedCodes = new Set(revealed.map((u) => u.code));

  return (
    <div className="disc-overlay">
      <div className="disc-overlay-card" ref={cardRef}>
        <header className="disc-overlay-header">
          <div className="disc-overlay-title">Legendaries</div>
          <button
            type="button"
            className="disc-overlay-close"
            onClick={() => void window.legendaryOverlay?.hide()}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {fullPool.length === 0 ? (
          <p className="disc-overlay-empty">Waiting for match pool…</p>
        ) : (
          <ul className="disc-overlay-list">
            {fullPool.map((u) => {
              const isRevealed = revealedCodes.has(u.code);
              return (
                <li
                  key={u.code}
                  className={`disc-overlay-row${isRevealed ? " is-unlocked" : " is-locked"}`}
                  title={u.code}
                >
                  <img
                    className="disc-overlay-icon"
                    src={`icons://units/${unitStem(u.name)}.png`}
                    alt=""
                    width={24}
                    height={24}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility =
                        "hidden";
                    }}
                  />
                  <span className="disc-overlay-name">{u.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function extractHiddenLegendaries(
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
