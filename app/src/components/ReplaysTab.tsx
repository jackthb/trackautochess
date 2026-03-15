import { useState } from "react";
import type { Replay, ReplayStats } from "../types";
import { formatSize, formatDate } from "../lib/game-utils";

interface ReplaysTabProps {
  replays: Replay[];
  stats: ReplayStats;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function ReplaysTab({
  replays,
  stats,
  refresh,
}: ReplaysTabProps) {
  const [currentReplay, setCurrentReplay] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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
          <div className="replay-list">
            {replays.length === 0 ? (
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
                <div className="player-wrapper">
                  <video
                    key={selectedReplay.name}
                    controls
                    src={`replay://video/${encodeURIComponent(
                      selectedReplay.name
                    )}`}
                  />
                </div>
              </div>
              <div className="replay-info-bar">
                <span className="replay-filename">{selectedReplay.name}</span>
                <span>{formatSize(selectedReplay.size)}</span>
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
