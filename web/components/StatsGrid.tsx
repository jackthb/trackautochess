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
          {item.source === "drodo" && <div className="stat-source">Drodo</div>}
          {item.source === "tracked" && <div className="stat-source">Tracked</div>}
        </div>
      ))}
      <style jsx>{`
        .stats-bar {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border);
          margin-bottom: 40px;
        }
        .stat-cell { background: var(--bg-surface); padding: 24px 20px; text-align: center; }
        .stat-value { font-size: 32px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; }
        .stat-value.gold { color: var(--gold); }
        .stat-value.green { color: var(--green-bright); }
        .stat-label { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted); }
        .stat-source { margin-top: 8px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-dim); }
      `}</style>
    </div>
  );
}
