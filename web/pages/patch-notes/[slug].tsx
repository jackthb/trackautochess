import type React from "react";
import fs from "fs";
import path from "path";
import Link from "next/link";
import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import patchIndex from "@data/patch_notes/index.json";
import { SeoHead } from "@/lib/seo";
import { getItemSlugByName, getItemBySlug, iconUrl } from "@/lib/items";
import { getRelicSlugByName, getRelicBySlug } from "@/lib/relics";
import { getTalentByName } from "@/lib/talents";
import { absoluteUrl, SITE_NAME, SITE_TITLE } from "@/lib/site";

type EntryKind =
  | "added"
  | "removed"
  | "buff"
  | "nerf"
  | "change"
  | "rework"
  | "fix";

interface PatchEntry {
  kind: EntryKind;
  name: string;
  detail: string;
}

interface PatchSection {
  heading: string;
  entries: PatchEntry[];
}

interface Patch {
  date: string;
  title: string;
  source?: string;
  workshop_url?: string;
  flavor?: string;
  summary?: string;
  sections: PatchSection[];
}

interface IndexPatch {
  date: string;
  title: string;
  slug: string;
}

interface PatchPageProps {
  patch: Patch;
  slug: string;
  supabase: SupabaseClient | null;
}

const KIND_COLOR: Record<EntryKind, string> = {
  added: "var(--green-bright)",
  removed: "var(--red-bright)",
  buff: "var(--green-bright)",
  nerf: "var(--red-bright)",
  change: "var(--text-secondary)",
  rework: "var(--gold)",
  fix: "var(--text-secondary)",
};

const KIND_LABEL: Record<EntryKind, string> = {
  added: "NEW",
  removed: "REMOVED",
  buff: "BUFF",
  nerf: "NERF",
  change: "CHANGE",
  rework: "REWORK",
  fix: "FIX",
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildPatchDescription(patch: Patch): string {
  const summaryLines = (patch.summary || "")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter(
      (line) => line !== patch.title && !/^click the title link/i.test(line)
    );

  if (summaryLines.length > 0) {
    return truncate(
      `${patch.title} patch notes for Dota Auto Chess. ${summaryLines
        .slice(0, 2)
        .join(" ")}`,
      158
    );
  }

  const firstEntries = patch.sections
    .flatMap((section) => section.entries)
    .slice(0, 2)
    .map((entry) => cleanText(`${entry.name}: ${entry.detail}`))
    .join(" ");

  return truncate(
    `${patch.title} patch notes for Dota Auto Chess. ${firstEntries || "Read new relics, new items, and balance changes."}`,
    158
  );
}

interface EntryMeta {
  href: string | null;
  iconSrc: string | null;
  tooltip: string | null;
}

function resolveEntryMeta(name: string): EntryMeta {
  const itemSlug = getItemSlugByName(name);
  if (itemSlug) {
    const item = getItemBySlug(itemSlug);
    return {
      href: `/items/${itemSlug}`,
      iconSrc: item ? iconUrl(item) : null,
      tooltip: item ? `${item.name}: ${item.description}` : null,
    };
  }

  const relicSlug = getRelicSlugByName(name);
  if (relicSlug) {
    const relic = getRelicBySlug(relicSlug);
    return {
      href: `/relics/${relicSlug}`,
      iconSrc: relic ? relic.iconUrl : null,
      tooltip: relic ? `${relic.name}: ${relic.description}` : null,
    };
  }

  const talent = getTalentByName(name.replace(/^\d+[ab]\s*[—-]\s*/i, ""));
  if (talent) {
    return {
      href: "/talents",
      iconSrc: null,
      tooltip: `${talent.key} ${talent.name}: ${talent.description}`,
    };
  }

  return { href: null, iconSrc: null, tooltip: null };
}

export default function PatchDetailPage({
  patch,
  slug,
  supabase,
}: PatchPageProps) {
  const title = `${patch.title} | Patch Notes | ${SITE_TITLE}`;
  const description = buildPatchDescription(patch);
  const pagePath = `/patch-notes/${slug}`;
  const pageUrl = absoluteUrl(pagePath);
  const patchIndexUrl = absoluteUrl("/patch-notes");
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: patch.title,
      description,
      datePublished: patch.date,
      dateModified: patch.date,
      ...(pageUrl ? { url: pageUrl, mainEntityOfPage: pageUrl } : {}),
      publisher: {
        "@type": "Organization",
        name: SITE_NAME,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Patch Notes",
          ...(patchIndexUrl ? { item: patchIndexUrl } : {}),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: patch.title,
          ...(pageUrl ? { item: pageUrl } : {}),
        },
      ],
    },
  ];

  const summaryLines = (patch.summary || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) => line !== patch.title && !/^click the title link/i.test(line)
    );

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path={pagePath}
        type="article"
        publishedTime={patch.date}
        structuredData={structuredData}
      />

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .container {
          max-width: 760px;
          margin: 0 auto;
          padding: var(--s-40) var(--s-32) var(--s-48);
        }
        .breadcrumbs {
          display: flex;
          gap: var(--s-10);
          flex-wrap: wrap;
          margin-bottom: var(--s-20);
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .breadcrumbs a {
          color: var(--text-muted);
          transition: color var(--t-base) var(--t-easing);
        }
        .breadcrumbs a:hover {
          color: var(--text-secondary);
        }
        .date {
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper-wide);
          color: var(--text-muted);
          text-transform: uppercase;
          margin-bottom: var(--s-8);
        }
        .title {
          font-family: var(--font-display);
          font-size: var(--fs-32);
          font-weight: var(--fw-bold);
          letter-spacing: var(--tr-display);
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: var(--s-20);
        }
        .link-row {
          display: flex;
          gap: var(--s-10);
          flex-wrap: wrap;
          margin-bottom: var(--s-24);
        }
        .source {
          display: inline-block;
          font-size: var(--fs-11);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
          border: 1px solid var(--border);
          border-radius: var(--r-3);
          padding: var(--s-6) var(--s-12);
          transition: color var(--t-base) var(--t-easing),
            border-color var(--t-base) var(--t-easing),
            background var(--t-base) var(--t-easing);
        }
        .source:hover {
          color: var(--text-secondary);
          border-color: var(--text-muted);
          background: var(--bg-hover);
        }
        .summary {
          padding: var(--s-20) var(--s-24);
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--r-8);
          margin-bottom: var(--s-32);
        }
        .summary-line {
          font-size: var(--fs-14);
          line-height: var(--lh-relaxed);
          color: var(--text-primary);
          padding: var(--s-8) 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .summary-line:last-child,
        .summary-line.summary-last {
          border-bottom: none;
        }
        .summary-line.bullet {
          position: relative;
          padding-left: var(--s-20);
        }
        .summary-line.bullet::before {
          content: "*";
          position: absolute;
          left: 0;
          top: var(--s-8);
          color: var(--accent-dim);
          font-size: var(--fs-11);
          line-height: var(--lh-body);
        }
        .summary-footer {
          margin-top: var(--s-16);
          padding-top: var(--s-14);
          border-top: 1px solid var(--border-subtle);
          font-size: var(--fs-12);
          color: var(--text-muted);
          letter-spacing: var(--tr-body);
        }
        .summary-footer a {
          color: var(--accent-dim);
          text-decoration: underline;
          transition: color var(--t-base) var(--t-easing);
        }
        .summary-footer a:hover {
          color: var(--accent);
        }
        .flavor {
          font-size: var(--fs-14);
          line-height: var(--lh-relaxed);
          color: var(--text-secondary);
          font-style: italic;
          padding: var(--s-16) var(--s-20);
          border-left: 2px solid var(--accent-dim);
          background: var(--bg-surface);
          border-radius: 0 var(--r-8) var(--r-8) 0;
          margin-bottom: var(--s-40);
        }
        .section {
          margin-bottom: var(--s-32);
        }
        .section-heading {
          font-family: var(--font-display);
          font-size: var(--fs-14);
          letter-spacing: var(--tr-display);
          text-transform: uppercase;
          color: var(--text-primary);
          padding-bottom: var(--s-10);
          border-bottom: 1px solid var(--border);
          margin-bottom: var(--s-16);
        }
        .entry {
          display: grid;
          grid-template-columns: 90px 1fr;
          gap: var(--s-16);
          padding: var(--s-12) 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .entry:last-child {
          border-bottom: none;
        }
        .kind {
          font-size: var(--fs-11);
          letter-spacing: var(--tr-upper);
          font-weight: var(--fw-semibold);
          padding-top: 2px;
        }
        .entry-name-row {
          display: flex;
          align-items: center;
          gap: var(--s-10);
          margin-bottom: var(--s-4);
        }
        .entry-icon {
          flex-shrink: 0;
          width: 44px;
          height: 32px;
          object-fit: contain;
          border: 1px solid var(--border);
          border-radius: var(--r-4);
          background: var(--bg-deep);
        }
        .entry-name {
          font-size: var(--fs-14);
          color: var(--text-primary);
          font-weight: var(--fw-medium);
        }
        .entry-link {
          text-decoration: underline;
          text-underline-offset: 2px;
          transition: color var(--t-base) var(--t-easing);
        }
        .entry-link:hover {
          color: var(--accent-dim);
        }
        .entry-tooltip {
          position: relative;
        }
        .entry-tooltip:hover::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 0;
          top: calc(100% + 6px);
          z-index: 20;
          max-width: 420px;
          width: max-content;
          background: var(--bg-elevated, #11161d);
          border: 1px solid var(--border);
          border-radius: var(--r-6);
          padding: var(--s-8) var(--s-10);
          color: var(--text-primary);
          font-size: var(--fs-12);
          line-height: 1.45;
          text-transform: none;
          letter-spacing: normal;
          white-space: normal;
        }
        .entry-detail {
          font-size: var(--fs-13);
          line-height: var(--lh-body);
          color: var(--text-secondary);
        }
      `}</style>

      <div className="page">
        <div className="container">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span>/</span>
            <Link href="/patch-notes">Patch Notes</Link>
            <span>/</span>
            <span>{patch.title}</span>
          </nav>
          <div className="date">{patch.date}</div>
          <h1 className="title">{patch.title}</h1>

          {(patch.source || patch.workshop_url) && (
            <div className="link-row">
              {patch.source && (
                <a
                  className="source"
                  href={patch.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  Official notes
                </a>
              )}
              {patch.workshop_url && (
                <a
                  className="source"
                  href={patch.workshop_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Workshop changelog
                </a>
              )}
            </div>
          )}

          {patch.flavor && <div className="flavor">{patch.flavor}</div>}

          {patch.sections.length === 0 && summaryLines.length > 0 && (
            <div className="summary">
              {summaryLines.map((line, index) => {
                const isBullet = /^[\u2022\u00B7*-]/.test(line);
                const cleanedLine = isBullet
                  ? line.replace(/^[\u2022\u00B7*-]\s*/, "")
                  : line;

                return (
                  <div
                    key={index}
                    className={[
                      "summary-line",
                      isBullet ? "bullet" : "",
                      index === summaryLines.length - 1 && !patch.source
                        ? "summary-last"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {cleanedLine}
                  </div>
                );
              })}
              {patch.source && (
                <div className="summary-footer">
                  Full prose lives in the{" "}
                  <a href={patch.source} target="_blank" rel="noreferrer">
                    official notes
                  </a>
                  .
                </div>
              )}
            </div>
          )}

          {patch.sections.map((section) => (
            <div key={section.heading} className="section">
              <div className="section-heading">{section.heading}</div>
              {section.entries.map((entry, index) => {
                const { href, iconSrc, tooltip } = resolveEntryMeta(entry.name);

                return (
                  <div key={index} className="entry">
                    <span
                      className="kind"
                      style={{ color: KIND_COLOR[entry.kind] }}
                    >
                      {KIND_LABEL[entry.kind]}
                    </span>
                    <div>
                      <div className="entry-name-row">
                        {iconSrc && (
                          <img
                            className="entry-icon"
                            src={iconSrc}
                            alt=""
                            width={44}
                            height={32}
                            onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                        {href ? (
                          <Link href={href} className="entry-name entry-link">
                            {entry.name}
                          </Link>
                        ) : (
                          <span className="entry-name">{entry.name}</span>
                        )}
                        {tooltip && (
                          <span className="entry-tooltip" data-tooltip={tooltip}>
                            ⓘ
                          </span>
                        )}
                      </div>
                      <div className="entry-detail">{entry.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: (patchIndex.patches as IndexPatch[]).map((patch) => ({
      params: { slug: patch.slug },
    })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug as string;
  const filePath = path.join(
    process.cwd(),
    "..",
    "data",
    "patch_notes",
    `${slug}.json`
  );
  const patch: Patch = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  return {
    props: {
      patch,
      slug,
    },
  };
};
