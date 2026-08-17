"use client";

import { useEffect, useState } from "react";
import "@/styles/globals.css";
import { getPostHog } from "@/lib/posthog";
import { trackEvent } from "@/lib/analytics";
import { attemptChunkReload, isChunkLoadError } from "@/lib/chunkReload";
import styles from "./error.module.css";

// Top-level error boundary: catches errors thrown by the root layout itself
// (where the route-level error.tsx cannot reach) and replaces the whole
// document, so it must render its own <html>/<body> and bring its own styles.
// Like error.tsx, it auto-recovers from post-deploy chunk version skew with a
// single guarded reload — see lib/chunkReload.ts.
export default function GlobalError({
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
      boundary: "global",
      chunk_load_error: chunkError,
      digest: error.digest,
    });

    if (chunkError && attemptChunkReload()) {
      setReloading(true);
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        {reloading ? (
          <div className={styles.page}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Updating</div>
              <h1>Loading the latest version…</h1>
              <p>A new version of the site was just released. Reloading now.</p>
            </div>
          </div>
        ) : (
          <div className={styles.page}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Something went wrong</div>
              <h1>The site hit an error</h1>
              <p>
                Try again, or reload the page. If a new version was just
                deployed, a reload usually clears it.
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
              {error.digest && (
                <div className={styles.digest}>Ref: {error.digest}</div>
              )}
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
