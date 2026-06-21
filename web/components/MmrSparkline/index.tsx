import { useMemo } from "react";
import {
  formatIsoDateLabel,
  mmrToRank,
  RANK_BRACKETS,
} from "@dac/shared/game-utils";
import {
  Sparkline,
  type SparkBand,
  type SparkPoint,
} from "@/components/Sparkline";
import styles from "./MmrSparkline.module.css";

// Major rank thresholds (where the tier name changes) as reference lines —
// Sparkline only draws the ones inside the visible MMR range.
const TIER_BANDS: SparkBand[] = (() => {
  const bands: SparkBand[] = [];
  let prevTier = "";
  for (const bracket of RANK_BRACKETS) {
    const tier = bracket.rank.split("-")[0];
    if (tier !== prevTier) {
      bands.push({ value: bracket.mmr, label: tier });
      prevTier = tier;
    }
  }
  return bands;
})();

export interface MmrSnapshot {
  mmr: number | null;
  snapshotted_at: string;
}

export interface MmrSeasonAnchor {
  season: string;
  mmr: number | null;
  max_mmr?: number | null;
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
function buildPoints(snapshots: MmrSnapshot[]): SparkPoint[] {
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
    value: s.mmr,
    label: formatIsoDateLabel(s.snapshotted_at),
    sub: mmrToRank(s.mmr),
  }));
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

  const values = points.map((p) => p.value);
  const minMmr = Math.min(...values);
  const maxMmr = Math.max(...values);

  // Movement since the previous tracked point — the "since last refresh" figure
  // that used to float in a separate pill, folded into this chart's header.
  const delta = values[values.length - 1] - values[values.length - 2];
  const deltaSign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const deltaClass =
    delta > 0 ? styles.deltaUp : delta < 0 ? styles.deltaDown : styles.deltaFlat;

  const metaParts = [
    `${points.length} daily point${points.length === 1 ? "" : "s"}`,
    `peak ${maxMmr}`,
    `low ${minMmr}`,
  ];

  return (
    <section className={styles.wrap} aria-label="MMR history">
      <div className={styles.head}>
        <div className={styles.headLead}>
          <span className={styles.label}>MMR History</span>
          <span className={`${styles.delta} ${deltaClass}`}>
            {deltaSign}
            {Math.abs(delta)} since last refresh
          </span>
        </div>
        <span className={styles.meta}>{metaParts.join(" · ")}</span>
      </div>
      <div className={styles.chartWrap}>
        <Sparkline
          points={points}
          height={150}
          bands={TIER_BANDS}
          goodLabel="Peak"
          badLabel="Low"
          ariaLabel="MMR history"
        />
      </div>
      <p className={styles.note}>
        This timeline begins at the first MMR we tracked — not your all-time
        start. Multiple refreshes on the same UTC day are shown as one point.
      </p>
    </section>
  );
}
