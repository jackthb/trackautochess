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
  updateGame: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
  onViewGame: (gameId: number) => void;
}

// Games shown in the manual-assignment dropdown must have been played within
// this many days of the replay's recorded mtime. Matches the user's "within
// one or two days" request.
const ASSIGN_WINDOW_DAYS: number = 2;

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
  updateGame,
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
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!currentReplay && replays.length > 0) {
      setCurrentReplay(replays[0].name);
    }
  }, [replays, currentReplay]);

  const selectedReplay = replays.find((r) => r.name === currentReplay);
  const linkedGame = selectedReplay ? replayToGame.get(selectedReplay.name) : null;

  // Games played within ±ASSIGN_WINDOW_DAYS of the replay's mtime that aren't
  // already linked to a different replay. Used to populate the "Link to game"
  // dropdown.
  const candidateGames = useMemo(() => {
    if (!selectedReplay) return [];
    const replayTime = selectedReplay.mtime;
    const windowMs = ASSIGN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return games
      .filter((g) => {
        if (g.replay && g.replay !== selectedReplay.name) return false;
        const played = new Date(g.played_at).getTime();
        if (!Number.isFinite(played)) return false;
        return Math.abs(played - replayTime) <= windowMs;
      })
      .sort((a, b) => {
        const da = Math.abs(new Date(a.played_at).getTime() - replayTime);
        const db = Math.abs(new Date(b.played_at).getTime() - replayTime);
        return da - db;
      })
      .slice(0, 15);
  }, [games, selectedReplay]);

  const handleSelect = (replay: Replay) => {
    setCurrentReplay(replay.name);
  };

  const handleAssign = async (gameId: number) => {
    if (!selectedReplay || assigning) return;
    setAssigning(true);
    await updateGame(gameId, { replay: selectedReplay.name });
    setAssigning(false);
  };

  const handleUnassign = async () => {
    if (!linkedGame || assigning) return;
    setAssigning(true);
    await updateGame(linkedGame.id, { replay: null });
    setAssigning(false);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    await window.replays.delete(pendingDelete);
    if (currentReplay === pendingDelete) {
      setCurrentReplay(null);
    }
    setPendingDelete(null);
    setDeleting(false);
    refresh();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
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
            <button
              className={`btn-ghost${refreshing ? " btn-loading" : ""}`}
              disabled={refreshing}
              onClick={handleRefresh}
            >
              {refreshing ? "Refreshing" : "Refresh"}
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
                  {linkedGame ? (
                    <>
                      <button
                        className="btn-ghost"
                        onClick={() => onViewGame(linkedGame.id)}
                      >
                        View game
                      </button>
                      <button
                        className="btn-ghost"
                        disabled={assigning}
                        onClick={handleUnassign}
                        title="Remove the link between this replay and its game"
                      >
                        Unlink
                      </button>
                    </>
                  ) : candidateGames.length > 0 ? (
                    <select
                      className="btn-ghost"
                      disabled={assigning}
                      defaultValue=""
                      onChange={(e) => {
                        const id = parseInt(e.target.value, 10);
                        if (!Number.isNaN(id)) handleAssign(id);
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="" disabled>
                        Link to game…
                      </option>
                      {candidateGames.map((g) => {
                        const played = new Date(g.played_at);
                        const label = `#${g.placement ?? "?"} · ${played.toLocaleString()}${g.rank ? ` · ${g.rank}` : ""}`;
                        return (
                          <option key={g.id} value={g.id}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      No games within {ASSIGN_WINDOW_DAYS} day
                      {ASSIGN_WINDOW_DAYS === 1 ? "" : "s"}
                    </span>
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
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className={`btn-modal btn-modal-danger${deleting ? " btn-loading" : ""}`}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
