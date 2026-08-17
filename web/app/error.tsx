"use client";

import { useEffect, useState } from "react";
import { getPostHog } from "@/lib/posthog";
import { trackEvent } from "@/lib/analytics";
import { attemptChunkReload, isChunkLoadError } from "@/lib/chunkReload";
import styles from "./error.module.css";

// Route-segment error boundary for the App Router tree (rendered inside the
// root layout, so the nav/footer chrome stays put). Its main job is turning a
// post-deploy `ChunkLoadError` — which otherwise dead-ends the user on a stale
// Turbopack chunk — into a single automatic reload onto the current deploy.
// See lib/chunkReload.ts for the version-skew background and the loop guard.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const chunkError = isChunkLoadError(error);

    void getPostHog().then((ph) => ph?.captureException?.(error));
    trackEvent("App Error Boundary", {
      boundary: "route",
      chunk_load_error: chunkError,
      digest: error.digest,
    });

    if (chunkError && attemptChunkReload()) {
      setReloading(true);
    }
  }, [error]);

  if (reloading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.eyebrow}>Updating</div>
          <h1>Loading the latest version…</h1>
          <p>A new version of the site was just released. Reloading now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>Something went wrong</div>
        <h1>This page hit an error</h1>
        <p>
          Try again, or reload the page. If a new version was just deployed, a
          reload usually clears it.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => reset()}
          >
            Try again
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.ghost}`}
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
        {error.digest && <div className={styles.digest}>Ref: {error.digest}</div>}
      </div>
    </div>
  );
}
