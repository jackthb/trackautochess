"use client";

import { useEffect, useState } from "react";
import styles from "./queens.module.css";

const TICK_MS = 1000;

function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 0) return "updating";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

export function NextRefreshTime({
  latestFetchedAt,
  cooldownMs,
}: {
  latestFetchedAt: string | null;
  cooldownMs: number;
}) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const latestFetchedMs = latestFetchedAt ? new Date(latestFetchedAt).getTime() : NaN;
  if (nowMs == null) return <strong>...</strong>;
  if (!Number.isFinite(latestFetchedMs)) {
    return <strong className={styles["refresh-ready"]}>updating</strong>;
  }

  const availableAtMs = latestFetchedMs + cooldownMs;
  const remainingMs = availableAtMs - nowMs;
  const ready = remainingMs <= 0;
  return (
    <strong
      className={ready ? styles["refresh-ready"] : undefined}
      title={new Date(availableAtMs).toLocaleString()}
    >
      {formatRemaining(remainingMs)}
    </strong>
  );
}
