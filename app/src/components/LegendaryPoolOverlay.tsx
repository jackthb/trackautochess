import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { unitStem } from "@dac/shared/game-utils";
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
 * Pushes legendary pool state to a Discord-style Dota game overlay.
 * Only while in an active match — Ctrl+Shift+L toggles visibility.
 */
export function LegendaryPoolOverlay({
  state,
  stateAt,
  unitsFull,
  inMatch,
}: Props) {
  const pool = useMemo(
    () => extractHiddenLegendaries(state, unitsFull),
    [state, unitsFull],
  );

  useEffect(() => {
    const api = window.legendaryOverlay;
    if (!api) return;

    // Keep a payload while in-match even before the pool dump arrives —
    // otherwise Ctrl+Shift+L has nothing to show and looks broken.
    if (!inMatch) {
      void api.update(null);
      return;
    }

    void api.update({
      revealed: pool?.revealed ?? [],
      unrevealed: pool?.unrevealed ?? [],
      stateAt,
    } satisfies LegendaryPoolPayload);
  }, [pool, stateAt, inMatch]);

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
  inMatch: boolean;
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

    const publishSize = () => {
      const width = Math.ceil(el.scrollWidth);
      const height = Math.ceil(el.scrollHeight);
      if (width <= 0 || height <= 0) return;
      window.legendaryOverlay?.resize({ width, height });
    };

    publishSize();
    const ro = new ResizeObserver(publishSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [payload]);

  const revealed = payload?.revealed ?? [];
  const unrevealed = payload?.unrevealed ?? [];
  const revealedCodes = useMemo(
    () => new Set(revealed.map((u) => u.code)),
    [revealed],
  );
  // Stable 2×5 order by name — unlock state only recolors, never reshuffles.
  const gridUnits = useMemo(() => {
    const byCode = new Map<string, LegendaryEntry>();
    for (const u of [...revealed, ...unrevealed]) byCode.set(u.code, u);
    return [...byCode.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [revealed, unrevealed]);

  return (
    <div className="disc-overlay">
      <div className="disc-overlay-card" ref={cardRef}>
        <header className="disc-overlay-header">
          <div className="disc-overlay-title">Legendaries</div>
          <span className="disc-overlay-hotkey">⌃⇧L</span>
        </header>

        {gridUnits.length === 0 ? (
          <p className="disc-overlay-empty">Waiting for match pool…</p>
        ) : (
          <ul className="disc-overlay-grid" aria-label="Legendaries">
            {Array.from({ length: 10 }, (_, i) => {
              const u = gridUnits[i];
              if (!u) {
                return <li key={`empty-${i}`} className="disc-overlay-row is-empty" />;
              }
              const isUnlocked = revealedCodes.has(u.code);
              return (
                <li
                  key={u.code}
                  className={`disc-overlay-row${isUnlocked ? " is-unlocked" : " is-locked"}`}
                  title={u.code}
                >
                  <img
                    className="disc-overlay-icon"
                    src={`icons://units/${unitStem(u.name)}.png`}
                    alt=""
                    width={20}
                    height={20}
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
