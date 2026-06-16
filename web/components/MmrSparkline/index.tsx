import { useMemo } from "react";
import { formatIsoDateLabel } from "@dac/shared/game-utils";
import styles from "./MmrSparkline.module.css";

export interface MmrSnapshot {
  mmr: number | null;
  snapshotted_at: string;
}

export interface MmrSeasonAnchor {
  season: string;
  mmr: number | null;
  max_mmr?: number | null;
}

export interface MmrPoint {
  mmr: number;
  label: string;
  kind: "season" | "snapshot";
}

interface MmrSparklineProps {
  /**
   * Per-season historical MMR (S41, S42…). No longer plotted — season
   * summaries aren't a time series. Kept on the props for call-site compat;
   * the season grid below the chart presents this data properly.
   */
  seasons?: MmrSeasonAnchor[];
  /** Snapshot points captured each time the user refreshed Drodo. */
  snapshots?: MmrSnapshot[];
}

const WIDTH = 560;
const HEIGHT = 132;
const PAD_X = 8;
const PAD_Y = 22;

function utcDayKey(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Build the plotted series — a *tracked* MMR timeline of refresh snapshots,
 * starting at the first one we ever recorded. Returns the points only when
 * there are at least two; the caller shows a "not enough data" state below
 * that threshold rather than inventing a line from season summaries.
 */
function buildPoints(snapshots: MmrSnapshot[]): MmrPoint[] {
  const byDay = new Map<string, MmrSnapshot & { mmr: number }>();
  for (const snapshot of snapshots
    .filter((s): s is MmrSnapshot & { mmr: number } => typeof s.mmr === "number")
    .slice()
    .sort(
      (a, b) =>
        new Date(a.snapshotted_at).getTime() -
        new Date(b.snapshotted_at).getTime()
    )) {
    const key = utcDayKey(snapshot.snapshotted_at);
    if (key) byDay.set(key, snapshot);
  }

  return [...byDay.values()].map((s) => ({
    mmr: s.mmr,
    label: formatIsoDateLabel(s.snapshotted_at),
    kind: "snapshot",
  }));
}

/** Where to anchor a value label so it never spills past the chart edges. */
function anchorFor(x: number): "start" | "middle" | "end" {
  if (x < 48) return "start";
  if (x > WIDTH - 48) return "end";
  return "middle";
}

export function MmrSparkline({ snapshots = [] }: MmrSparklineProps) {
  const points = useMemo(() => buildPoints(snapshots), [snapshots]);

  // Need at least two tracked snapshots to draw a line. Below that, say so
  // plainly rather than padding the chart with season summaries.
  if (points.length < 2) {
    return (
      <section className={styles.wrap} aria-label="MMR history">
        <div className={styles.head}>
          <span className={styles.label}>MMR History</span>
        </div>
        <p className={styles.empty}>
          Not enough tracked data yet. A timeline builds up each time this
          profile is refreshed.
        </p>
      </section>
    );
  }

  const mmrs = points.map((p) => p.mmr);
  const minMmr = Math.min(...mmrs);
  const maxMmr = Math.max(...mmrs);
  const range = maxMmr - minMmr || 1;
  const hasSpread = maxMmr > minMmr;

  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_Y * 2;

  const coords = points.map((p, i) => {
    const x = PAD_X + (i / (points.length - 1)) * innerW;
    const y = PAD_Y + innerH - ((p.mmr - minMmr) / range) * innerH;
    return { x, y, mmr: p.mmr, label: p.label, kind: p.kind };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const lastIdx = coords.length - 1;

  // Peak / trough = first occurrence of the max / min MMR across the series.
  let peakIdx = 0;
  let troughIdx = 0;
  points.forEach((p, i) => {
    if (p.mmr > points[peakIdx].mmr) peakIdx = i;
    if (p.mmr < points[troughIdx].mmr) troughIdx = i;
  });
  const peak = coords[peakIdx];
  const trough = coords[troughIdx];

  const metaParts: string[] = [
    `${points.length} daily point${points.length === 1 ? "" : "s"}`,
    `peak ${maxMmr}`,
    `low ${minMmr}`,
  ];

  return (
    <section className={styles.wrap} aria-label="MMR history">
      <div className={styles.head}>
        <span className={styles.label}>MMR History</span>
        <span className={styles.meta}>{metaParts.join(" · ")}</span>
      </div>
      <div className={styles.chartWrap}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
        >
          <polygon
            className={styles.area}
            points={`${first.x},${HEIGHT - PAD_Y} ${polylinePoints} ${last.x},${HEIGHT - PAD_Y}`}
          />
          <polyline className={styles.line} points={polylinePoints} />

          {coords.map((c, i) => (
            <circle key={i} className={styles.dot} cx={c.x} cy={c.y} r={1.8} />
          ))}

          {/* Trough (low) marker + value, when there's any spread to show. */}
          {hasSpread && (
            <>
              <circle className={styles.troughDot} cx={trough.x} cy={trough.y} r={3} />
              {troughIdx > 0 && troughIdx < lastIdx && (
                <text
                  className={`${styles.axis} ${styles.troughLabel}`}
                  x={trough.x}
                  y={trough.y + 13}
                  textAnchor={anchorFor(trough.x)}
                >
                  {minMmr}
                </text>
              )}
            </>
          )}

          {/* Peak (high) marker + value. */}
          {hasSpread && (
            <>
              <circle className={styles.peakDot} cx={peak.x} cy={peak.y} r={3} />
              {peakIdx > 0 && peakIdx < lastIdx && (
                <text
                  className={`${styles.axis} ${styles.peakLabel}`}
                  x={peak.x}
                  y={peak.y - 7}
                  textAnchor={anchorFor(peak.x)}
                >
                  {maxMmr}
                </text>
              )}
            </>
          )}

          {/* First tracked point: the line starts where tracking began. */}
          <circle className={styles.firstDot} cx={first.x} cy={first.y} r={3} />

          {/* Current value. */}
          <circle className={styles.lastDot} cx={last.x} cy={last.y} r={2.8} />
          <text
            className={styles.axis}
            x={last.x - 4}
            y={last.y - 7}
            textAnchor="end"
          >
            {last.mmr}
          </text>

          <text className={styles.axis} x={PAD_X} y={HEIGHT - 4}>
            {first.label}
          </text>
          <text
            className={styles.axis}
            x={WIDTH - PAD_X}
            y={HEIGHT - 4}
            textAnchor="end"
          >
            {last.label}
          </text>
        </svg>
      </div>
      <p className={styles.note}>
        This timeline begins at the first MMR we tracked — not your all-time
        start. Multiple refreshes on the same UTC day are shown as one point.
      </p>
    </section>
  );
}
