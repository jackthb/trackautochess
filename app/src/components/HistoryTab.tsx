import { useState } from "react";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "../types";
import { StatsBar } from "./StatsBar";
import { GameRow } from "./GameRow";

const PAGE_SIZE = 20;

interface HistoryTabProps {
  games: Game[];
  loading: boolean;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  lastRefresh: Date | null;
  refresh: () => Promise<void>;
  updateGame: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
  deleteGame: (gameId: number) => Promise<boolean>;
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
  updateGame,
  deleteGame,
}: HistoryTabProps) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  const pageGames = games.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
          {pageGames.map((g) => (
            <GameRow
              key={g.id}
              game={g}
              unitCosts={unitCosts}
              unitsFull={unitsFull}
              synergiesData={synergiesData}
              relicsData={relicsData}
              onUpdate={updateGame}
              onDelete={deleteGame}
            />
          ))}
        </div>
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="btn-ghost"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Prev
            </button>
            <span className="pagination-info">
              {page + 1} / {totalPages}
            </span>
            <button
              className="btn-ghost"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
