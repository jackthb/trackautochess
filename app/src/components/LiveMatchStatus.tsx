import { useMemo } from "react";
import { placementColor, mmrLevelToRank } from "../lib/game-utils";
import type { NetTableState } from "../hooks/useNetTableEvents";

interface Props {
  state: NetTableState;
}

interface PlayerRow {
  steamId: string;
  hp: number;
  level: number;
  wins: number;
  losses: number;
  gold: number;
  unitCount: number;
  rank: number;
  mmrRank: string;
}

function hpBarColor(hp: number): string {
  if (hp > 60) return "var(--green-bright)";
  if (hp > 30) return "var(--gold)";
  return "var(--red-bright)";
}

function extractPlayers(state: NetTableState): {
  players: PlayerRow[];
  round: number;
} | null {
  const pit = state["CustomNetTable_player_info_table"]?.player_info as
    | Record<string, unknown>
    | undefined;
  const dat = state["CustomNetTable_dac_table"]?.player_info as
    | Record<string, unknown>
    | undefined;

  const rawData = (pit as { raw?: { data?: Record<string, unknown> } })?.raw
    ?.data as Record<string, Record<string, unknown>> | undefined;
  const rawInfo = (dat as { raw?: { info?: Record<string, unknown> } })?.raw
    ?.info as Record<string, Record<string, unknown>> | undefined;

  if (!rawData) return null;

  const steamIds = Object.keys(rawData);
  if (steamIds.length === 0) return null;

  let maxRound = 0;
  const players: PlayerRow[] = [];

  for (const sid of steamIds) {
    const p = rawData[sid];
    if (!p) continue;

    const round = Number(p.round) || 0;
    const wins = Number(p.win_round) || 0;
    const losses = Number(p.lose_round) || 0;
    if (round === 0 && wins === 0 && losses === 0) continue;

    if (round > maxRound) maxRound = round;

    const dacPlayer = rawInfo?.[sid];
    const hp = Number(dacPlayer?.hp ?? p.hp ?? 0);
    const rank = Number(dacPlayer?.curr_rank ?? 0);

    const lineupStr = String(p.chess_lineup ?? "");
    const unitCount = lineupStr
      .split(",")
      .filter((s: string) => s.trim().length > 0).length;

    players.push({
      steamId: sid,
      hp,
      level: Number(p.hero_level) || 1,
      wins,
      losses,
      gold: Number(p.total_money) || 0,
      unitCount,
      rank,
      mmrRank: mmrLevelToRank(Number(p.mmr_level) || 0),
    });
  }

  if (players.length === 0 || maxRound === 0) return null;

  players.sort((a, b) => {
    if (a.rank > 0 && b.rank > 0) return a.rank - b.rank;
    if (a.rank > 0) return -1;
    if (b.rank > 0) return 1;
    return b.hp - a.hp;
  });

  return { players, round: maxRound };
}

export function LiveMatchStatus({ state }: Props) {
  const data = useMemo(() => extractPlayers(state), [state]);

  if (!data) return null;

  const { players, round } = data;

  return (
    <section className="live-match-status">
      <style>{`
        .live-match-status {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-8);
          padding: 12px 16px;
          flex-shrink: 0;
        }
        .live-match-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .live-match-title {
          font-size: var(--fs-11);
          font-weight: var(--fw-medium);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .live-match-round {
          font-size: var(--fs-12);
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
        .live-match-rows {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .live-match-row {
          display: grid;
          grid-template-columns: 24px 64px 1fr 28px 52px 40px 28px;
          gap: 8px;
          align-items: center;
          padding: 4px 6px;
          border-radius: var(--r-0);
          transition: background var(--t-fast) var(--t-easing);
        }
        .live-match-row:hover {
          background: var(--bg-hover);
        }
        .live-match-rank {
          font-family: var(--font-display);
          font-size: var(--fs-14);
          font-weight: var(--fw-bold);
          text-align: center;
          line-height: 1;
        }
        .live-match-hp-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .live-match-hp-bar-bg {
          flex: 1;
          height: 6px;
          background: var(--bg-deep);
          border-radius: 3px;
          overflow: hidden;
        }
        .live-match-hp-bar {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s ease-out;
          min-width: 1px;
        }
        .live-match-hp-text {
          font-size: var(--fs-11);
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
          min-width: 24px;
          text-align: right;
        }
        .live-match-level {
          font-size: var(--fs-12);
          color: var(--text-muted);
          text-align: center;
          font-variant-numeric: tabular-nums;
        }
        .live-match-wl {
          font-size: var(--fs-11);
          font-variant-numeric: tabular-nums;
          text-align: center;
        }
        .live-match-gold {
          font-size: var(--fs-11);
          color: var(--gold);
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .live-match-mmr-rank {
          font-size: 9px;
          color: var(--text-muted);
          letter-spacing: 0.3px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .live-match-units {
          font-size: var(--fs-11);
          color: var(--text-muted);
          text-align: center;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
      <div className="live-match-header">
        <span className="live-match-title">Live match</span>
        <span className="live-match-round">Round {round}</span>
      </div>
      <div className="live-match-rows">
        {players.map((p, i) => {
          const placement = p.rank > 0 ? p.rank : i + 1;
          const pColor = placementColor(placement);
          return (
            <div key={p.steamId} className="live-match-row">
              <span className="live-match-rank" style={{ color: pColor }}>
                {placement}
              </span>
              <span className="live-match-mmr-rank">{p.mmrRank || "—"}</span>
              <div className="live-match-hp-wrap">
                <div className="live-match-hp-bar-bg">
                  <div
                    className="live-match-hp-bar"
                    style={{
                      width: `${Math.max(0, Math.min(100, p.hp))}%`,
                      background: hpBarColor(p.hp),
                    }}
                  />
                </div>
                <span className="live-match-hp-text">{p.hp}</span>
              </div>
              <span className="live-match-level">Lv{p.level}</span>
              <span className="live-match-wl">
                <span style={{ color: "var(--green-bright)" }}>{p.wins}</span>
                <span style={{ color: "var(--text-muted)" }}>-</span>
                <span style={{ color: "var(--red-bright)" }}>{p.losses}</span>
              </span>
              <span className="live-match-gold">{p.gold}g</span>
              <span className="live-match-units">{p.unitCount}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
