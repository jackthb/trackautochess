import {
  levelMinMmr,
  levelToRankName,
  mmrToLevel,
  MAX_LEVEL,
  MIN_LEVEL,
} from "@/lib/ranks";
import styles from "./RankLadder.module.css";

interface RankLadderProps {
  mmr?: number | null;
  /** Prefer this when numeric MMR is unavailable — Drodo still returns mmr_level. */
  mmrLevel?: number | null;
  queenRank?: number | null;
  /** How many ranks to show above and below the current. */
  span?: number;
}

export function RankLadder({ mmr, mmrLevel, queenRank, span = 4 }: RankLadderProps) {
  const rawCurrent =
    typeof mmrLevel === "number" && Number.isFinite(mmrLevel) && mmrLevel > 0
      ? Math.floor(mmrLevel)
      : mmr != null && Number.isFinite(mmr)
        ? mmrToLevel(mmr)
        : 0;
  const current = Math.min(MAX_LEVEL, rawCurrent);
  if (current < MIN_LEVEL) return null;

  const top = Math.min(MAX_LEVEL, current + span);
  const bottom = Math.max(MIN_LEVEL, current - span);
  const levels: number[] = [];
  for (let l = top; l >= bottom; l--) levels.push(l);

  return (
    <aside className={styles.ladder} aria-label="Rank ladder">
      <div className={styles.header}>Rank</div>
      <ol className={styles.list}>
        {levels.map((level) => {
          const isCurrent = level === current;
          const showQueenRank = isCurrent && level === MAX_LEVEL && queenRank != null;
          const cls = isCurrent
            ? styles.current
            : level > current
              ? styles.above
              : styles.below;
          return (
            <li key={level} className={`${styles.row} ${cls}`}>
              {showQueenRank && <span className={styles.position}>#{queenRank}</span>}
              <span className={styles.rank}>{levelToRankName(level)}</span>
              <span className={styles.mmr}>{levelMinMmr(level).toLocaleString()}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
