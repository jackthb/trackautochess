import { useState, useRef, useEffect, useCallback } from "react";
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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasMore = visibleCount < games.length;

  const loadMore = useCallback(() => {
    if (hasMore) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, games.length));
    }
  }, [hasMore, games.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Reset visible count when games list changes (refresh/delete)
  useEffect(() => {
    setVisibleCount((prev) => Math.min(prev, Math.max(PAGE_SIZE, games.length)));
  }, [games.length]);

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

  const visibleGames = games.slice(0, visibleCount);

  return (
    <div className="history-tab" ref={containerRef}>
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
          {visibleGames.map((g) => (
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
        {hasMore && (
          <div ref={sentinelRef} className="infinite-scroll-sentinel">
            <div className="loading">Loading more</div>
          </div>
        )}
      </div>
    </div>
  );
}
