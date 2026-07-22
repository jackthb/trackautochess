"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import { useIsAdmin } from "@/lib/admin";
import { fetchPublicBuilds } from "@/lib/builds/client";
import type { CommunityBuildSummary } from "@/lib/builds/types";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { BuildPlanner, type BuilderItem, type BuilderUnit } from "./BuildPlanner";
import styles from "./builds.module.css";

type Tab = "planner" | "public";

export function BuildsPageClient({
  units,
  items,
  initialTab = "planner",
}: {
  units: BuilderUnit[];
  items: BuilderItem[];
  initialTab?: Tab;
}) {
  const { steamId, accessToken, ready } = useSupabaseSession();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [builds, setBuilds] = useState<CommunityBuildSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isAdmin = useIsAdmin(steamId);

  useEffect(() => {
    if (tab !== "public" || !ready) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPublicBuilds(accessToken)
      .then((rows) => {
        if (!cancelled) setBuilds(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load builds");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, ready, accessToken]);

  return (
    <div>
      <div className={styles.pageTabs}>
        <button
          type="button"
          className={`${styles.pageTab} ${tab === "planner" ? styles.activePageTab : ""}`}
          onClick={() => setTab("planner")}
        >
          Planner
        </button>
        <button
          type="button"
          className={`${styles.pageTab} ${tab === "public" ? styles.activePageTab : ""}`}
          onClick={() => setTab("public")}
        >
          Public builds
        </button>
        {isAdmin && (
          <Link href="/builds/review" className={styles.pageTab}>
            Review queue
          </Link>
        )}
      </div>

      {tab === "planner" ? (
        <BuildPlanner units={units} items={items} />
      ) : (
        <div className={styles.publicList}>
          {loading && <p className={styles.signInHint}>Loading public builds…</p>}
          {error && <p className={styles.signInHint}>{error}</p>}
          {!loading && !error && builds.length === 0 && (
            <p className={styles.signInHint}>
              No approved builds yet. Plan one and submit it for the public list.
            </p>
          )}
          {builds.map((build) => (
            <Link key={build.id} href={`/builds/${build.id}`} className={styles.publicCard}>
              <div className={styles.publicCardHeader}>
                <h3>{build.name}</h3>
                <span>{build.upvoteCount} upvotes</span>
              </div>
              {build.description && <p>{build.description}</p>}
              <div className={styles.publicMeta}>
                <span>{build.authorName || build.authorSteamId}</span>
                <span>Updated {new Date(build.updatedAt).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
          {!steamId && ready && (
            <div className={styles.signInHint}>
              <span>Sign in to upvote and comment on builds.</span>
              <SteamSignInButton source="builds" size="sm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
