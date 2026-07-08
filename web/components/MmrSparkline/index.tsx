import { useMemo } from "react";
import {
  formatIsoDateLabel,
  mmrToRank,
  RANK_BRACKETS,
} from "@dac/shared/game-utils";
import { Sparkline, type SparkPoint } from "@/components/Sparkline";
import { buildMmrPoints, seasonLabel, type MmrSnapshot } from "./seasonHistory";
import styles from "./MmrSparkline.module.css";

const QUEEN_MIN_MMR =
  RANK_BRACKETS.find((bracket) => bracket.rank === "Queen")?.mmr ?? 3380;

export type { MmrSnapshot } from "./seasonHistory";

interface MmrSparklineProps {
  snapshots?: MmrSnapshot[];
  activeSeasonKey?: string | null;
  queenRank?: number | null;
}

function queenStatusForMmr(
  latestMmr: number,
  queenRank: number | null | undefined
): string {
  if (
    typeof queenRank === "number" &&
    Number.isFinite(queenRank) &&
    queenRank > 0
  ) {
    return `Queen #${queenRank}`;
  }

  if (latestMmr >= QUEEN_MIN_MMR) return "Queen tier";

  return `${QUEEN_MIN_MMR - latestMmr} to Queen`;
}

function buildPoints(
  snapshots: MmrSnapshot[],
  seasonKey?: string | null
): SparkPoint[] {
  return [...buildMmrPoints(snapshots, seasonKey).values()].map((s) => ({
    value: s.mmr,
    label: formatIsoDateLabel(s.snapshotted_at),
    sub: mmrToRank(s.mmr),
  }));
}

export function MmrSparkline({
  snapshots = [],
  activeSeasonKey,
  queenRank,
}: MmrSparklineProps) {
  const points = useMemo(() => {
    if (activeSeasonKey) return buildPoints(snapshots, activeSeasonKey);
    return buildPoints(snapshots);
  }, [activeSeasonKey, snapshots]);

  const activeSeasonLabel =
    activeSeasonKey != null ? seasonLabel(activeSeasonKey) : null;

  if (points.length < 2) {
    return (
      <section className={styles.wrap} aria-label="MMR history">
        <p className={styles.empty}>
          Not enough tracked data
          {activeSeasonLabel ? ` for ${activeSeasonLabel}` : ""} yet. A timeline
          builds up each time this profile is refreshed.
        </p>
      </section>
    );
  }

  const values = points.map((p) => p.value);
  const minMmr = Math.min(...values);
  const maxMmr = Math.max(...values);

  const delta = values[values.length - 1] - values[values.length - 2];
  const deltaSign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const deltaClass =
    delta > 0 ? styles.deltaUp : delta < 0 ? styles.deltaDown : styles.deltaFlat;
  const latestMmr = values[values.length - 1];

  return (
    <section className={styles.wrap} aria-label="MMR history">
      <div className={styles.statsRow}>
        <span className={`${styles.deltaBadge} ${deltaClass}`}>
          {deltaSign}
          {Math.abs(delta)} since prior point
        </span>
        <span className={styles.statChip}>
          {points.length} point{points.length === 1 ? "" : "s"}
        </span>
        <span className={styles.statChip}>
          {queenStatusForMmr(latestMmr, queenRank)}
        </span>
        <span className={styles.statChip}>
          Peak <strong>{maxMmr}</strong>
        </span>
        <span className={styles.statChip}>
          Low <strong>{minMmr}</strong>
        </span>
      </div>

      <div className={styles.chartWell}>
        <div className={styles.chartWrap}>
          <Sparkline
            points={points}
            height={150}
            goodLabel="Peak"
            badLabel="Low"
            ariaLabel="MMR history"
          />
        </div>
      </div>
    </section>
  );
}
