"use client";

import { useEffect, useState } from "react";
import { AdminGate } from "@/components/app/AdminGate";
import { fetchPendingBuilds, reviewBuild } from "@/lib/builds/client";
import type { CommunityBuildDetail } from "@/lib/builds/types";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { BuildBoardPreview, BuildSnapshotTabs } from "../BuildBoardPreview";
import styles from "../builds.module.css";

function ReviewQueue() {
  const { accessToken, ready } = useSupabaseSession();
  const [builds, setBuilds] = useState<CommunityBuildDetail[]>([]);
  const [activeById, setActiveById] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async (token: string) => {
    const rows = await fetchPendingBuilds(token);
    setBuilds(rows);
    setActiveById(
      Object.fromEntries(
        rows.map((build) => [build.id, build.payload.snapshots[0]?.id ?? ""]),
      ),
    );
  };

  useEffect(() => {
    if (!ready || !accessToken) return;
    let cancelled = false;
    void reload(accessToken)
      .then(() => {
        if (!cancelled) setError("");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load queue");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, accessToken]);

  const handleReview = async (id: string, action: "approve" | "reject") => {
    if (!accessToken) return;
    setBusyId(id);
    try {
      await reviewBuild(id, action, accessToken);
      await reload(accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!accessToken) {
    return <p className={styles.signInHint}>Sign in as admin to review builds.</p>;
  }

  return (
    <div className={styles.reviewQueue}>
      {error && <p className={styles.signInHint}>{error}</p>}
      {builds.length === 0 && !error && (
        <p className={styles.signInHint}>No pending submissions.</p>
      )}
      {builds.map((build) => {
        const activeId = activeById[build.id] ?? build.payload.snapshots[0]?.id;
        const snapshot =
          build.payload.snapshots.find((snap) => snap.id === activeId) ??
          build.payload.snapshots[0];
        return (
          <article key={build.id} className={styles.reviewCard}>
            <div className={styles.publicCardHeader}>
              <div>
                <h3 style={{ margin: 0 }}>{build.name}</h3>
                <div className={styles.publicMeta}>
                  <span>{build.authorName || build.authorSteamId}</span>
                  {build.submittedAt && (
                    <span>Submitted {new Date(build.submittedAt).toLocaleString()}</span>
                  )}
                </div>
              </div>
            </div>
            {build.description && <p>{build.description}</p>}
            {snapshot && (
              <>
                <BuildSnapshotTabs
                  build={build.payload}
                  activeSnapshotId={snapshot.id}
                  onSelect={(id) =>
                    setActiveById((current) => ({ ...current, [build.id]: id }))
                  }
                />
                <BuildBoardPreview snapshot={snapshot} compact />
              </>
            )}
            <div className={styles.reviewActions}>
              <button
                type="button"
                className={styles.statusButton}
                disabled={busyId === build.id}
                onClick={() => handleReview(build.id, "approve")}
              >
                Approve
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={busyId === build.id}
                onClick={() => handleReview(build.id, "reject")}
              >
                Reject
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function BuildReviewClient() {
  return (
    <AdminGate>
      <ReviewQueue />
    </AdminGate>
  );
}
