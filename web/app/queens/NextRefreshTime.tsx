"use client";

import { useEffect, useState } from "react";
import styles from "./queens.module.css";

const TICK_MS = 1000;
export const QUEENS_REFRESH_CHECKED_EVENT = "dac:queens-refresh-checked";

function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 0) return "ready";
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
  const [effectiveLatestFetchedAt, setEffectiveLatestFetchedAt] =
    useState(latestFetchedAt);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setEffectiveLatestFetchedAt(latestFetchedAt);
  }, [latestFetchedAt]);

  useEffect(() => {
    const onChecked = (event: Event) => {
      const checkedAt = (event as CustomEvent<{ checkedAt?: unknown }>).detail
        ?.checkedAt;
      if (typeof checkedAt === "string") {
        setEffectiveLatestFetchedAt(checkedAt);
      }
    };
    window.addEventListener(QUEENS_REFRESH_CHECKED_EVENT, onChecked);
    return () => {
      window.removeEventListener(QUEENS_REFRESH_CHECKED_EVENT, onChecked);
    };
  }, []);

  const latestFetchedMs = effectiveLatestFetchedAt
    ? new Date(effectiveLatestFetchedAt).getTime()
    : NaN;
  if (nowMs == null) return <strong>...</strong>;
  if (!Number.isFinite(latestFetchedMs)) {
    return <strong className={styles["refresh-ready"]}>ready</strong>;
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
