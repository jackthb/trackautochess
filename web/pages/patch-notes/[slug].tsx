import fs from "fs";
import path from "path";
import Link from "next/link";
import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import patchIndex from "@data/patch_notes/index.json";
import { SeoHead } from "@/lib/seo";
import { getItemSlugByName } from "@/lib/items";
import { getRelicSlugByName } from "@/lib/relics";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

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

function resolveEntryHref(name: string): string | null {
  const itemSlug = getItemSlugByName(name);
  if (itemSlug) return `/items/${itemSlug}`;

  const relicSlug = getRelicSlugByName(name);
  if (relicSlug) return `/relics/${relicSlug}`;

  return null;
}

export default function PatchDetailPage({
  patch,
  slug,
  supabase,
}: PatchPageProps) {
  const title = `${patch.title} | Dota Auto Chess Patch Notes | ${SITE_NAME}`;
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
          padding: 40px 32px 80px;
        }
        .breadcrumbs {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 22px;
          font-size: 12px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .breadcrumbs a {
          color: var(--text-muted);
        }
        .breadcrumbs a:hover {
          color: var(--text-secondary);
        }
        .date {
          font-size: 12px;
          letter-spacing: 2px;
          color: var(--text-muted);
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .title {
          font-family: "Cinzel", serif;
          font-size: 36px;
          font-weight: 700;
          letter-spacing: 5px;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 18px;
        }
        .lede {
          font-size: 15px;
          line-height: 1.7;
          color: var(--text-secondary);
          margin-bottom: 20px;
        }
        .link-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 24px;
        }
        .chip,
        .source {
          display: inline-block;
          font-size: 11px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          border: 1px solid var(--border);
          padding: 6px 12px;
          transition: all 0.15s;
        }
        .chip:hover,
        .source:hover {
          color: var(--text-secondary);
          border-color: var(--text-muted);
          background: var(--bg-hover);
        }
        .summary {
          padding: 20px 24px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          margin-bottom: 32px;
        }
        .summary-line {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-primary);
          padding: 8px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .summary-line:last-child,
        .summary-line.summary-last {
          border-bottom: none;
        }
        .summary-line.bullet {
          position: relative;
          padding-left: 20px;
        }
        .summary-line.bullet::before {
          content: "*";
          position: absolute;
          left: 0;
          top: 8px;
          color: var(--accent-dim);
          font-size: 8px;
          line-height: 1.6;
        }
        .summary-footer {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid var(--border-subtle);
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .summary-footer a {
          color: var(--accent-dim);
          text-decoration: underline;
        }
        .summary-footer a:hover {
          color: var(--accent);
        }
        .flavor {
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-secondary);
          font-style: italic;
          padding: 18px 20px;
          border-left: 2px solid var(--accent-dim);
          background: var(--bg-surface);
          margin-bottom: 40px;
        }
        .section {
          margin-bottom: 36px;
        }
        .section-heading {
          font-family: "Cinzel", serif;
          font-size: 15px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-primary);
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 16px;
        }
        .entry {
          display: grid;
          grid-template-columns: 90px 1fr;
          gap: 16px;
          padding: 12px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .entry:last-child {
          border-bottom: none;
        }
        .kind {
          font-size: 10px;
          letter-spacing: 1.5px;
          font-weight: 600;
          padding-top: 2px;
        }
        .entry-name {
          font-size: 14px;
          color: var(--text-primary);
          font-weight: 500;
          margin-bottom: 4px;
        }
        .entry-link {
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .entry-link:hover {
          color: var(--accent-dim);
        }
        .entry-detail {
          font-size: 13px;
          line-height: 1.55;
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
          <div className="lede">
            Read this Dota Auto Chess update in a cleaner format, then jump into
            linked item and relic pages where the patch introduces or changes
            named content.
          </div>

          <div className="link-row">
            <Link href="/items" className="chip">
              Item library
            </Link>
            <Link href="/relics" className="chip">
              Relic library
            </Link>
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
                const entryHref = resolveEntryHref(entry.name);

                return (
                  <div key={index} className="entry">
                    <span
                      className="kind"
                      style={{ color: KIND_COLOR[entry.kind] }}
                    >
                      {KIND_LABEL[entry.kind]}
                    </span>
                    <div>
                      {entryHref ? (
                        <Link href={entryHref} className="entry-name entry-link">
                          {entry.name}
                        </Link>
                      ) : (
                        <div className="entry-name">{entry.name}</div>
                      )}
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
