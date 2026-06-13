"use client";

import { useEffect, useState } from "react";
import styles from "./SiteStatusBanner.module.css";

type StatusLevel = "info" | "warning" | "error";

interface SiteStatus {
  active: boolean;
  message?: string;
  level?: StatusLevel;
}

const POLL_INTERVAL_MS = 60 * 1000;

// Reads /api/site-status (uncached) on mount and on a slow poll, so a notice
// posted from the Supabase dashboard appears — and clears — without a reload or
// a redeploy. Most pages are statically generated, so this stays client-side
// rather than rendering in the server layout where it would be baked in.
export function SiteStatusBanner() {
  const [status, setStatus] = useState<SiteStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/site-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as SiteStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // Best-effort: a failed fetch just leaves the banner as-is.
      }
    };

    void load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!status?.active || !status.message) return null;
  const level: StatusLevel = status.level ?? "warning";

  return (
    <div
      className={`${styles.banner} ${styles[level]}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.message}>{status.message}</span>
    </div>
  );
}
