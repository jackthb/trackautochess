import { useEffect, useMemo, useState } from "react";
import {
  formatIsoDateLabel,
  mmrToRank,
  RANK_BRACKETS,
} from "@dac/shared/game-utils";
import { Sparkline, type SparkPoint } from "@/components/Sparkline";
import styles from "./MmrSparkline.module.css";

// Static Queen tier floor. Live Queen ladder positions are separate and can move
// independently of this MMR threshold.
const QUEEN_MIN_MMR =
  RANK_BRACKETS.find((bracket) => bracket.rank === "Queen")?.mmr ?? 3380;

export interface MmrSnapshot {
  mmr: number | null;
  snapshotted_at: string;
  season?: string | null;
}

interface MmrSparklineProps {
  /** Snapshot points captured each time the user refreshed Drodo. */
  snapshots?: MmrSnapshot[];
  /** Current Drodo season. When present, the chart starts fresh per season. */
  currentSeason?: string | null;
  /** Current Queen ladder position, when Drodo exposes one. */
  queenRank?: number | null;
}

interface MmrSeasonTab {
  key: string;
  label: string;
  latest: number;
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
function normalizedSeason(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

function seasonLabel(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^s(?:eason)?\s*(\d+)$/i);
  return match ? `Season ${match[1]}` : trimmed.toUpperCase();
}

function seasonSortValue(value: string): number {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Number.NEGATIVE_INFINITY;
}

function buildSeasonTabs(
  snapshots: MmrSnapshot[],
  currentSeason: string | null | undefined
): MmrSeasonTab[] {
  const tabs = new Map<string, MmrSeasonTab>();

  for (const snapshot of snapshots) {
    const key = normalizedSeason(snapshot.season);
    if (!key || typeof snapshot.mmr !== "number") continue;

    const snapshottedMs = new Date(snapshot.snapshotted_at).getTime();
    const latest = Number.isFinite(snapshottedMs) ? snapshottedMs : 0;
    const current = tabs.get(key);

    if (!current || latest > current.latest) {
      tabs.set(key, {
        key,
        label: seasonLabel(snapshot.season ?? key),
        latest: Math.max(latest, seasonSortValue(key)),
      });
    }
  }

  const currentKey = normalizedSeason(currentSeason);
  return [...tabs.values()]
    .filter((tab) => hasTwoPointsForSeason(snapshots, tab.key))
    .sort((a, b) => {
      if (currentKey) {
        if (a.key === currentKey) return -1;
        if (b.key === currentKey) return 1;
      }
      return b.latest - a.latest;
    });
}

function hasTwoPointsForSeason(
  snapshots: MmrSnapshot[],
  seasonKey: string | null | undefined
): boolean {
  return buildPoints(snapshots, seasonKey).length >= 2;
}

function preferredSeasonKey(
  seasonTabs: MmrSeasonTab[],
  snapshots: MmrSnapshot[],
  currentSeason: string | null | undefined
): string | null {
  const currentKey = normalizedSeason(currentSeason);

  if (currentKey && hasTwoPointsForSeason(snapshots, currentKey)) {
    return currentKey;
  }

  return seasonTabs[0]?.key ?? null;
}

function snapshotsForSeason(
  snapshots: MmrSnapshot[],
  seasonKey: string | null | undefined
): MmrSnapshot[] {
  if (!seasonKey) return snapshots;

  const matching = snapshots.filter(
    (snapshot) => normalizedSeason(snapshot.season) === seasonKey
  );
  return matching;
}

function buildPoints(
  snapshots: MmrSnapshot[],
  seasonKey?: string | null
): SparkPoint[] {
  const byDay = new Map<string, MmrSnapshot & { mmr: number }>();
  for (const snapshot of snapshotsForSeason(snapshots, seasonKey)
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

  return `${QUEEN_MIN_MMR - latestMmr} MMR to Queen tier`;
}

export function MmrSparkline({
  snapshots = [],
  currentSeason,
  queenRank,
}: MmrSparklineProps) {
  const seasonTabs = useMemo(
    () => buildSeasonTabs(snapshots, currentSeason),
    [currentSeason, snapshots]
  );
  const fallbackSeasonKey = preferredSeasonKey(
    seasonTabs,
    snapshots,
    currentSeason
  );
  const [selectedSeasonKey, setSelectedSeasonKey] = useState<string | null>(
    fallbackSeasonKey
  );
  const activeSeasonKey = seasonTabs.some((tab) => tab.key === selectedSeasonKey)
    ? selectedSeasonKey
    : fallbackSeasonKey;
  const points = useMemo(() => {
    if (!activeSeasonKey) return [];
    return buildPoints(snapshots, activeSeasonKey);
  }, [activeSeasonKey, snapshots]);
  const activeSeasonLabel =
    seasonTabs.find((tab) => tab.key === activeSeasonKey)?.label ?? null;

  useEffect(() => {
    if (seasonTabs.some((tab) => tab.key === selectedSeasonKey)) return;
    setSelectedSeasonKey(fallbackSeasonKey);
  }, [fallbackSeasonKey, seasonTabs, selectedSeasonKey]);

  const seasonTabList =
    seasonTabs.length > 0 ? (
      <div
        className={styles.seasonTabs}
        role="tablist"
        aria-label="MMR history season"
      >
        {seasonTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.seasonTab} ${
              activeSeasonKey === tab.key ? styles.seasonTabActive : ""
            }`}
            onClick={() => setSelectedSeasonKey(tab.key)}
            role="tab"
            aria-selected={activeSeasonKey === tab.key}
          >
            {tab.label}
          </button>
        ))}
      </div>
    ) : null;
  const fileBodyClassName = `${styles.fileBody} ${
    seasonTabList ? "" : styles.fileBodyFull
  }`;

  // Need at least two tracked snapshots to draw a line. Below that, say so
  // plainly rather than padding the chart with season summaries.
  if (points.length < 2) {
    return (
      <section className={styles.wrap} aria-label="MMR history">
        {seasonTabList}
        <div className={fileBodyClassName}>
          <div className={styles.head}>
            <span className={styles.label}>MMR History</span>
          </div>
          <p className={styles.empty}>
            Not enough tracked data
            {activeSeasonLabel ? ` for ${activeSeasonLabel}` : ""} yet. A
            timeline builds up each time this profile is refreshed.
          </p>
        </div>
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
  const latestMmr = values[values.length - 1];

  const metaParts = [
    `${points.length} daily point${points.length === 1 ? "" : "s"}`,
    queenStatusForMmr(latestMmr, queenRank),
    `peak ${maxMmr}`,
    `low ${minMmr}`,
  ];

  return (
    <section className={styles.wrap} aria-label="MMR history">
      {seasonTabList}
      <div className={fileBodyClassName}>
        <div className={styles.head}>
          <div className={styles.headLead}>
            <span className={styles.label}>MMR History</span>
            {activeSeasonLabel && (
              <span className={styles.seasonLabel}>{activeSeasonLabel}</span>
            )}
            <span className={`${styles.delta} ${deltaClass}`}>
              {deltaSign}
              {Math.abs(delta)} since prior point
            </span>
          </div>
          <span className={styles.meta}>{metaParts.join(" · ")}</span>
        </div>
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
