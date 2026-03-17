import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "../types";
import { StatsBar } from "./StatsBar";
import { GameRow } from "./GameRow";

interface HistoryTabProps {
  games: Game[];
  loading: boolean;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  lastRefresh: Date | null;
  refresh: () => Promise<void>;
}

export function HistoryTab({
  games,
  loading,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  lastRefresh,
  refresh,
}: HistoryTabProps) {
  if (loading) {
    return (
      <div className="history-tab">
        <div className="history-container">
          <div className="loading">Fetching matches</div>
        </div>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="history-tab">
        <div className="history-container">
          <div className="history-empty">
            No matches recorded yet. Use the tracker to capture games.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="history-tab">
      <div className="history-container">
        <StatsBar games={games} />
        <div className="history-refresh fade-up">
          <button className="btn-ghost" onClick={refresh}>
            Refresh
          </button>
          {lastRefresh && (
            <span className="refresh-time">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="table-wrap fade-up delay-1">
          <div className="table-header">
            <div className="th">#</div>
            <div className="th">Lineup</div>
            <div className="th">Rank</div>
            <div className="th">W &ndash; L</div>
            <div className="th">Lvl</div>
            <div className="th">Relic</div>
            <div className="th">Date</div>
          </div>
          {games.map((g) => (
            <GameRow
              key={g.id}
              game={g}
              unitCosts={unitCosts}
              unitsFull={unitsFull}
              synergiesData={synergiesData}
              relicsData={relicsData}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
