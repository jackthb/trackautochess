"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Keep an open tab in step with the visitor-scoped server refresh without
// re-pinging on every quick tab flip.
const PING_COOLDOWN_MS = 5 * 60 * 1000;
const VISIBLE_POLL_INTERVAL_MS = 5 * 60 * 1000;
const PING_COOLDOWN_KEY = "dac:queens-refresh-last-ping";

// /queens is ISR'd: the server rebuilds it the moment a Queen's stats change,
// but the background poll only re-checks Queens hourly — page viewers are
// what keep the table truly current. Hard page loads refresh server-side before
// rows render; this client fallback keeps parked tabs current on the same
// 5-minute cadence without multiplying work across tabs.
export function QueensAutoRefresh() {
  const router = useRouter();
  const lastPingAtRef = useRef(0);
  const pingInFlightRef = useRef(false);

  useEffect(() => {
    let disposed = false;

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

    const pingStaleRefresh = async () => {
      if (pingInFlightRef.current) return;
      const lastPingAt = Math.max(lastPingAtRef.current, sharedLastPingAt());
      if (Date.now() - lastPingAt < PING_COOLDOWN_MS) return;
      pingInFlightRef.current = true;
      setSharedLastPingAt(Date.now());
      try {
        const resp = await fetch("/api/queens/refresh", { method: "POST" });
        if (disposed) return;
        if (resp.status === 429) {
          setSharedLastPingAt(Date.now() + PING_COOLDOWN_MS);
          return;
        }
        if (!resp.ok) return;
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
      }
    };

    const sync = (refreshFirst: boolean) => {
      if (refreshFirst) router.refresh();
      void pingStaleRefresh();
    };

    sync(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync(true);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync(true);
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") sync(false);
    }, VISIBLE_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  return null;
}
