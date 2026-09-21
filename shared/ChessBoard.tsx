"use client";

import { useId, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ChessBoardPiece, ItemFullInfo } from "./types";
import {
  costBorderColor,
  itemDisplayName,
  itemIconStem,
  parseLineup,
  unitStem,
} from "./game-utils";
import { TooltipWrap, type TooltipData } from "./Tooltip";

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
  hand?: string | null;
  unitCosts: Record<string, number>;
  iconUrl: (type: string, stem: string) => string;
  itemsFull?: Record<string, ItemFullInfo>;
  tooltipData?: TooltipData;
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

function normalizeBoard(
  board: ChessBoardPiece[] | null | undefined,
): RenderPiece[] {
  if (!Array.isArray(board)) return [];
  const pieces: RenderPiece[] = [];
  board.forEach((piece, index) => {
    const name = String(piece.name || "").trim();
    if (!name) return;
    const x = boundedCoord(piece.x, BOARD_COLS);
    const y = boundedCoord(piece.y, BOARD_ROWS);
    if (x == null || y == null) return;
    const items = Array.from(
      new Set(
        [
          ...(Array.isArray(piece.items) ? piece.items : []),
          ...(Array.isArray(piece.last_items) ? piece.last_items : []),
        ].filter(Boolean),
      ),
    );
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
  return pieces.sort(
    (a, b) => a.y - b.y || a.x - b.x || a.key.localeCompare(b.key),
  );
}

function fallbackBoard(
  lineup: string | null | undefined,
  unitCosts: Record<string, number>,
): RenderPiece[] {
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

function fallbackHand(
  hand: string | null | undefined,
  unitCosts: Record<string, number>,
): RenderPiece[] {
  return parseLineup(hand || "", unitCosts)
    .slice(0, BOARD_COLS)
    .map((unit, index) => ({
      key: `hand-${unit.name}-${index}`,
      name: unit.name,
      stars: unit.stars,
      x: index + 1,
      y: 1,
      items: [],
    }));
}

function pieceTitle(
  piece: RenderPiece,
  itemsFull?: Record<string, ItemFullInfo>,
): string {
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

function ChessBoardItemTooltip({
  items,
  itemsFull,
  iconUrl,
  style,
  id,
}: {
  items: string[];
  itemsFull?: Record<string, ItemFullInfo>;
  iconUrl: (type: string, stem: string) => string;
  style?: CSSProperties;
  id: string;
}) {
  return (
    <span id={id} className="chess-board-item-tooltip" role="tooltip" style={style}>
      {items.slice(0, 6).map((item, index) => (
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
  );
}

function ChessBoardPieceView({
  piece,
  unitCosts,
  iconUrl,
  itemsFull,
  tooltipData,
  className,
  style,
}: {
  piece: RenderPiece;
  unitCosts: Record<string, number>;
  iconUrl: (type: string, stem: string) => string;
  itemsFull?: Record<string, ItemFullInfo>;
  tooltipData?: TooltipData;
  className?: string;
  style?: CSSProperties;
}) {
  const [tooltipPos, setTooltipPos] = useState<{
    left: number;
    top: number;
    placement: "above" | "below";
  } | null>(null);
  const itemTooltipId = useId();

  const showItems = (target: HTMLDivElement) => {
    if (piece.items.length === 0) return;
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 190;
    const margin = 8;
    const placement = rect.top < 92 ? "below" : "above";
    const left = Math.max(
      margin,
      Math.min(
        rect.left + rect.width / 2 - tooltipWidth / 2,
        window.innerWidth - tooltipWidth - margin,
      ),
    );
    setTooltipPos({
      left,
      top: placement === "below" ? rect.bottom + margin : rect.top - margin,
      placement,
    });
  };

  const hideItems = () => setTooltipPos(null);
  const title = pieceTitle(piece, itemsFull);

  const pieceVisual = (
    <>
      <img
        className="chess-board-piece-icon"
        src={iconUrl("units", unitStem(piece.name))}
        alt={piece.name}
        loading="lazy"
        style={{
          borderColor: costBorderColor(
            unitCosts[piece.name] || piece.raw?.buy_price || 1,
          ),
        }}
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
        <span
          className="chess-board-items"
          aria-label={`${piece.items.length} items`}
        >
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
    </>
  );

  return (
    <div
      className={["chess-board-piece", className || ""]
        .filter(Boolean)
        .join(" ")}
      style={style ?? { gridColumn: piece.x, gridRow: displayRow(piece.y) }}
      title={piece.items.length > 0 ? undefined : title}
      aria-label={title}
      tabIndex={!tooltipData && piece.items.length > 0 ? 0 : undefined}
      aria-describedby={!tooltipData && tooltipPos ? itemTooltipId : undefined}
      onMouseEnter={(event) => showItems(event.currentTarget)}
      onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) hideItems(); }}
      onFocus={(event) => showItems(event.currentTarget)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) hideItems(); }}
      onKeyDown={(event) => { if (event.key === "Escape") hideItems(); }}
    >
      {tooltipData ? (
        <TooltipWrap
          type="unit"
          name={piece.name}
          stars={piece.stars}
          data={tooltipData}
        >
          <span
            className="chess-board-piece-tooltip-target"
            tabIndex={piece.items.length > 0 ? 0 : undefined}
            aria-label={title}
            aria-describedby={tooltipPos ? itemTooltipId : undefined}
          >
            {pieceVisual}
          </span>
        </TooltipWrap>
      ) : (
        pieceVisual
      )}
      {tooltipPos &&
        createPortal(
          <ChessBoardItemTooltip
            id={itemTooltipId}
            items={piece.items}
            itemsFull={itemsFull}
            iconUrl={iconUrl}
            style={{
              left: tooltipPos.left,
              top: tooltipPos.top,
              transform:
                tooltipPos.placement === "above"
                  ? "translateY(-100%)"
                  : undefined,
            }}
          />,
          document.body,
        )}
    </div>
  );
}

export function ChessBoard({
  board,
  lineup,
  hand,
  unitCosts,
  iconUrl,
  itemsFull,
  tooltipData,
  className,
  compact = false,
}: ChessBoardProps) {
  const positioned = normalizeBoard(board);
  const pieces =
    positioned.length > 0 ? positioned : fallbackBoard(lineup, unitCosts);
  const handPieces = fallbackHand(hand, unitCosts);
  const classes = [
    "chess-board",
    compact ? "chess-board-compact" : "",
    positioned.length === 0 ? "chess-board-fallback" : "",
    handPieces.length > 0 ? "chess-board-with-hand" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  if (pieces.length === 0 && handPieces.length === 0) {
    return <div className={`${classes} chess-board-empty`} />;
  }

  return (
    <div className={classes}>
      {handPieces.length > 0 && (
        <>
          <div className="chess-board-hand" aria-label="Hand">
            {Array.from({ length: BOARD_COLS }, (_, index) => (
              <div key={`hand-cell-${index}`} className="chess-board-hand-cell">
                {handPieces[index] && (
                  <ChessBoardPieceView
                    piece={handPieces[index]}
                    unitCosts={unitCosts}
                    iconUrl={iconUrl}
                    itemsFull={itemsFull}
                    tooltipData={tooltipData}
                    className="chess-board-hand-piece"
                    style={{}}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="chess-board-hand-label">HAND</div>
        </>
      )}
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
        <ChessBoardPieceView
          key={piece.key}
          piece={piece}
          unitCosts={unitCosts}
          iconUrl={iconUrl}
          itemsFull={itemsFull}
          tooltipData={tooltipData}
        />
      ))}
    </div>
  );
}
