import { useEffect, useState } from "react";
import type { NetTableActivityEntry } from "../hooks/useNetTableEvents";

interface NetTableActivityFeedProps {
  entries: NetTableActivityEntry[];
}

function formatRelative(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function NetTableActivityFeed({ entries }: NetTableActivityFeedProps) {
  // Tick once a minute so relative times stay fresh without thrashing renders.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Show newest at the top.
  const ordered = [...entries].reverse();

  return (
    <div className="nettable-activity">
      <div className="nettable-activity-header">Activity</div>
      {ordered.length === 0 ? (
        <div className="nettable-activity-empty">
          Waiting for the first capture. Run a game with the launch options set
          and dumps will appear here.
        </div>
      ) : (
        <ul className="nettable-activity-list">
          {ordered.map((entry) => (
            <li
              key={entry.id}
              className={`nettable-activity-item tone-${entry.tone || "info"}`}
            >
              <div className="nettable-activity-time">
                {formatRelative(entry.receivedAt, now)}
              </div>
              <div className="nettable-activity-body">
                <div className="nettable-activity-title">{entry.title}</div>
                {entry.detail && (
                  <div className="nettable-activity-detail">{entry.detail}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
