import { useMemo } from "react";
import { parseLineup, unitStem, costBorderColor, synIconName } from "../lib/game-utils";
import type { LivePlayer } from "../hooks/useNetTableEvents";
import type { UnitFullInfo, SynergyInfo } from "../types";

interface Props {
  /** Extracted per-player live state, keyed by steam_id (or slot_N when the
   *  steam_id isn't known yet). */
  players: Record<string, LivePlayer>;
  /** Steam IDs belonging to the local player. */
  localSteamIds: string[];
  /** units_full.json — for unit cost (icon border) lookup. */
  unitsFull: Record<string, UnitFullInfo>;
  /** synergies.json (keyed by `is_*` stem) — for activation-tier thresholds. */
  synergiesData: Record<string, SynergyInfo>;
}

function hpBarColor(hp: number): string {
  if (hp > 60) return "var(--green-bright)";
  if (hp > 30) return "var(--gold)";
  return "var(--red-bright)";
}

/**
 * "is_orc:5,is_shaman:3,is_demon:1," → [{ name: "orc", count: 5 }, …], desc.
 *
 * `firstTier` maps a stem ("orc", "demon") to that synergy's first activation
 * count, so we keep only *active* synergies. The raw `buff` lists every type
 * any unit on the board has — a long tail of :1 entries that overlaps heavily
 * between players (everyone ends up touching naga/god/element/…), which made
 * every seat look like it shared the local player's synergies. Filtering to
 * active tiers leaves the meaningful, per-player-distinct set — and keeps
 * tier-1 synergies like Demon (which activates at 1) that a flat "2+" cut
 * would wrongly hide.
 */
function parseBuff(
  buff: string | undefined,
  firstTier: (stem: string) => number,
): { name: string; count: number }[] {
  if (!buff) return [];
  return buff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [raw, count] = entry.split(":");
      return { name: raw.replace(/^is_/, ""), count: Number(count) || 0 };
    })
    .filter((s) => s.count >= firstTier(s.name))
    .sort((a, b) => b.count - a.count);
}

interface Seat {
  id: string;
  player: LivePlayer;
  isLocal: boolean;
}

/**
 * Live lobby standings: every player the capture can see (up to 8), sorted by
 * current placement, with the local player highlighted and pinned. Each seat
 * shows HP, level, gold, board (unit icons + stars), active synergies and
 * relic. Fed by the backend's extracted per-player state — lineups are already
 * resolved from raw chess_* codes and HP is the live value (not the dac_table
 * static-100 sentinel).
 *
 * NetTable carries no player names (only steam_id + slot), so opponents are
 * labelled by placement. Renders nothing until there's at least one capture.
 */
export function LiveMatchStatus({ players, localSteamIds, unitsFull, synergiesData }: Props) {
  const unitCosts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [name, info] of Object.entries(unitsFull)) {
      out[name] = Number(info.cost) || 0;
    }
    return out;
  }, [unitsFull]);

  const localIdSet = useMemo(() => new Set(localSteamIds), [localSteamIds]);

  // Synergy stem ("orc", "demon") → its first activation count. Synergies
  // missing tier data default to 2 (the common first tier).
  const firstTier = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, info] of Object.entries(synergiesData)) {
      const tier = Array.isArray(info.tiers) ? info.tiers[0] : undefined;
      if (typeof tier === "number") out[key.replace(/^is_/, "")] = tier;
    }
    return (stem: string) => out[stem] ?? 2;
  }, [synergiesData]);

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
          padding: 12px 16px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .live-board-title {
          font-size: var(--fs-11);
          font-weight: var(--fw-medium);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .live-seats {
          display: flex;
          flex-direction: column;
          gap: 6px;
          /* The home page itself doesn't scroll (overflow: hidden), so with a
           * full 8-player lobby the lower seats would be clipped off-screen.
           * Cap the list and let it scroll internally instead. */
          max-height: 55vh;
          overflow-y: auto;
        }
        .live-seat {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px 10px;
          border-radius: var(--r-8);
          background: var(--bg-deep);
          border: 1px solid transparent;
        }
        .live-seat.is-local { border-color: var(--gold); background: var(--bg-surface); }
        .live-seat.is-dead { opacity: 0.5; }
        .live-seat-head {
          display: flex;
          align-items: center;
          gap: 12px;
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
        .live-seat-hp-wrap { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .live-seat-hp-bar-bg {
          width: 70px; height: 6px;
          background: var(--bg-deep); border: 1px solid var(--border-subtle);
          border-radius: 3px; overflow: hidden;
        }
        .live-seat-hp-bar { height: 100%; border-radius: 3px; transition: width 0.3s ease-out; min-width: 1px; }
        .live-seat-hp-text { font-size: var(--fs-11); color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 34px; }
        .live-seat-units { display: flex; flex-wrap: wrap; gap: 3px; }
        .live-seat-empty { color: var(--text-muted); font-size: var(--fs-11); }
        .live-seat-foot {
          display: flex; align-items: center; gap: 12px;
          font-size: var(--fs-11); color: var(--text-muted);
        }
        .live-seat-syn { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .live-seat-syn-item { display: flex; align-items: center; gap: 3px; }
        .live-seat-syn-item img { width: 16px; height: 16px; }
        .live-seat-relic { color: var(--gold); }
      `}</style>

      <span className="live-board-title">
        Live standings · {seats.length} player{seats.length === 1 ? "" : "s"}
      </span>

      <div className="live-seats">
        {seats.map(({ id, player, isLocal }) => {
          const hp = Math.max(0, player.hp ?? 0);
          const units = parseLineup(player.lineup || "", unitCosts);
          const synergies = parseBuff(player.buff, firstTier);
          const label = isLocal
            ? "You"
            : player.placement
              ? `Player #${player.placement}`
              : "Player";
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

              {units.length === 0 ? (
                <div className="live-seat-empty">No units on the board yet.</div>
              ) : (
                <div className="live-seat-units">
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

              {(synergies.length > 0 || player.relic) && (
                <div className="live-seat-foot">
                  {synergies.length > 0 && (
                    <div className="live-seat-syn">
                      {synergies.map((s) => (
                        <span key={s.name} className="live-seat-syn-item" title={s.name}>
                          <img
                            src={`icons://synergies/${synIconName(s.name)}.png`}
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
                  {player.relic && <span className="live-seat-relic">{player.relic}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
