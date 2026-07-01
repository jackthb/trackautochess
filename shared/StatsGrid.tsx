import type { CSSProperties, ReactNode } from "react";

export interface StatItem {
  key: string;
  value: ReactNode;
  label: string;
  tone?: "default" | "gold" | "green";
  source?: "tracked" | "drodo";
}

// Largest column count <= max that divides n evenly, so the grid never
// leaves an unfilled (phantom) cell in the last row. Falls back to 1.
function balancedColumns(n: number, max: number): number {
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let c = 1; c <= Math.min(max, n); c++) {
    const rows = Math.ceil(n / c);
    const lastRowCount = n % c || c;
    const gap = c - lastRowCount;
    const orphanPenalty = rows > 1 && lastRowCount === 1 ? 4 : 0;
    const score = gap * 2 + rows + orphanPenalty;

    if (score < bestScore || (score === bestScore && c > best)) {
      best = c;
      bestScore = score;
    }
  }

  return best;
}

const STAT_GRID_TRACKS = 60;

function statSpan(index: number, total: number, cols: number): number {
  const rowStart = Math.floor(index / cols) * cols;
  const colsInRow = Math.min(cols, total - rowStart);
  return STAT_GRID_TRACKS / colsInRow;
}

export function StatsGrid({ items }: { items: StatItem[] }) {
  if (!items.length) return null;
  const cols = balancedColumns(items.length, 6);
  const colsSm = balancedColumns(items.length, 2);
  return (
    <div className="stats-bar">
      {items.map((item, index) => (
        <div
          key={item.key}
          className="stat-cell"
          style={
            {
              "--stat-span": statSpan(index, items.length, cols),
              "--stat-span-sm": statSpan(index, items.length, colsSm),
            } as CSSProperties
          }
        >
          <div className={`stat-value ${item.tone ?? "default"}`}>{item.value}</div>
          <div className="stat-label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
