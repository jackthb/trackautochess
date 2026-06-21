"use client";

import {
  useCallback,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { Area, Bar, Line, LinePath } from "@visx/shape";
import { curveLinear } from "@visx/curve";
import { localPoint } from "@visx/event";
import { useTooltip } from "@visx/tooltip";
import styles from "./Sparkline.module.css";

export interface SparkPoint {
  /** The plotted value (MMR, ladder rank, …). */
  value: number;
  /** Human label for this point — the day, shown in the tooltip + endpoints. */
  label: string;
  /** Optional secondary line for the tooltip, e.g. the rank tier at this MMR. */
  sub?: string;
}

/** A faint horizontal reference line, e.g. a rank-tier MMR threshold. */
export interface SparkBand {
  value: number;
  label: string;
}

interface SparklineProps {
  points: SparkPoint[];
  height?: number;
  /** When true, lower values sit at the top (e.g. ladder rank #1 is best). */
  invert?: boolean;
  /** Whether a higher value is the "good" outcome. Drives marker/delta colors. */
  goodIsHigh?: boolean;
  /** Formats values for the tooltip (e.g. `#${v}` for a ladder rank). */
  formatValue?: (value: number) => string;
  /** Reference lines drawn behind the series (tier thresholds). */
  bands?: SparkBand[];
  goodLabel?: string;
  badLabel?: string;
  ariaLabel?: string;
}

const MARGIN = { top: 16, right: 12, bottom: 22, left: 12 };

/**
 * Shared MMR/Queen-Rank trend chart, built on visx. The hover interaction is
 * the point of it: it surfaces the day, the value, the rank tier at that point,
 * the change since the previous point, and whether the point is the peak / low
 * / current. Tier thresholds are drawn as faint reference lines behind the line.
 */
export function Sparkline(props: SparklineProps) {
  const height = props.height ?? 150;
  return (
    <div className={styles.wrap} style={{ height }}>
      <ParentSize>
        {({ width }) =>
          width > 0 ? (
            <SparklineChart {...props} width={width} height={height} />
          ) : null
        }
      </ParentSize>
    </div>
  );
}

function SparklineChart({
  points,
  width,
  height,
  invert = false,
  goodIsHigh = true,
  formatValue = (value) => String(value),
  bands = [],
  goodLabel = "Peak",
  badLabel = "Low",
  ariaLabel,
}: SparklineProps & { width: number; height: number }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { showTooltip, hideTooltip, tooltipData, tooltipOpen } = useTooltip<{
    index: number;
    x: number;
    y: number;
    clientX: number;
    clientY: number;
  }>();

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || 1) * 0.15;
  const domainMin = min - pad;
  const domainMax = max + pad;
  const hasSpread = max > min;

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, Math.max(1, points.length - 1)],
        range: [MARGIN.left, width - MARGIN.right],
      }),
    [points.length, width]
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [domainMin, domainMax],
        // Higher value at the top normally; flipped for lower-is-better metrics.
        range: invert
          ? [MARGIN.top, height - MARGIN.bottom]
          : [height - MARGIN.bottom, MARGIN.top],
      }),
    [domainMin, domainMax, invert, height]
  );

  const getX = useCallback((i: number) => xScale(i) ?? 0, [xScale]);
  const getY = useCallback((v: number) => yScale(v) ?? 0, [yScale]);

  // First occurrence of each extreme, plus the current (last) point.
  let maxIdx = 0;
  let minIdx = 0;
  values.forEach((v, i) => {
    if (v > values[maxIdx]) maxIdx = i;
    if (v < values[minIdx]) minIdx = i;
  });
  const lastIdx = points.length - 1;
  const goodIdx = goodIsHigh ? maxIdx : minIdx;
  const badIdx = goodIsHigh ? minIdx : maxIdx;

  const handleMove = useCallback(
    (
      event: ReactMouseEvent<SVGRectElement> | ReactTouchEvent<SVGRectElement>
    ) => {
      const local = localPoint(event);
      if (!local) return;
      const innerW = Math.max(1, width - MARGIN.left - MARGIN.right);
      const rel = (local.x - MARGIN.left) / innerW;
      const i = Math.min(
        points.length - 1,
        Math.max(0, Math.round(rel * (points.length - 1)))
      );
      // Convert the point's SVG coordinates to viewport coordinates so the
      // portal'd tooltip (position: fixed) lands on the right spot.
      const rect = svgRef.current?.getBoundingClientRect();
      showTooltip({
        tooltipData: {
          index: i,
          x: getX(i),
          y: getY(values[i]),
          clientX: (rect?.left ?? 0) + getX(i),
          clientY: (rect?.top ?? 0) + getY(values[i]),
        },
        tooltipLeft: getX(i),
        tooltipTop: getY(values[i]),
      });
    },
    [points.length, values, width, getX, getY, showTooltip]
  );

  const hovered = tooltipOpen && tooltipData ? tooltipData.index : null;
  const hoveredPoint = hovered != null ? points[hovered] : null;
  const hoveredDelta =
    hovered != null && hovered > 0 ? values[hovered] - values[hovered - 1] : null;
  const deltaGood = hoveredDelta == null ? false : hoveredDelta > 0 === goodIsHigh;
  const hoveredTag =
    hovered == null
      ? null
      : hovered === lastIdx
        ? "Current"
        : hasSpread && hovered === goodIdx
          ? goodLabel
          : hasSpread && hovered === badIdx
            ? badLabel
            : null;

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className={styles.svg}
        role="img"
        aria-label={ariaLabel}
      >
        {/* Tier reference lines that fall within the visible value range. */}
        {bands.map((band) => {
          if (band.value < domainMin || band.value > domainMax) return null;
          const y = getY(band.value);
          return (
            <g key={band.label}>
              <Line
                from={{ x: MARGIN.left, y }}
                to={{ x: width - MARGIN.right, y }}
                className={styles.band}
              />
              <text
                className={styles.bandLabel}
                x={width - MARGIN.right}
                y={y - 3}
                textAnchor="end"
              >
                {band.label}
              </text>
            </g>
          );
        })}

        <Area<SparkPoint>
          data={points}
          x={(_, i) => getX(i)}
          y0={() => height - MARGIN.bottom}
          y1={(d) => getY(d.value)}
          curve={curveLinear}
          className={styles.area}
        />
        <LinePath<SparkPoint>
          data={points}
          x={(_, i) => getX(i)}
          y={(d) => getY(d.value)}
          curve={curveLinear}
          className={styles.line}
        />

        <circle
          className={styles.firstDot}
          cx={getX(0)}
          cy={getY(values[0])}
          r={3}
        />
        {hasSpread && (
          <circle
            className={styles.goodDot}
            cx={getX(goodIdx)}
            cy={getY(values[goodIdx])}
            r={3}
          />
        )}
        {hasSpread && (
          <circle
            className={styles.badDot}
            cx={getX(badIdx)}
            cy={getY(values[badIdx])}
            r={3}
          />
        )}
        <circle
          className={styles.lastDot}
          cx={getX(lastIdx)}
          cy={getY(values[lastIdx])}
          r={3}
        />

        <text className={styles.axis} x={MARGIN.left} y={height - 6}>
          {points[0].label}
        </text>
        <text
          className={styles.axis}
          x={width - MARGIN.right}
          y={height - 6}
          textAnchor="end"
        >
          {points[lastIdx].label}
        </text>

        {tooltipData && (
          <>
            <Line
              from={{ x: tooltipData.x, y: MARGIN.top }}
              to={{ x: tooltipData.x, y: height - MARGIN.bottom }}
              className={styles.crosshair}
            />
            <circle
              cx={tooltipData.x}
              cy={tooltipData.y}
              r={4}
              className={styles.cursorDot}
            />
          </>
        )}

        <Bar
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={hideTooltip}
          onTouchStart={handleMove}
          onTouchMove={handleMove}
          onTouchEnd={hideTooltip}
        />
      </svg>
      {tooltipData &&
        hoveredPoint &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={styles.tooltip}
            style={{
              // position: fixed in a body portal — escapes every overflow:hidden
              // ancestor so the tooltip can never be clipped. Centered over the
              // point and clamped to the viewport; flips below only near the top.
              left: Math.min(
                Math.max(tooltipData.clientX, 60),
                (typeof window !== "undefined" ? window.innerWidth : 1024) - 60
              ),
              top: tooltipData.clientY,
              transform:
                tooltipData.y > height * 0.4
                  ? "translate(-50%, calc(-100% - 12px))"
                  : "translate(-50%, 14px)",
            }}
          >
            {hoveredTag && <div className={styles.tipTag}>{hoveredTag}</div>}
            <div className={styles.tipMain}>
              <span className={styles.tipValue}>
                {formatValue(hoveredPoint.value)}
              </span>
              {hoveredDelta != null && hoveredDelta !== 0 && (
                <span
                  className={`${styles.tipDelta} ${
                    deltaGood ? styles.tipDeltaGood : styles.tipDeltaBad
                  }`}
                >
                  {hoveredDelta > 0 ? "+" : "−"}
                  {Math.abs(hoveredDelta)}
                </span>
              )}
            </div>
            {hoveredPoint.sub && (
              <div className={styles.tipSub}>{hoveredPoint.sub}</div>
            )}
            <div className={styles.tipLabel}>{hoveredPoint.label}</div>
          </div>,
          document.body
        )}
    </>
  );
}
