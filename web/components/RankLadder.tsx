import {
  levelToRankName,
  mmrToLevel,
  MAX_LEVEL,
  MIN_LEVEL,
} from "@/lib/ranks";
import styles from "./RankLadder.module.css";

interface RankLadderProps {
  mmr: number | null | undefined;
  /** How many ranks to show above and below the current. */
  span?: number;
}

export function RankLadder({ mmr, span = 4 }: RankLadderProps) {
  if (mmr == null || !Number.isFinite(mmr)) return null;
  const current = mmrToLevel(mmr);
  if (current < MIN_LEVEL) return null;

  const top = Math.min(MAX_LEVEL, current + span);
  const bottom = Math.max(MIN_LEVEL, current - span);
  const levels: number[] = [];
  for (let l = top; l >= bottom; l--) levels.push(l);

  return (
    <aside className={styles.ladder} aria-label="Rank ladder">
      <div className={styles.header}>Rank Ladder</div>
      <ol className={styles.list}>
        {levels.map((level) => {
          const isCurrent = level === current;
          const cls = isCurrent
            ? styles.current
            : level > current
              ? styles.above
              : styles.below;
          return (
            <li key={level} className={`${styles.row} ${cls}`}>
              <span className={styles.rank}>{levelToRankName(level)}</span>
              <span className={styles.level}>{level}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
