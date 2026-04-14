import { useState, useRef, useEffect, useCallback } from "react";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo, DrodoProfile } from "../types";
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
  drodo?: DrodoProfile | null;
  drodoLoading?: boolean;
  refreshDrodo?: () => Promise<void>;
  focusGameId?: number | null;
  onFocusHandled?: () => void;
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
  drodo,
  drodoLoading,
  refreshDrodo,
  focusGameId,
  onFocusHandled,
}: HistoryTabProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Handle focus request from replays tab
  useEffect(() => {
    if (!focusGameId) return;
    // Ensure enough games are visible
    const idx = games.findIndex((g) => g.id === focusGameId);
    if (idx === -1) {
      onFocusHandled?.();
      return;
    }
    setVisibleCount((prev) => Math.max(prev, idx + 1));
    // Wait for render, then scroll
    requestAnimationFrame(() => {
      const el = gameRefs.current.get(focusGameId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightId(focusGameId);
        setTimeout(() => setHighlightId(null), 2000);
      }
      onFocusHandled?.();
    });
  }, [focusGameId, games, onFocusHandled]);

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
  }, [loadMore, visibleCount]);

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
        <StatsBar games={games} drodo={drodo} />

        {drodo?.seasons && drodo.seasons.length > 1 && (
          <div className="fade-up">
            <div className="section-title">Season History</div>
            <div className="seasons-grid">
              {[...drodo.seasons].reverse().map((s) => (
                <div key={s.season} className="season-card">
                  <div className="season-label">{s.season.toUpperCase()}</div>
                  {s.mmr != null ? (
                    <div className="season-mmr">{s.mmr}</div>
                  ) : (
                    <div className="season-mmr dim">—</div>
                  )}
                  {s.max_mmr != null && (
                    <div className="season-meta">
                      Peak <span className="season-peak">{s.max_mmr}</span>
                    </div>
                  )}
                  {s.games_played != null && (
                    <div className="season-meta">{s.games_played} games</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="history-refresh fade-up">
          <button className="btn-ghost" onClick={refresh}>
            Refresh
          </button>
          {refreshDrodo && (
            <button
              className="btn-ghost"
              disabled={drodoLoading}
              onClick={refreshDrodo}
            >
              {drodoLoading ? "Refreshing..." : "Refresh stats"}
            </button>
          )}
          {lastRefresh && (
            <span className="refresh-time">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          {drodo?.fetched_at && (
            <span className="refresh-time">
              Stats {new Date(drodo.fetched_at).toLocaleString()}
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
            <div
              key={g.id}
              ref={(el) => {
                if (el) gameRefs.current.set(g.id, el);
                else gameRefs.current.delete(g.id);
              }}
              className={highlightId === g.id ? "game-entry-highlight" : undefined}
            >
              <GameRow
                game={g}
                unitCosts={unitCosts}
                unitsFull={unitsFull}
                synergiesData={synergiesData}
                relicsData={relicsData}
                onUpdate={updateGame}
                onDelete={deleteGame}
                expanded={expandedId === g.id}
                onToggle={() => setExpandedId(expandedId === g.id ? null : g.id)}
              />
            </div>
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
