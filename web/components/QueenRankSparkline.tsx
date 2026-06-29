import { useMemo } from "react";
import { formatIsoDateLabel } from "@dac/shared/game-utils";
import { Sparkline, type SparkPoint } from "@/components/Sparkline";
import styles from "@/components/MmrSparkline/MmrSparkline.module.css";

export interface QueenRankSnapshot {
  queen_rank: number | null;
  snapshotted_at: string;
}

interface QueenRankSparklineProps {
  snapshots?: QueenRankSnapshot[];
}

function utcDayKey(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildPoints(snapshots: QueenRankSnapshot[]): SparkPoint[] {
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
    value: s.queen_rank,
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

  const ranks = points.map((p) => p.value);
  const bestRank = Math.min(...ranks);
  const worstRank = Math.max(...ranks);

  return (
    <section className={styles.wrap} aria-label="Queen rank history">
      <div className={styles.head}>
        <span className={styles.label}>Queen Rank History</span>
        <span className={styles.meta}>
          {points.length} daily point{points.length === 1 ? "" : "s"} · range{" "}
          <strong>#{bestRank}</strong>–<strong>#{worstRank}</strong>
        </span>
      </div>
      <div className={styles.chartWrap}>
        {/* Lower ladder numbers are better, so #1 sits at the top (invert) and
            the best rank is the "good" (green) extreme. */}
        <Sparkline
          points={points}
          height={140}
          invert
          goodIsHigh={false}
          formatValue={(v) => `#${v}`}
          goodLabel="Best"
          badLabel="Worst"
          ariaLabel="Queen rank history"
        />
      </div>
      <p className={styles.note}>
        Queen ladder points are captured when this profile is refreshed while
        Drodo reports a Queen ladder position. Multiple refreshes on the same
        UTC day use the last point from that day.
      </p>
    </section>
  );
}
