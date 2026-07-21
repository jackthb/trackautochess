"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import styles from "./guide.module.css";

interface GuideSource {
  label: string;
  url: string;
}

interface Guide {
  title: string;
  sources: GuideSource[];
  shareLink?: string | null;
  body: string;
}

export function GuideDetailClient({ slug }: { slug: string }) {
  const { accessToken, ready } = useSupabaseSession();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!ready || !accessToken) return;
    let cancelled = false;

    fetch(`/api/guides/${slug}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (!cancelled) {
          setGuide(data.guide);
          setStatus("ok");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, accessToken, slug]);

  if (status === "loading") return <div className={styles.container}>Loading…</div>;
  if (status === "error" || !guide) return <div className={styles.container}>Guide not found.</div>;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span>/</span>
          <Link href="/guides">Guides</Link>
          <span>/</span>
          <span>{guide.title}</span>
        </nav>

        <h1 className={styles.title}>{guide.title}</h1>

        {guide.sources.length > 0 && (
          <div className={styles.sources}>
            {guide.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className={styles.sourceLink}
              >
                ▶ Watch: {source.label}
              </a>
            ))}
          </div>
        )}

        {guide.shareLink && (
          <Link href={guide.shareLink} className={styles.shareLink} prefetch={false}>
            Open this board in the Build Planner →
          </Link>
        )}

        <Markdown className={styles.body}>{guide.body}</Markdown>

        <div className={styles.footer}>
          <Link href="/guides">← Back to all guides</Link>
        </div>
      </div>
    </div>
  );
}
