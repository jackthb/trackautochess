"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QUEENS_REFRESH_CHECKED_EVENT } from "./NextRefreshTime";
import { nextQueensRefreshDelayMs } from "./refreshTiming";
import styles from "./queens.module.css";

const MIN_RETRY_MS = 30 * 1000;
const STATUS_CLEAR_MS = 8 * 1000;

type RefreshStatus = "idle" | "loading" | "current" | "updated" | "rate-limited" | "error";

interface QueensRefreshResponse {
  changed?: unknown;
  checked_at?: unknown;
}

// /queens is ISR'd: the page renders cached rows quickly, then this client
// keeps visible tabs current by asking the refresh endpoint to poll Drodo after
// the displayed countdown reaches zero.
export function QueensAutoRefresh({
  latestFetchedAt,
  cooldownMs,
}: {
  latestFetchedAt: string | null;
  cooldownMs: number;
}) {
  const router = useRouter();
  const pingInFlightRef = useRef(false);
  const latestFetchedAtRef = useRef(latestFetchedAt);
  const [status, setStatus] = useState<RefreshStatus>("idle");

  useEffect(() => {
    latestFetchedAtRef.current = latestFetchedAt;
  }, [latestFetchedAt]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let statusTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const clearStatusTimer = () => {
      if (!statusTimer) return;
      clearTimeout(statusTimer);
      statusTimer = null;
    };

    const showStatus = (nextStatus: RefreshStatus) => {
      clearStatusTimer();
      setStatus(nextStatus);
      if (nextStatus === "loading") return;
      statusTimer = setTimeout(() => {
        if (!disposed) setStatus("idle");
      }, STATUS_CLEAR_MS);
    };

    const nextDelayMs = () =>
      nextQueensRefreshDelayMs(latestFetchedAtRef.current, cooldownMs);

    const scheduleNext = (fallbackMs = MIN_RETRY_MS) => {
      clearTimer();
      if (document.visibilityState !== "visible") return;
      const delay = Math.max(nextDelayMs(), fallbackMs);
      timer = setTimeout(() => {
        void pingStaleRefresh();
      }, delay);
    };

    const pingStaleRefresh = async () => {
      if (pingInFlightRef.current) return;
      if (nextDelayMs() > 0) {
        scheduleNext();
        return;
      }
      pingInFlightRef.current = true;
      showStatus("loading");
      try {
        const resp = await fetch("/api/queens/refresh", { method: "POST" });
        if (disposed) return;
        if (resp.status === 429) {
          showStatus("rate-limited");
          scheduleNext(MIN_RETRY_MS);
          return;
        }
        if (!resp.ok) {
          showStatus("error");
          scheduleNext(MIN_RETRY_MS);
          return;
        }
        const data = (await resp.json().catch(() => null)) as
          | QueensRefreshResponse
          | null;
        if (typeof data?.checked_at === "string") {
          latestFetchedAtRef.current = data.checked_at;
          window.dispatchEvent(
            new CustomEvent(QUEENS_REFRESH_CHECKED_EVENT, {
              detail: { checkedAt: data.checked_at },
            })
          );
        }
        const refreshed =
          data != null &&
          typeof data === "object" &&
          typeof data.changed === "number" &&
          data.changed > 0;
        showStatus(refreshed ? "updated" : "current");
        if (refreshed) router.refresh();
      } catch {
        showStatus("error");
        // Network hiccups just leave the table on the last build; the next
        // trigger retries.
      } finally {
        pingInFlightRef.current = false;
        if (!disposed) scheduleNext();
      }
    };

    const sync = (refreshFirst: boolean) => {
      if (refreshFirst) router.refresh();
      void pingStaleRefresh();
    };

    sync(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        sync(true);
      } else {
        clearTimer();
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync(true);
    };
    scheduleNext(0);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      disposed = true;
      clearTimer();
      clearStatusTimer();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [cooldownMs, router]);

  if (status === "idle") return null;

  const label =
    status === "loading"
      ? "Refreshing Queen profiles..."
      : status === "updated"
        ? "Profiles refreshed. Updating table..."
        : status === "current"
          ? "Queen profiles are already current."
          : status === "rate-limited"
            ? "Refresh queued. Trying again shortly."
            : "Refresh failed. Retrying shortly.";

  return (
    <div
      className={`${styles["refresh-status"]} ${
        status === "loading" ? styles["refresh-status-loading"] : ""
      }`}
      role="status"
      aria-live="polite"
    >
      {status === "loading" ? <span className={styles.spinner} aria-hidden="true" /> : null}
      <span>{label}</span>
    </div>
  );
}
