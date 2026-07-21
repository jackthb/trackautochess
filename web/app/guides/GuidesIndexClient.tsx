"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import styles from "./guides.module.css";

interface IndexGuide {
  slug: string;
  title: string;
}

export function GuidesIndexClient() {
  const { accessToken, ready } = useSupabaseSession();
  const [guides, setGuides] = useState<IndexGuide[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!ready || !accessToken) return;
    let cancelled = false;

    fetch("/api/guides", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (!cancelled) setGuides(data.guides);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, accessToken]);

  if (error) return <div className={styles.container}>Couldn&apos;t load guides.</div>;
  if (!guides) return <div className={styles.container}>Loading…</div>;

  const howTo = guides.find((g) => g.slug === "how-to-play");
  const comps = guides
    .filter((g) => g.slug !== "how-to-play")
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.pageTitle}>Guides</h1>

        {howTo && (
          <Link href={`/guides/${howTo.slug}`} prefetch={false} className={styles.featured}>
            <span className={styles.featuredLabel}>Start here</span>
            <span className={styles.featuredTitle}>{howTo.title}</span>
          </Link>
        )}

        <h2 className={styles.sectionHeading}>Build guides</h2>
        <div className={styles.grid}>
          {comps.map((guide) => (
            <Link
              key={guide.slug}
              href={`/guides/${guide.slug}`}
              prefetch={false}
              className={styles.card}
            >
              {guide.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
