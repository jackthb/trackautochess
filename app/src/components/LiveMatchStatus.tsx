import { useMemo } from "react";
import { parseLineup, unitStem, costBorderColor, synIconName } from "../lib/game-utils";
import type { LivePlayer } from "../hooks/useNetTableEvents";
import type { UnitFullInfo } from "../types";

interface Props {
  /** Extracted per-player live state, keyed by steam_id. */
  players: Record<string, LivePlayer>;
  /** Steam IDs belonging to the local player. */
  localSteamIds: string[];
  /** units_full.json — for unit cost (icon border) lookup. */
  unitsFull: Record<string, UnitFullInfo>;
}

function hpBarColor(hp: number): string {
  if (hp > 60) return "var(--green-bright)";
  if (hp > 30) return "var(--gold)";
  return "var(--red-bright)";
}

/** "is_mage:6,is_human:6," → [{ stem: "mage", count: 6 }, …], sorted desc. */
function parseBuff(buff: string | undefined): { stem: string; count: number }[] {
  if (!buff) return [];
  return buff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [raw, count] = entry.split(":");
      return { stem: raw.replace(/^is_/, ""), count: Number(count) || 0 };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * The local player's live board: HP, round progress, gold, units (icons +
 * stars), active synergies and relic. Fed by the backend's extracted player
 * state — the lineup is already resolved from raw chess_* codes and the HP is
 * the live value (not the dac_table static-100 sentinel). Renders nothing
 * until there's a capture for the local player.
 */
export function LiveMatchStatus({ players, localSteamIds, unitsFull }: Props) {
  const unitCosts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [name, info] of Object.entries(unitsFull)) {
      out[name] = Number(info.cost) || 0;
    }
    return out;
  }, [unitsFull]);

  const me = useMemo<LivePlayer | null>(() => {
    const ids = Object.keys(players);
    if (ids.length === 0) return null;
    // Prefer the explicit local steam_id; fall back to the sole entry.
    const localId = localSteamIds.find((id) => players[id]) ?? (ids.length === 1 ? ids[0] : null);
    return localId ? players[localId] : null;
  }, [players, localSteamIds]);

  if (!me) return null;

  const hp = Math.max(0, me.hp ?? 0);
  const units = parseLineup(me.lineup || "", unitCosts);
  const synergies = parseBuff(me.buff);

  return (
    <section className="live-board">
      <style>{`
        .live-board {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-8);
          padding: 12px 16px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .live-board-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .live-board-title {
          font-size: var(--fs-11);
          font-weight: var(--fw-medium);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .live-board-stats {
          display: flex;
          align-items: center;
          gap: 14px;
          font-size: var(--fs-12);
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
        .live-board-stat b { color: var(--text-primary); font-weight: var(--fw-medium); }
        .live-board-hp-wrap { display: flex; align-items: center; gap: 8px; }
        .live-board-hp-bar-bg {
          width: 120px; height: 6px;
          background: var(--bg-deep); border-radius: 3px; overflow: hidden;
        }
        .live-board-hp-bar { height: 100%; border-radius: 3px; transition: width 0.3s ease-out; min-width: 1px; }
        .live-board-hp-text { font-size: var(--fs-11); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
        .live-board-units { display: flex; flex-wrap: wrap; gap: 3px; }
        .live-board-empty { color: var(--text-muted); font-size: var(--fs-12); }
        .live-board-foot {
          display: flex; align-items: center; gap: 14px;
          font-size: var(--fs-11); color: var(--text-muted);
        }
        .live-board-syn { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .live-board-syn-item { display: flex; align-items: center; gap: 3px; }
        .live-board-syn-item img { width: 16px; height: 16px; }
        .live-board-relic { color: var(--gold); }
      `}</style>

      <div className="live-board-header">
        <span className="live-board-title">Your board</span>
        <div className="live-board-stats">
          <span className="live-board-stat">Lv<b>{me.level ?? "—"}</b></span>
          <span className="live-board-stat">
            <b style={{ color: "var(--green-bright)" }}>{me.win_round ?? 0}</b>
            <span style={{ color: "var(--text-muted)" }}>-</span>
            <b style={{ color: "var(--red-bright)" }}>{me.lose_round ?? 0}</b>
          </span>
          <span className="live-board-stat"><b style={{ color: "var(--gold)" }}>{me.total_money ?? 0}g</b></span>
          {typeof me.lineup_value === "number" && (
            <span className="live-board-stat">value <b>{me.lineup_value}</b></span>
          )}
        </div>
      </div>

      <div className="live-board-hp-wrap">
        <div className="live-board-hp-bar-bg">
          <div
            className="live-board-hp-bar"
            style={{ width: `${Math.min(100, hp)}%`, background: hpBarColor(hp) }}
          />
        </div>
        <span className="live-board-hp-text">{hp} HP</span>
      </div>

      {units.length === 0 ? (
        <div className="live-board-empty">No units on the board yet.</div>
      ) : (
        <div className="live-board-units">
          {units.map((u, i) => (
            <div
              key={`${u.name}-${i}`}
              className="unit-icon-wrap"
              title={`${u.name}${u.stars > 1 ? ` ${"★".repeat(u.stars)}` : ""}`}
            >
              <img
                className="unit-icon"
                src={`icons://units/${unitStem(u.name)}.png`}
                alt={u.name}
                loading="lazy"
                style={{ borderColor: costBorderColor(unitCosts[u.name] || 1) }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.visibility = "hidden";
                }}
              />
              {u.stars > 1 && (
                <span className={`unit-stars s${u.stars}`}>{"★".repeat(u.stars)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {(synergies.length > 0 || me.relic) && (
        <div className="live-board-foot">
          {synergies.length > 0 && (
            <div className="live-board-syn">
              {synergies.map((s) => (
                <span key={s.stem} className="live-board-syn-item" title={s.stem}>
                  <img
                    src={`icons://synergies/${synIconName(s.stem)}.png`}
                    alt=""
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                  {s.count}
                </span>
              ))}
            </div>
          )}
          {me.relic && <span className="live-board-relic">{me.relic}</span>}
        </div>
      )}
    </section>
  );
}
