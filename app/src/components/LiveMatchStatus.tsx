import { useMemo } from "react";
import { synIconName, mmrLevelToRank, relicStem } from "../lib/game-utils";
import { ChessBoard } from "@dac/shared/ChessBoard";
import { TooltipWrap, type TooltipData } from "@dac/shared/Tooltip";
import {
  buildChessCodeUnitLookup,
  buildUnitCostLookup,
  parseNettableSynergyBuff,
  resolveChessLineup,
} from "@dac/shared/game-structure";
import type { LivePlayer } from "../hooks/useNetTableEvents";
import type { UnitFullInfo, SynergyInfo, RelicInfo, ItemFullInfo } from "../types";

interface Props {
  /** Extracted per-player live state, keyed by steam_id (or slot_N when the
   *  steam_id isn't known yet). */
  players: Record<string, LivePlayer>;
  /** Steam IDs belonging to the local player. */
  localSteamIds: string[];
  /** Current game round, shown in the standings header. */
  round?: number;
  /** units_full.json — for unit cost (icon border) lookup. */
  unitsFull: Record<string, UnitFullInfo>;
  /** synergies.json (keyed by `is_*` stem) — for activation-tier thresholds. */
  synergiesData: Record<string, SynergyInfo>;
  /** relics.json (keyed by `item_*` gameId) — resolves the live relic code
   *  to a display name + icon. */
  relicsData: Record<string, RelicInfo>;
  itemsFull?: Record<string, ItemFullInfo>;
}

function hpBarColor(hp: number): string {
  if (hp > 60) return "var(--green-bright)";
  if (hp > 30) return "var(--gold)";
  return "var(--red-bright)";
}

interface Seat {
  id: string;
  player: LivePlayer;
  isLocal: boolean;
}

/**
 * Live lobby standings: every player the capture can see (up to 8), sorted by
 * current placement, with the local player highlighted and pinned. Each seat
 * shows HP, level, gold, board position/items, active synergies and
 * relic. Fed by the backend's extracted per-player state — lineups are already
 * resolved from raw chess_* codes and HP is the live value (not the dac_table
 * static-100 sentinel).
 *
 * NetTable carries no player names (only steam_id + slot), so opponents are
 * labelled by placement. Renders nothing until there's at least one capture.
 */
export function LiveMatchStatus({ players, localSteamIds, round, unitsFull, synergiesData, relicsData, itemsFull }: Props) {
  const iconUrl = useMemo(() => (type: string, stem: string) => `icons://${type}/${stem}.png`, []);
  const unitCosts = useMemo(() => buildUnitCostLookup(unitsFull), [unitsFull]);
  const tooltipData = useMemo<TooltipData>(
    () => ({ unitCosts, unitsFull, synergiesData, relicsData, iconUrl }),
    [unitCosts, unitsFull, synergiesData, relicsData, iconUrl],
  );

  // chess_* code → unit metadata, for resolving raw live lineups.
  const chessIdToUnit = useMemo(() => buildChessCodeUnitLookup(unitsFull), [unitsFull]);

  const localIdSet = useMemo(() => new Set(localSteamIds), [localSteamIds]);

  const seats = useMemo<Seat[]>(() => {
    const list: Seat[] = Object.entries(players).map(([id, player]) => ({
      id,
      player,
      isLocal: localIdSet.has(id),
    }));
    // Placement asc (1 = top); unknown placement sinks to the bottom. Local
    // player wins ties so "You" stays visible when placements are equal/absent.
    list.sort((a, b) => {
      const pa = a.player.placement ?? 99;
      const pb = b.player.placement ?? 99;
      if (pa !== pb) return pa - pb;
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [players, localIdSet]);

  if (seats.length === 0) return null;

  return (
    <section className="live-board">
      <style>{`
        .live-board {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-8);
          padding: 10px 12px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .live-board-title {
          font-size: var(--fs-11);
          font-weight: var(--fw-medium);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .live-seats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
          gap: 6px;
        }
        .live-seat {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
          padding: 7px 9px;
          border-radius: var(--r-8);
          background: var(--bg-deep);
          border: 1px solid transparent;
        }
        .live-seat.is-local { border-color: var(--gold); background: var(--bg-surface); }
        .live-seat.is-dead { opacity: 0.5; }
        .live-seat-head {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: var(--fs-12);
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
        .live-seat-rank {
          flex-shrink: 0;
          min-width: 30px;
          font-weight: var(--fw-medium);
          color: var(--text-muted);
        }
        .live-seat-name {
          flex: 1 1 auto;
          font-weight: var(--fw-medium);
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .live-seat.is-local .live-seat-name { color: var(--gold); }
        .live-seat-stat b { color: var(--text-primary); font-weight: var(--fw-medium); }
        .live-seat-skill {
          color: var(--text-secondary);
          font-size: var(--fs-11);
          flex-shrink: 0;
        }
        .live-seat-stat { flex-shrink: 0; white-space: nowrap; }
        .live-seat-hp-wrap { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .live-seat-hp-bar-bg {
          width: 54px; height: 6px;
          background: var(--bg-deep); border: 1px solid var(--border-subtle);
          border-radius: 3px; overflow: hidden;
        }
        .live-seat-hp-bar { height: 100%; border-radius: 3px; transition: width 0.3s ease-out; min-width: 1px; }
        .live-seat-hp-text { font-size: var(--fs-11); color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 34px; }
        .live-seat-board { overflow-x: auto; padding-bottom: 2px; }
        .live-seat-empty { color: var(--text-muted); font-size: var(--fs-11); }
        .live-seat-foot {
          display: flex; align-items: center; gap: 10px;
          font-size: var(--fs-11); color: var(--text-muted);
        }
        .live-seat-syn { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .live-seat-syn-item { display: flex; align-items: center; gap: 3px; }
        .live-seat-syn-item img { width: 16px; height: 16px; }
        .live-seat-relic { display: inline-flex; align-items: center; gap: 4px; color: var(--gold); }
        .live-seat-relic img { width: 16px; height: 16px; border-radius: var(--r-2); }
        .live-seat-relics { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
        .live-seat-relic-icon { width: 18px; height: 18px; border-radius: var(--r-2); border: 1px solid var(--border); }
      `}</style>

      <span className="live-board-title">
        Live standings{round != null ? ` · Round ${round}` : ""} · {seats.length}{" "}
        player{seats.length === 1 ? "" : "s"}
      </span>

      <div className="live-seats">
        {seats.map(({ id, player, isLocal }) => {
          const hp = Math.max(0, player.hp ?? 0);
          const fallbackLineup = resolveChessLineup(player.lineup, chessIdToUnit)
            .map((unit) => `${unit.name}${unit.stars > 1 ? `(${unit.stars})` : ""}`)
            .join("|");
          const hasBoardUnits = Array.isArray(player.board) && player.board.length > 0;
          const hasAnyUnits = hasBoardUnits || fallbackLineup.length > 0;
          const synergies = parseNettableSynergyBuff(player.buff, synergiesData);
          const relicCodes =
            player.relics && player.relics.length > 0
              ? player.relics
              : player.relic
                ? [player.relic]
                : [];
          const label = isLocal
            ? "You"
            : player.placement
              ? `Player #${player.placement}`
              : "Player";
          const skillRank = mmrLevelToRank(player.mmr_level);
          return (
            <div
              key={id}
              className={`live-seat${isLocal ? " is-local" : ""}${hp <= 0 ? " is-dead" : ""}`}
            >
              <div className="live-seat-head">
                <span className="live-seat-rank">
                  {player.placement ? `#${player.placement}` : "—"}
                </span>
                <span className="live-seat-name">{label}</span>
                {skillRank && <span className="live-seat-skill">{skillRank}</span>}
                <span className="live-seat-stat">Lv<b>{player.level ?? "—"}</b></span>
                <span className="live-seat-stat">
                  <b style={{ color: "var(--green-bright)" }}>{player.win_round ?? 0}</b>
                  <span style={{ color: "var(--text-muted)" }}>-</span>
                  <b style={{ color: "var(--red-bright)" }}>{player.lose_round ?? 0}</b>
                </span>
                <span className="live-seat-stat"><b style={{ color: "var(--gold)" }}>{player.total_money ?? 0}g</b></span>
                <div className="live-seat-hp-wrap">
                  <div className="live-seat-hp-bar-bg">
                    <div
                      className="live-seat-hp-bar"
                      style={{ width: `${Math.min(100, hp)}%`, background: hpBarColor(hp) }}
                    />
                  </div>
                  <span className="live-seat-hp-text">{hp} HP</span>
                </div>
              </div>

              {!hasAnyUnits ? (
                <div className="live-seat-empty">No units on the board yet.</div>
              ) : (
                <div className="live-seat-board">
                  <ChessBoard
                    board={player.board}
                    lineup={fallbackLineup}
                    unitCosts={unitCosts}
                    iconUrl={iconUrl}
                    itemsFull={itemsFull}
                    tooltipData={tooltipData}
                    compact
                  />
                </div>
              )}

              {(synergies.length > 0 || relicCodes.length > 0) && (
                <div className="live-seat-foot">
                  {synergies.length > 0 && (
                    <div className="live-seat-syn">
                      {synergies.map((s) => (
                        <TooltipWrap
                          key={s.name}
                          type="synergy"
                          name={s.name}
                          count={s.count}
                          data={tooltipData}
                        >
                          <span className="syn-badge live-seat-syn-item" title={s.name}>
                            <img
                              src={iconUrl("synergies", synIconName(s.name))}
                              alt=""
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                            {s.count}
                          </span>
                        </TooltipWrap>
                      ))}
                    </div>
                  )}
                  {relicCodes.length > 0 && (
                    <div className="live-seat-relics">
                      {relicCodes.map((code, i) => {
                        const info = relicsData[code];
                        const name = info?.name ?? code.replace(/^item_/, "").replace(/_/g, " ");
                        const icon =
                          typeof info?.icon === "string" ? info.icon : undefined;
                        return (
                          <TooltipWrap
                            key={`${code}-${i}`}
                            type="relic"
                            name={name}
                            relicIndex={i}
                            data={tooltipData}
                          >
                            {icon ? (
                              <img
                                className="relic-icon live-seat-relic-icon"
                                src={`icons://${icon}`}
                                alt={name}
                                title={name}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <img
                                className="relic-icon live-seat-relic-icon"
                                src={iconUrl("relics", relicStem(name))}
                                alt={name}
                                title={name}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                            )}
                          </TooltipWrap>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
