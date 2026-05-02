import {
  levelToRankName,
  mmrToLevel,
  MAX_LEVEL,
  MIN_LEVEL,
} from "@/lib/ranks";

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
    <>
      <style jsx>{`
        .ladder {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          color: var(--text-muted);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-8);
          padding: 12px 0;
          width: 156px;
        }
        .header {
          padding: 0 14px 10px;
          margin-bottom: 4px;
          border-bottom: 1px solid var(--border-subtle);
          font-size: var(--fs-11, 11px);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        ol {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        li {
          display: flex;
          align-items: center;
          padding: 6px 14px;
          line-height: 1.4;
        }
        .rank {
          flex: 1;
        }
        .level {
          font-variant-numeric: tabular-nums;
          color: var(--text-muted);
          font-size: var(--fs-11, 11px);
          opacity: 0.7;
          min-width: 24px;
          text-align: right;
        }
        .current {
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-primary);
          font-weight: 600;
        }
        .current .level {
          color: var(--text-secondary);
          opacity: 1;
        }
        .above {
          opacity: 0.65;
        }
        .below {
          opacity: 0.5;
        }
      `}</style>
      <aside className="ladder" aria-label="Rank ladder">
        <div className="header">Rank Ladder</div>
        <ol>
          {levels.map((level) => {
            const isCurrent = level === current;
            const cls = isCurrent
              ? "current"
              : level > current
                ? "above"
                : "below";
            return (
              <li key={level} className={cls}>
                <span className="rank">{levelToRankName(level)}</span>
                <span className="level">{level}</span>
              </li>
            );
          })}
        </ol>
      </aside>
    </>
  );
}
