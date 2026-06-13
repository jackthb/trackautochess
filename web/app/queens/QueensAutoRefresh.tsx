"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { nextQueensRefreshDelayMs } from "./refreshTiming";

const MIN_RETRY_MS = 30 * 1000;

// /queens is ISR'd: the server rebuilds it the moment a Queen's stats change,
// but the background poll only re-checks Queens hourly — page viewers are
// what keep the table truly current. Hard page loads refresh server-side before
// rows render; this client fallback keeps parked tabs current on the same
// displayed countdown reaches zero without multiplying work across tabs.
export function QueensAutoRefresh({
  latestFetchedAt,
  cooldownMs,
}: {
  latestFetchedAt: string | null;
  cooldownMs: number;
}) {
  const router = useRouter();
  const pingInFlightRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const nextDelayMs = () =>
      nextQueensRefreshDelayMs(latestFetchedAt, cooldownMs);

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
      try {
        const resp = await fetch("/api/queens/refresh", { method: "POST" });
        if (disposed) return;
        if (resp.status === 429) {
          scheduleNext(MIN_RETRY_MS);
          return;
        }
        if (!resp.ok) {
          scheduleNext(MIN_RETRY_MS);
          return;
        }
        const data: unknown = await resp.json().catch(() => null);
        const refreshed =
          data != null &&
          typeof data === "object" &&
          typeof (data as { ok?: unknown }).ok === "number" &&
          (data as { ok: number }).ok > 0;
        if (refreshed) router.refresh();
      } catch {
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

    sync(true);
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
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [cooldownMs, latestFetchedAt, router]);

  return null;
}
