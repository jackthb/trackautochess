import type { ChessBoardPiece, ItemFullInfo } from "./types";
import { costBorderColor, itemDisplayName, itemIconStem, parseLineup, unitStem } from "./game-utils";

const BOARD_COLS = 8;
const BOARD_ROWS = 4;

interface RenderPiece {
  key: string;
  name: string;
  stars: number;
  x: number;
  y: number;
  items: string[];
  raw?: ChessBoardPiece;
}

export interface ChessBoardProps {
  board?: ChessBoardPiece[] | null;
  lineup?: string | null;
  unitCosts: Record<string, number>;
  iconUrl: (type: string, stem: string) => string;
  itemsFull?: Record<string, ItemFullInfo>;
  className?: string;
  compact?: boolean;
}

function boundedCoord(value: unknown, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > max) return null;
  return rounded;
}

function normalizeBoard(board: ChessBoardPiece[] | null | undefined): RenderPiece[] {
  if (!Array.isArray(board)) return [];
  const pieces: RenderPiece[] = [];
  board.forEach((piece, index) => {
    const name = String(piece.name || "").trim();
    if (!name) return;
    const x = boundedCoord(piece.x, BOARD_COLS);
    const y = boundedCoord(piece.y, BOARD_ROWS);
    if (x == null || y == null) return;
    const items = Array.from(new Set([
      ...(Array.isArray(piece.items) ? piece.items : []),
      ...(Array.isArray(piece.last_items) ? piece.last_items : []),
    ].filter(Boolean)));
    pieces.push({
      key: piece.slot_key || piece.chess || `${name}-${index}`,
      name,
      stars: Math.max(1, Math.min(3, Number(piece.stars) || 1)),
      x,
      y,
      items,
      raw: piece,
    });
  });
  return pieces.sort((a, b) => a.y - b.y || a.x - b.x || a.key.localeCompare(b.key));
}

function fallbackBoard(lineup: string | null | undefined, unitCosts: Record<string, number>): RenderPiece[] {
  return parseLineup(lineup || "", unitCosts)
    .slice(0, BOARD_COLS * BOARD_ROWS)
    .map((unit, index) => ({
      key: `${unit.name}-${index}`,
      name: unit.name,
      stars: unit.stars,
      x: (index % BOARD_COLS) + 1,
      y: Math.floor(index / BOARD_COLS) + 1,
      items: [],
    }));
}

function pieceTitle(piece: RenderPiece, itemsFull?: Record<string, ItemFullInfo>): string {
  const bits = [
    piece.name,
    piece.stars > 1 ? `${piece.stars} stars` : "",
    piece.items.length
      ? `Items: ${piece.items.map((item) => itemDisplayName(item, itemsFull)).join(", ")}`
      : "",
  ].filter(Boolean);
  return bits.join(" - ");
}

function displayRow(y: number): number {
  return BOARD_ROWS + 1 - y;
}

export function ChessBoard({
  board,
  lineup,
  unitCosts,
  iconUrl,
  itemsFull,
  className,
  compact = false,
}: ChessBoardProps) {
  const positioned = normalizeBoard(board);
  const pieces = positioned.length > 0 ? positioned : fallbackBoard(lineup, unitCosts);
  const classes = [
    "chess-board",
    compact ? "chess-board-compact" : "",
    positioned.length === 0 ? "chess-board-fallback" : "",
    className || "",
  ].filter(Boolean).join(" ");

  if (pieces.length === 0) {
    return <div className={`${classes} chess-board-empty`} />;
  }

  return (
    <div className={classes}>
      {Array.from({ length: BOARD_COLS * BOARD_ROWS }, (_, index) => (
        <div
          key={index}
          className="chess-board-cell"
          style={{
            gridColumn: (index % BOARD_COLS) + 1,
            gridRow: Math.floor(index / BOARD_COLS) + 1,
          }}
        />
      ))}
      {pieces.map((piece) => (
        <div
          key={piece.key}
          className="chess-board-piece"
          style={{ gridColumn: piece.x, gridRow: displayRow(piece.y) }}
          title={pieceTitle(piece, itemsFull)}
        >
          <img
            className="chess-board-piece-icon"
            src={iconUrl("units", unitStem(piece.name))}
            alt={piece.name}
            loading="lazy"
            style={{ borderColor: costBorderColor(unitCosts[piece.name] || piece.raw?.buy_price || 1) }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
          {piece.stars > 1 && (
            <span className={`chess-board-stars s${piece.stars}`}>
              {"*".repeat(piece.stars)}
            </span>
          )}
          {piece.items.length > 0 && (
            <span className="chess-board-items" aria-label={`${piece.items.length} items`}>
              {piece.items.slice(0, 3).map((item, index) => (
                <img
                  key={`${item}-${index}`}
                  src={iconUrl("items", itemIconStem(item, itemsFull))}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ))}
            </span>
          )}
          {piece.items.length > 0 && (
            <span className="chess-board-item-tooltip" role="tooltip">
              {piece.items.slice(0, 6).map((item, index) => (
                <span className="chess-board-item-row" key={`${item}-tooltip-${index}`}>
                  <img
                    src={iconUrl("items", itemIconStem(item, itemsFull))}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <span>{itemDisplayName(item, itemsFull)}</span>
                </span>
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
