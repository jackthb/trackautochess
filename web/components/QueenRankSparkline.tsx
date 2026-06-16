import { useMemo } from "react";
import { formatIsoDateLabel } from "@dac/shared/game-utils";
import styles from "@/components/MmrSparkline/MmrSparkline.module.css";

export interface QueenRankSnapshot {
  queen_rank: number | null;
  snapshotted_at: string;
}

interface QueenRankPoint {
  rank: number;
  label: string;
}

interface QueenRankSparklineProps {
  snapshots?: QueenRankSnapshot[];
}

const WIDTH = 560;
const HEIGHT = 120;
const PAD_X = 8;
const PAD_Y = 12;

function utcDayKey(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildPoints(snapshots: QueenRankSnapshot[]): QueenRankPoint[] {
  const byDay = new Map<string, QueenRankSnapshot & { queen_rank: number }>();
  for (const snapshot of snapshots
    .filter(
      (s): s is QueenRankSnapshot & { queen_rank: number } =>
        typeof s.queen_rank === "number"
    )
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
    rank: s.queen_rank,
    label: formatIsoDateLabel(s.snapshotted_at),
  }));
}

export function hasQueenRankHistory(snapshots: QueenRankSnapshot[]): boolean {
  return buildPoints(snapshots).length >= 2;
}

export function QueenRankSparkline({ snapshots = [] }: QueenRankSparklineProps) {
  const points = useMemo(() => buildPoints(snapshots), [snapshots]);

  if (points.length < 2) {
    return (
      <section className={styles.wrap} aria-label="Queen rank history">
        <div className={styles.head}>
          <span className={styles.label}>Queen Rank History</span>
          <span className={styles.meta}>
            {points.length} daily point{points.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className={styles.note}>
          Queen rank history needs snapshots from at least two days while this
          player is Queen.
        </p>
      </section>
    );
  }

  const ranks = points.map((p) => p.rank);
  const bestRank = Math.min(...ranks);
  const worstRank = Math.max(...ranks);
  const range = worstRank - bestRank || 1;

  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_Y * 2;

  const coords = points.map((p, i) => {
    const x = PAD_X + (i / (points.length - 1)) * innerW;
    // Lower ladder numbers are better, so #1 belongs at the top of the chart.
    const y = PAD_Y + ((p.rank - bestRank) / range) * innerH;
    return { x, y, rank: p.rank, label: p.label };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const last = coords[coords.length - 1];
  const first = coords[0];

  return (
    <section className={styles.wrap} aria-label="Queen rank history">
      <div className={styles.head}>
        <span className={styles.label}>Queen Rank History</span>
        <span className={styles.meta}>
          {points.length} daily point{points.length === 1 ? "" : "s"} - range{" "}
          <strong>#{bestRank}</strong>-<strong>#{worstRank}</strong>
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
              className={styles.dot}
              cx={c.x}
              cy={c.y}
              r={1.8}
            />
          ))}
          <circle className={styles.lastDot} cx={last.x} cy={last.y} r={2.8} />
          <text
            className={styles.axis}
            x={last.x - 4}
            y={last.y - 6}
            textAnchor="end"
          >
            #{last.rank}
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
        Queen ladder points are captured when this profile is refreshed while
        Drodo reports a Queen ladder position. Multiple refreshes on the same
        UTC day are shown as one point.
      </p>
    </section>
  );
}
