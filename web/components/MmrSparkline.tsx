import { useMemo } from "react";

export interface MmrSnapshot {
  mmr: number | null;
  snapshotted_at: string;
}

interface MmrSparklineProps {
  snapshots: MmrSnapshot[];
}

const WIDTH = 560;
const HEIGHT = 120;
const PAD_X = 8;
const PAD_Y = 12;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function MmrSparkline({ snapshots }: MmrSparklineProps) {
  const points = useMemo(
    () =>
      snapshots
        .filter((s): s is MmrSnapshot & { mmr: number } => typeof s.mmr === "number")
        .slice()
        .sort(
          (a, b) =>
            new Date(a.snapshotted_at).getTime() -
            new Date(b.snapshotted_at).getTime()
        ),
    [snapshots]
  );

  if (points.length < 2) return null;

  const mmrs = points.map((p) => p.mmr);
  const minMmr = Math.min(...mmrs);
  const maxMmr = Math.max(...mmrs);
  const range = maxMmr - minMmr || 1;

  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_Y * 2;

  const coords = points.map((p, i) => {
    const x = PAD_X + (i / (points.length - 1)) * innerW;
    const y = PAD_Y + innerH - ((p.mmr - minMmr) / range) * innerH;
    return { x, y, mmr: p.mmr, at: p.snapshotted_at };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const last = coords[coords.length - 1];
  const first = coords[0];

  return (
    <>
      <style jsx>{`
        .wrap {
          margin: 0 0 24px;
          padding: 18px 20px 14px;
          border: 1px solid var(--border);
          background: var(--bg-surface);
          border-radius: var(--r-8);
        }
        .head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .label {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .meta {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          color: var(--text-muted);
        }
        .meta strong {
          color: var(--text-primary);
        }
        .chart-wrap {
          width: 100%;
          overflow: hidden;
        }
        svg {
          display: block;
          width: 100%;
          height: auto;
          color: var(--accent);
        }
        .area {
          fill: currentColor;
          opacity: 0.08;
        }
        .line {
          fill: none;
          stroke: currentColor;
          stroke-width: 1.5;
        }
        .last-dot {
          fill: currentColor;
        }
        .axis {
          font-family: var(--font-mono);
          font-size: 10px;
          fill: var(--text-muted);
        }
        .note {
          margin-top: 10px;
          font-family: var(--font-mono);
          font-size: var(--fs-11, 11px);
          color: var(--text-muted);
          opacity: 0.85;
          line-height: 1.5;
        }
      `}</style>
      <section
        className="wrap"
        aria-label="MMR history"
        title="Snapshots are added only when you press refresh on this profile. Visit and refresh daily to keep adding points."
      >
        <div className="head">
          <span className="label">MMR History</span>
          <span className="meta">
            <strong>{points.length}</strong> snapshots · range{" "}
            <strong>{minMmr}</strong>–<strong>{maxMmr}</strong>
          </span>
        </div>
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
            <polygon
              className="area"
              points={`${first.x},${HEIGHT - PAD_Y} ${polylinePoints} ${last.x},${HEIGHT - PAD_Y}`}
            />
            <polyline className="line" points={polylinePoints} />
            <circle className="last-dot" cx={last.x} cy={last.y} r={2.5} />
            <text
              className="axis"
              x={last.x - 4}
              y={last.y - 6}
              textAnchor="end"
            >
              {last.mmr}
            </text>
            <text className="axis" x={PAD_X} y={HEIGHT - 2}>
              {formatDate(first.at)}
            </text>
            <text
              className="axis"
              x={WIDTH - PAD_X}
              y={HEIGHT - 2}
              textAnchor="end"
            >
              {formatDate(last.at)}
            </text>
          </svg>
        </div>
        <p className="note">
          Snapshots are added only when you press refresh on this profile —
          updates do not happen automatically. Check back and refresh daily
          to keep adding points.
        </p>
      </section>
    </>
  );
}
