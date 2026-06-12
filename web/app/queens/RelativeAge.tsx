"use client";

import { useEffect, useState } from "react";
import styles from "../leaderboard/leaderboard.module.css";

const TICK_MS = 30 * 1000;
const QUEEN_ROW_STALE_THRESHOLD_MS = 60 * 60 * 1000;

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Live data age. Rendered as a placeholder on the server — ages are relative
// to the viewer's clock, so computing them during an ISR render would bake in
// the build time and break hydration — then filled and ticked client-side.
export function RelativeAge({ value }: { value: string | null }) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const valueMs = value ? new Date(value).getTime() : NaN;
  if (nowMs == null || !Number.isFinite(valueMs)) {
    return <span title={value ?? undefined}>—</span>;
  }
  const ageMs = Math.max(0, nowMs - valueMs);
  return (
    <span
      className={ageMs >= QUEEN_ROW_STALE_THRESHOLD_MS ? styles["age-stale"] : undefined}
      title={new Date(valueMs).toLocaleString()}
    >
      {formatAge(ageMs)}
    </span>
  );
}
