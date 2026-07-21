"use client";

import { useEffect, useMemo, useState } from "react";
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

interface BuildItemPick {
  slug: string;
  name: string;
  iconUrl: string;
}

interface BuildPiece {
  unitSlug: string;
  name: string;
  iconUrl: string;
  stars: number;
  items: BuildItemPick[];
}

interface BuildSnapshot {
  label: string;
  pieces: BuildPiece[];
}

/** Decodes the same base64url payload web/app/builds/BuildPlanner.tsx encodes. */
function decodeShareLink(shareLink: string): BuildSnapshot[] | null {
  try {
    const b = new URL(shareLink, "https://placeholder.invalid").searchParams.get("b");
    if (!b) return null;
    const padded = b.replaceAll("-", "+").replaceAll("_", "/");
    const json = decodeURIComponent(escape(atob(padded)));
    const payload = JSON.parse(json);
    const snapshots = payload?.build?.snapshots;
    return Array.isArray(snapshots) ? snapshots : null;
  } catch {
    return null;
  }
}

function StarRow({ stars }: { stars: number }) {
  return <span className={styles.stars}>{"★".repeat(stars)}</span>;
}

function BoardIcons({ shareLink }: { shareLink: string }) {
  const snapshots = useMemo(() => decodeShareLink(shareLink), [shareLink]);
  if (!snapshots || snapshots.length === 0) return null;

  // The last snapshot is the final/strongest board — that's the one worth
  // showing at a glance; earlier snapshots (e.g. an early win-streak setup)
  // are still fully described in the write-up below.
  const snapshot = snapshots[snapshots.length - 1];
  if (!snapshot.pieces?.length) return null;

  return (
    <div className={styles.board}>
      <div className={styles.boardLabel}>{snapshot.label}</div>
      <div className={styles.boardGrid}>
        {snapshot.pieces.map((piece) => (
          <div key={piece.unitSlug} className={styles.piece}>
            <div className={styles.pieceUnit}>
              <img src={piece.iconUrl} alt="" className={styles.unitIcon} />
              <div>
                <div className={styles.pieceName}>{piece.name}</div>
                <StarRow stars={piece.stars} />
              </div>
            </div>
            {piece.items.length > 0 && (
              <div className={styles.pieceItems}>
                {piece.items.map((item) => (
                  <img
                    key={item.slug}
                    src={item.iconUrl}
                    alt={item.name}
                    title={item.name}
                    className={styles.itemIcon}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
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
          <>
            <BoardIcons shareLink={guide.shareLink} />
            <Link href={guide.shareLink} className={styles.shareLink} prefetch={false}>
              Open this board in the Build Planner →
            </Link>
          </>
        )}

        <Markdown className={styles.body}>{guide.body}</Markdown>

        <div className={styles.footer}>
          <Link href="/guides">← Back to all guides</Link>
        </div>
      </div>
    </div>
  );
}
