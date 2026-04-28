import { useMemo } from "react";
import type { Game, DrodoProfile } from "../types";
import { mmrToRank } from "../lib/game-utils";

interface StatsBarProps {
  games: Game[];
  drodo?: DrodoProfile | null;
}

export function StatsBar({ games, drodo }: StatsBarProps) {
  const stats = useMemo(() => {
    if (!games.length) return null;
    const placements = games.map((g) => parseInt(g.placement) || 0);
    const avg = (
      placements.reduce((a, b) => a + b, 0) / placements.length
    ).toFixed(1);
    const top4 = placements.filter((p) => p >= 1 && p <= 4).length;
    const top4pct = ((top4 / games.length) * 100).toFixed(0);
    const wins = placements.filter((p) => p === 1).length;
    return { total: games.length, avg, top4pct, wins };
  }, [games]);

  if (!stats) return null;

  return (
    <div className="stats-bar fade-up">
      <div className="stat-cell">
        <div className="stat-value">{stats.total}</div>
        <div className="stat-label">Games</div>
      </div>
      <div className="stat-cell">
        <div className="stat-value gold">{stats.avg}</div>
        <div className="stat-label">Avg Place</div>
      </div>
      <div className="stat-cell">
        <div className="stat-value green">{stats.top4pct}%</div>
        <div className="stat-label">Top 4 Rate</div>
      </div>
      <div className="stat-cell">
        <div className="stat-value gold">{stats.wins}</div>
        <div className="stat-label">Wins</div>
      </div>
      {drodo && drodo.mmr != null && (
        <div className="stat-cell">
          <div className="stat-value">{drodo.mmr}</div>
          <div className="stat-label">{mmrToRank(drodo.mmr) || "MMR"}</div>
        </div>
      )}
      {drodo && drodo.max_mmr != null && (
        <div className="stat-cell">
          <div className="stat-value gold">{drodo.max_mmr}</div>
          <div className="stat-label">Peak MMR</div>
        </div>
      )}
    </div>
  );
}
