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
  for (let c = Math.min(max, n); c >= 1; c--) {
    if (n % c === 0) return c;
  }
  return 1;
}

export function StatsGrid({ items }: { items: StatItem[] }) {
  if (!items.length) return null;
  const cols = balancedColumns(items.length, 6);
  const colsSm = balancedColumns(items.length, 2);
  const style = { "--stat-cols": cols, "--stat-cols-sm": colsSm } as CSSProperties;
  return (
    <div className="stats-bar" style={style}>
      {items.map((item) => (
        <div key={item.key} className="stat-cell">
          <div className={`stat-value ${item.tone ?? "default"}`}>{item.value}</div>
          <div className="stat-label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
