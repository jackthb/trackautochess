import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "../types";
import { VideoPlayer } from "./VideoPlayer";
import {
  placementBg,
  parseSynergies,
  parseRelics,
  parseWL,
  toDatetimeLocal,
} from "../lib/game-utils";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { CountedTag } from "./TagPickers";
import { GameEditFields } from "./GameEditFields";
import { MatchTimelinePanel } from "./MatchTimelinePanel";

interface GameRowProps {
  game: Game;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  onUpdate: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
  onDelete: (gameId: number) => Promise<boolean>;
  expanded: boolean;
  onToggle: () => void;
}

// ── Screenshot lightbox ─────────────────────────────────────────────────────

function ScreenshotLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="screenshot-lightbox" onClick={onClose}>
      <img
        className="screenshot-lightbox-img"
        src={src}
        alt="Game screenshot"
        onClick={(e) => e.stopPropagation()}
      />
      <button className="screenshot-lightbox-close" onClick={onClose}>
        &times;
      </button>
    </div>,
    document.body
  );
}

// ── Main GameRow ────────────────────────────────────────────────────────────

export function GameRow({
  game,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  onUpdate,
  onDelete,
  expanded,
  onToggle,
}: GameRowProps) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [replayExists, setReplayExists] = useState(false);
  const [showReplay, setShowReplay] = useState(false);

  // Structured edit state — units have stars, synergies have counts
  const [editPlacement, setEditPlacement] = useState(game.placement || "");
  const [editLevel, setEditLevel] = useState(game.level || "");
  const [editW, setEditW] = useState(0);
  const [editL, setEditL] = useState(0);
  const [editUnits, setEditUnits] = useState<CountedTag[]>([]);
  const [editSynergies, setEditSynergies] = useState<CountedTag[]>([]);
  const [editRankTier, setEditRankTier] = useState("");
  const [editRankNum, setEditRankNum] = useState("");
  const [editRelics, setEditRelics] = useState<string[]>([]);
  const [editPlayedAt, setEditPlayedAt] = useState("");

  const p = parseInt(game.placement) || 0;

  // Check if linked replay file exists locally
  useEffect(() => {
    if (game.replay) {
      window.replays.exists(game.replay).then(setReplayExists);
    }
  }, [game.replay]);

  // Screenshot is already a full URL from Supabase
  const screenshotUrl = game.screenshot || null;

  const resetEditState = useCallback(() => {
    setEditPlacement(game.placement || "");
    setEditLevel(game.level || "");
    const parsedRank = game.rank ? game.rank.split("-") : [];
    setEditRankTier(parsedRank[0] || "");
    setEditRankNum(parsedRank[1] || "");
    const parsedWL = parseWL(game.wl);
    setEditW(parsedWL?.w ?? 0);
    setEditL(parsedWL?.l ?? 0);
    setEditPlayedAt(game.played_at ? toDatetimeLocal(game.played_at) : "");
    // Parse lineup preserving star data as counted tags
    const parsedLineup = (game.lineup || "")
      .split("|")
      .filter(Boolean)
      .map((e) => {
        const m = e.match(/^(.+?)(?:\((\d)\))?$/);
        return {
          name: m ? m[1] : e,
          count: m && m[2] ? parseInt(m[2]) : 1,
        };
      });
    setEditUnits(parsedLineup);
    setEditSynergies(
      parseSynergies(game.synergies).map((s) => ({
        name: s.name,
        count: s.count,
      }))
    );
    setEditRelics(parseRelics(game.relic));
    setConfirmDelete(false);
  }, [game]);

  function handleToggle() {
    if (!expanded) resetEditState();
    onToggle();
  }

  async function handleSave() {
    setSaving(true);
    // Rebuild pipe-separated strings preserving stars/counts
    const lineupStr =
      editUnits
        .map((u) => (u.count > 1 ? `${u.name}(${u.count})` : u.name))
        .join("|") || null;
    const synStr =
      editSynergies.map((s) => `${s.name}:${s.count}`).join("|") || null;
    const relicStr = editRelics.join("|") || null;
    const wlStr = editW || editL ? `${editW}-${editL}` : null;

    const rankStr = editRankTier
      ? editRankNum
        ? `${editRankTier}-${editRankNum}`
        : editRankTier
      : null;

    const ok = await onUpdate(game.id, {
      placement: editPlacement,
      level: editLevel || null,
      rank: rankStr,
      wl: wlStr,
      lineup: lineupStr,
      synergies: synStr,
      relic: relicStr,
      played_at: editPlayedAt ? new Date(editPlayedAt).toISOString() : game.played_at,
    });
    setSaving(false);
    if (ok) onToggle();
  }

  return (
    <div className="game-entry" style={{ background: placementBg(p) }}>
      <GameRowDisplay
        game={game}
        unitCosts={unitCosts}
        unitsFull={unitsFull}
        synergiesData={synergiesData}
        relicsData={relicsData}
        iconUrl={(type, stem) => `icons://${type}/${stem}.png`}
        shareUrl={`https://trackautochess.com/games/${game.id}`}
        onClick={handleToggle}
        style={{ cursor: "pointer" }}
        dateExtra={
          replayExists ? (
            <button
              className="btn-play-replay"
              title="Watch replay"
              onClick={(e) => {
                e.stopPropagation();
                setShowReplay(true);
                if (!expanded) onToggle();
              }}
            >
              &#9654;
            </button>
          ) : undefined
        }
      />

      {expanded && (
        <div className="game-edit-panel" onClick={(e) => e.stopPropagation()}>
          {showReplay && replayExists && game.replay && (
            <div className="replay-player-inline">
              <VideoPlayer
                src={`replay://video/${encodeURIComponent(game.replay)}`}
                autoPlay
              />
              <button
                className="btn-replay-hide"
                onClick={() => setShowReplay(false)}
              >
                Hide replay
              </button>
            </div>
          )}
          <div className="edit-panel-body">
            {screenshotUrl && (
              <div className="edit-screenshot-col">
                <img
                  className="game-screenshot-thumb"
                  src={screenshotUrl}
                  alt="Game screenshot"
                  onClick={() => setLightbox(true)}
                />
              </div>
            )}
            <GameEditFields
              editPlacement={editPlacement}
              editLevel={editLevel}
              editRankTier={editRankTier}
              editRankNum={editRankNum}
              editW={editW}
              editL={editL}
              editUnits={editUnits}
              editSynergies={editSynergies}
              editRelics={editRelics}
              editPlayedAt={editPlayedAt}
              setEditPlacement={setEditPlacement}
              setEditLevel={setEditLevel}
              setEditRankTier={setEditRankTier}
              setEditRankNum={setEditRankNum}
              setEditW={setEditW}
              setEditL={setEditL}
              setEditUnits={setEditUnits}
              setEditSynergies={setEditSynergies}
              setEditRelics={setEditRelics}
              setEditPlayedAt={setEditPlayedAt}
              unitCosts={unitCosts}
              synergiesData={synergiesData}
              relicsData={relicsData}
            />
          </div>
          {game.match_id && (
            <MatchTimelinePanel
              matchId={game.match_id}
              unitCosts={unitCosts}
              unitsFull={unitsFull}
              synergiesData={synergiesData}
              relicsData={relicsData}
            />
          )}
          <div className="edit-panel-actions">
            {!confirmDelete ? (
              <button
                className="btn-confirm btn-confirm-cancel btn-delete-game"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                Delete
              </button>
            ) : (
              <button
                className={`btn-confirm btn-modal-danger${deleting ? " btn-loading" : ""}`}
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  await onDelete(game.id);
                  setDeleting(false);
                }}
              >
                {deleting ? "Deleting" : "Confirm delete"}
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              className="btn-confirm btn-confirm-cancel"
              onClick={() => {
                onToggle();
                setConfirmDelete(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn-confirm btn-confirm-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {lightbox && screenshotUrl && (
        <ScreenshotLightbox
          src={screenshotUrl}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  );
}
