import { useState, useMemo, useEffect } from "react";
import type { Replay, ReplayStats, RecordingStats, Game } from "../types";
import { formatSize, formatDate } from "../lib/game-utils";
import { VideoPlayer } from "./VideoPlayer";

interface ReplaysTabProps {
  replays: Replay[];
  stats: ReplayStats;
  loading: boolean;
  refresh: () => Promise<void>;
  recording: boolean;
  recordingStats: RecordingStats | null;
  games: Game[];
  onViewGame: (gameId: number) => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}


export function ReplaysTab({
  replays,
  stats,
  refresh,
  recording,
  recordingStats,
  games,
  onViewGame,
}: ReplaysTabProps) {
  // Build a map of replay filename -> game for quick lookup
  const replayToGame = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of games) {
      if (g.replay) map.set(g.replay, g);
    }
    return map;
  }, [games]);
  const [currentReplay, setCurrentReplay] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!currentReplay && replays.length > 0) {
      setCurrentReplay(replays[0].name);
    }
  }, [replays, currentReplay]);

  const selectedReplay = replays.find((r) => r.name === currentReplay);

  const handleSelect = (replay: Replay) => {
    setCurrentReplay(replay.name);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    await window.replays.delete(pendingDelete);
    if (currentReplay === pendingDelete) {
      setCurrentReplay(null);
    }
    setPendingDelete(null);
    refresh();
  };

  return (
    <>
      <div className="replays-tab">
        <div className="sidebar">
          <div className="sidebar-header">
            <h2>Replays</h2>
            <div className="sidebar-stats">
              <div>
                <span>{stats.count}</span> replays
              </div>
              <div>
                <span>{(stats.totalBytes / 1024 ** 3).toFixed(1)}</span> GB
                used
              </div>
              <div>
                <span>15</span> GB limit
              </div>
            </div>
          </div>
          <div className="sidebar-actions">
            <button
              className="btn-ghost"
              onClick={() => window.replays.openFolder()}
            >
              Open folder
            </button>
            <button className="btn-ghost" onClick={refresh}>
              Refresh
            </button>
          </div>
          {recording && (
            <div style={{
              padding: "10px 14px",
              margin: "0 0 8px 0",
              background: "rgba(229, 62, 62, 0.12)",
              border: "1px solid rgba(229, 62, 62, 0.3)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#e53e3e",
                animation: "pulse 1.5s ease-in-out infinite",
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: "#e53e3e", fontWeight: 600, fontSize: "12px" }}>
                  Recording in progress
                </div>
                {recordingStats && (
                  <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: 2 }}>
                    {formatElapsed(recordingStats.elapsed)} &middot; {recordingStats.size_mb} MB &middot; {recordingStats.frames} frames
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="replay-list">
            {replays.length === 0 && !recording ? (
              <div className="empty-state" style={{ paddingTop: 60 }}>
                <div className="empty-state-desc">
                  No replays yet. Play a game with the tracker running to record
                  your first replay.
                </div>
              </div>
            ) : (
              replays.map((r) => (
                <div
                  key={r.name}
                  className={`replay-item ${
                    currentReplay === r.name ? "active" : ""
                  }`}
                  onClick={() => handleSelect(r)}
                >
                  <div className="replay-item-info">
                    <div className="replay-item-date">
                      {formatDate(r.mtime)}
                    </div>
                    <div className="replay-item-meta">
                      {formatSize(r.size)}
                    </div>
                  </div>
                  <div className="replay-item-actions">
                    <button
                      className="btn-delete-replay"
                      title="Delete replay"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(r.name);
                      }}
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="player-panel">
          {!selectedReplay ? (
            <div className="empty-state">
              <div className="empty-state-icon">&#9654;</div>
              <div className="empty-state-title">No replay selected</div>
              <div className="empty-state-desc">
                Select a replay from the sidebar to watch it. Replays are
                recorded automatically when you play Dota Auto Chess.
              </div>
            </div>
          ) : (
            <>
              <div className="player-container">
                <VideoPlayer
                  src={`replay://video/${encodeURIComponent(selectedReplay.name)}`}
                />
              </div>
              <div className="replay-info-bar">
                <span className="replay-filename">{selectedReplay.name}</span>
                <div className="replay-info-right">
                  <span>{formatSize(selectedReplay.size)}</span>
                  {replayToGame.has(selectedReplay.name) && (
                    <button
                      className="btn-ghost"
                      onClick={() => onViewGame(replayToGame.get(selectedReplay.name)!.id)}
                    >
                      View game
                    </button>
                  )}
                </div>
              </div>
              <div className="player-shortcuts-hint">
                Space: play/pause &middot; Arrows: skip 5s &middot; S: cycle speed &middot; F: fullscreen
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete modal */}
      {pendingDelete && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDelete(null);
          }}
        >
          <div className="modal-dialog">
            <h3>Delete replay?</h3>
            <p>Delete &quot;{pendingDelete}&quot;? This cannot be undone.</p>
            <div className="modal-actions">
              <button
                className="btn-modal btn-modal-cancel"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                className="btn-modal btn-modal-danger"
                onClick={handleDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
