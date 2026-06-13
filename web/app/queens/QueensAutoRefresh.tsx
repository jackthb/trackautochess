"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Keep an open tab in step with the visitor-scoped server refresh without
// re-pinging on every quick tab flip.
const PING_COOLDOWN_MS = 5 * 60 * 1000;
const PING_COOLDOWN_KEY = "dac:queens-refresh-last-ping";
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
  const lastPingAtRef = useRef(0);
  const pingInFlightRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const nextDelayMs = () => {
      const latestFetchedMs = latestFetchedAt ? new Date(latestFetchedAt).getTime() : NaN;
      if (!Number.isFinite(latestFetchedMs)) return 0;
      return Math.max(0, latestFetchedMs + cooldownMs - Date.now());
    };

    const sharedLastPingAt = () => {
      try {
        const stored = window.localStorage.getItem(PING_COOLDOWN_KEY);
        const parsed = stored ? Number(stored) : NaN;
        return Number.isFinite(parsed) ? parsed : 0;
      } catch {
        return lastPingAtRef.current;
      }
    };

    const setSharedLastPingAt = (value: number) => {
      lastPingAtRef.current = value;
      try {
        window.localStorage.setItem(PING_COOLDOWN_KEY, String(value));
      } catch {
        // Storage can be unavailable in privacy modes or embedded webviews;
        // the in-memory ref still throttles this tab.
      }
    };

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
      const lastPingAt = Math.max(lastPingAtRef.current, sharedLastPingAt());
      const sharedCooldownRemaining = PING_COOLDOWN_MS - (Date.now() - lastPingAt);
      if (sharedCooldownRemaining > 0 || nextDelayMs() > 0) {
        scheduleNext(Math.max(MIN_RETRY_MS, sharedCooldownRemaining));
        return;
      }
      pingInFlightRef.current = true;
      setSharedLastPingAt(Date.now());
      try {
        const resp = await fetch("/api/queens/refresh", { method: "POST" });
        if (disposed) return;
        if (resp.status === 429) {
          setSharedLastPingAt(Date.now());
          scheduleNext(PING_COOLDOWN_MS);
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
