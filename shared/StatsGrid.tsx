import type { ReactNode } from "react";

export interface StatItem {
  key: string;
  value: ReactNode;
  label: string;
  tone?: "default" | "gold" | "green";
  source?: "tracked" | "drodo";
}

export function StatsGrid({ items }: { items: StatItem[] }) {
  if (!items.length) return null;
  return (
    <div className="stats-bar">
      {items.map((item) => (
        <div key={item.key} className="stat-cell">
          <div className={`stat-value ${item.tone ?? "default"}`}>{item.value}</div>
          <div className="stat-label">{item.label}</div>
          {item.source && <div className="stat-source">{item.source}</div>}
        </div>
      ))}
    </div>
  );
}
