import { useMemo } from "react";
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
   * Per-season historical MMR (S41, S42…). Used as anchors so the graph
   * renders something even before snapshots accumulate.
   */
  seasons?: MmrSeasonAnchor[];
  /** Snapshot points captured each time the user refreshed Drodo. */
  snapshots?: MmrSnapshot[];
}

const WIDTH = 560;
const HEIGHT = 120;
const PAD_X = 8;
const PAD_Y = 12;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function buildPoints(
  seasons: MmrSeasonAnchor[],
  snapshots: MmrSnapshot[]
): MmrPoint[] {
  const seasonPoints: MmrPoint[] = seasons
    .filter((s): s is MmrSeasonAnchor & { mmr: number } => typeof s.mmr === "number")
    .slice()
    .sort((a, b) => a.season.localeCompare(b.season))
    .map((s) => ({ mmr: s.mmr, label: s.season.toUpperCase(), kind: "season" }));

  const snapshotPoints: MmrPoint[] = snapshots
    .filter((s): s is MmrSnapshot & { mmr: number } => typeof s.mmr === "number")
    .slice()
    .sort(
      (a, b) =>
        new Date(a.snapshotted_at).getTime() -
        new Date(b.snapshotted_at).getTime()
    )
    .map((s) => ({
      mmr: s.mmr,
      label: formatDate(s.snapshotted_at),
      kind: "snapshot",
    }));

  return [...seasonPoints, ...snapshotPoints];
}

export function MmrSparkline({ seasons = [], snapshots = [] }: MmrSparklineProps) {
  const points = useMemo(() => buildPoints(seasons, snapshots), [seasons, snapshots]);

  if (points.length < 2) return null;

  const mmrs = points.map((p) => p.mmr);
  const minMmr = Math.min(...mmrs);
  const maxMmr = Math.max(...mmrs);
  const range = maxMmr - minMmr || 1;

  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_Y * 2;

  const coords = points.map((p, i) => {
    const x = PAD_X + (i / (points.length - 1)) * innerW;
    const y = PAD_Y + innerH - ((p.mmr - minMmr) / range) * innerH;
    return { x, y, mmr: p.mmr, label: p.label, kind: p.kind };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const last = coords[coords.length - 1];
  const first = coords[0];

  const seasonCount = points.filter((p) => p.kind === "season").length;
  const snapshotCount = points.length - seasonCount;
  const metaParts: string[] = [];
  if (seasonCount > 0) metaParts.push(`${seasonCount} season${seasonCount === 1 ? "" : "s"}`);
  if (snapshotCount > 0) metaParts.push(`${snapshotCount} snapshot${snapshotCount === 1 ? "" : "s"}`);

  return (
    <section className={styles.wrap} aria-label="MMR history">
      <div className={styles.head}>
        <span className={styles.label}>MMR History</span>
        <span className={styles.meta}>
          {metaParts.join(" · ")} · range{" "}
          <strong>{minMmr}</strong>–<strong>{maxMmr}</strong>
        </span>
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
          {coords.slice(0, -1).map((c, i) => (
            <circle
              key={i}
              className={`${styles.dot}${c.kind === "season" ? ` ${styles.season}` : ""}`}
              cx={c.x}
              cy={c.y}
              r={c.kind === "season" ? 2.5 : 1.8}
            />
          ))}
          <circle className={styles.lastDot} cx={last.x} cy={last.y} r={2.8} />
          <text
            className={styles.axis}
            x={last.x - 4}
            y={last.y - 6}
            textAnchor="end"
          >
            {last.mmr}
          </text>
          <text className={styles.axis} x={PAD_X} y={HEIGHT - 2}>
            {first.label}
          </text>
          <text
            className={styles.axis}
            x={WIDTH - PAD_X}
            y={HEIGHT - 2}
            textAnchor="end"
          >
            {last.label}
          </text>
        </svg>
      </div>
      <p className={styles.note}>
        Season anchors come from your end-of-season MMR. New points are added
        each time you press refresh on this profile — check back hourly to
        build out the recent trend.
      </p>
    </section>
  );
}
