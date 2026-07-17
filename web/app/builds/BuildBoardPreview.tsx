"use client";

import type { BuildSnapshot, SavedBuild } from "@/lib/builds/types";
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
}: {
  snapshot: BuildSnapshot;
  compact?: boolean;
}) {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = BOARD_ROWS; y >= 1; y -= 1) {
    for (let x = 1; x <= BOARD_COLS; x += 1) {
      cells.push({ x, y });
    }
  }

  return (
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
                          <img src={item.iconUrl} alt="" className={styles.boardItemImage} />
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
  );
}

export function BuildSnapshotTabs({
  build,
  activeSnapshotId,
  onSelect,
}: {
  build: SavedBuild;
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
