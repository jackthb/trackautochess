"use client";

import { useMemo } from "react";
import { synIconName } from "@dac/shared/game-utils";
import { computeSynergies } from "@/lib/units";
import { getActiveSynergyTier } from "@/lib/synergies";
import type { BuildSnapshot } from "@/lib/builds/types";
import styles from "./builds.module.css";

const BOARD_COLS = 8;
const BOARD_ROWS = 4;
const BOARD_PREVIEW_ITEMS = 6;

function costColor(cost: number) {
  if (cost === 5) return "#f2bc64";
  if (cost === 4) return "#d997ff";
  if (cost === 3) return "#6aa7ff";
  if (cost === 2) return "#8ac66e";
  return "#c6ccd8";
}

export function BuildBoardPreview({
  snapshot,
  compact = false,
  showSynergies = false,
}: {
  snapshot: BuildSnapshot;
  compact?: boolean;
  showSynergies?: boolean;
}) {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = BOARD_ROWS; y >= 1; y -= 1) {
    for (let x = 1; x <= BOARD_COLS; x += 1) {
      cells.push({ x, y });
    }
  }

  const synergies = useMemo(() => {
    if (!showSynergies) return [];
    return computeSynergies(
      snapshot.pieces.map((piece) => ({
        name: piece.name,
        items: piece.items.map((item) => item.slug),
      })),
    );
  }, [showSynergies, snapshot.pieces]);

  return (
    <div className={styles.boardPanel}>
      {synergies.length > 0 && (
        <div className={styles.boardSynergies}>
          {synergies.map((synergy) => (
            <div key={synergy.name} className={`syn-badge ${styles.boardSynBadge}`}>
              <img
                className="syn-icon"
                src={`/icons/synergies/${synIconName(synergy.name)}.png`}
                alt={synergy.name}
                loading="lazy"
              />
              <span className="syn-count">
                {getActiveSynergyTier(synergy.name, synergy.count)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        className={`${styles.board} ${compact ? styles.previewBoard : ""}`}
        aria-label={`Round ${snapshot.round} board`}
      >
        {cells.map((cell) => {
          const piece =
            snapshot.pieces.find((p) => p.x === cell.x && p.y === cell.y) ?? null;
          return (
            <div
              key={`${cell.x}-${cell.y}`}
              className={`${styles.cell} ${styles.previewCell} ${
                piece ? styles.occupiedCell : ""
              }`}
            >
              {piece && (
                <span className={styles.pieceDropTarget}>
                  <span className={styles.piece} style={{ borderColor: costColor(piece.cost) }}>
                    <img src={piece.iconUrl} alt={piece.name} />
                    {piece.stars > 1 && (
                      <span className={styles.stars}>{"*".repeat(piece.stars)}</span>
                    )}
                    {piece.items.length > 0 && (
                      <span className={styles.itemStrip}>
                        {piece.items.slice(0, BOARD_PREVIEW_ITEMS).map((item, index) => (
                          <span key={`${item.slug}-${index}`} className={styles.boardItemIcon}>
                            <img
                              src={item.iconUrl}
                              alt={item.name}
                              title={item.name}
                              className={styles.boardItemImage}
                            />
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BuildSnapshotTabs({
  build,
  activeSnapshotId,
  onSelect,
}: {
  build: { snapshots: BuildSnapshot[] };
  activeSnapshotId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={styles.roundTabs}>
      {build.snapshots.map((snap) => (
        <button
          type="button"
          key={snap.id}
          className={`${styles.roundTab} ${
            snap.id === activeSnapshotId ? styles.activeRoundTab : ""
          }`}
          onClick={() => onSelect(snap.id)}
        >
          R{snap.round}
        </button>
      ))}
    </div>
  );
}
