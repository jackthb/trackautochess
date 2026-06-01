import type { Metadata } from "next";
import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HideOnErrorImg } from "@/components/HideOnErrorImg";
import { draftMode } from "next/headers";
import patchIndex from "@data/patch_notes/index.json";
import { getItemBySlug, iconUrl } from "@/lib/items";
import { getRelicBySlug } from "@/lib/relics";
import { getTalentByName } from "@/lib/talents";
import { getUnitBySlug } from "@/lib/units";
import { getSynergyBySlug } from "@/lib/synergies";
import { absoluteUrl, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE, pickLocalized } from "@/lib/i18n";
import { loadDraftPatchNote } from "@/lib/sanity/draftLoaders";
import { type EntryKind, KIND_COLOR, KIND_LABEL } from "@/lib/patchKinds";
import { EntryCommentary } from "@/components/PatchCommentary";
import type { PatchEvidence } from "@/lib/patchCommentaryTypes";
import styles from "./patch.module.css";

// App Router migration of pages/patch-notes/[slug].tsx — the patch-note detail
// page. getStaticPaths -> generateStaticParams; getStaticProps -> async Server
// Component reading params + draftMode(). Draft mode reads stega-encoded content
// via loadDraftPatchNote; published pages read the on-disk JSON statically. The
// styled-jsx block is ported to patch.module.css. Single (English) locale —
// DEFAULT_LOCALE replaces the former router locale. The visual-editing overlay
// is mounted globally in the chrome, so this page does not mount it itself.

interface PatchEntry {
  kind: EntryKind;
  name: string;
  detail: string;
  entity_type?: "item" | "relic" | "talent" | "unit" | "synergy";
  entity_slug?: string;
  commentary?: string;
  evidence?: PatchEvidence[];
}

interface PatchSection {
  heading: string;
  entries: PatchEntry[];
}

interface Patch {
  date: string;
  title: string;
  titles?: Record<string, string> | null;
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

interface Props {
  params: Promise<{ slug: string }>;
}

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

function resolveEntryMeta(entry: PatchEntry): EntryMeta {
  if (!entry.entity_type || !entry.entity_slug) {
    return { href: null, iconSrc: null, tooltip: null };
  }
  switch (entry.entity_type) {
    case "item": {
      const item = getItemBySlug(entry.entity_slug);
      return {
        href: `/items/${entry.entity_slug}`,
        iconSrc: item ? iconUrl(item) : null,
        tooltip: item ? `${item.name}: ${item.description}` : null,
      };
    }
    case "relic": {
      const relic = getRelicBySlug(entry.entity_slug);
      return {
        href: `/relics/${entry.entity_slug}`,
        iconSrc: relic ? relic.iconUrl : null,
        tooltip: relic ? `${relic.name}: ${relic.description}` : null,
      };
    }
    case "talent": {
      const talent = getTalentByName(entry.name.replace(/^\d+[ab]\s*[—-]\s*/i, ""));
      return {
        href: "/talents",
        iconSrc: null,
        tooltip: talent ? `${talent.key} ${talent.name}: ${talent.description}` : null,
      };
    }
    case "unit": {
      const unit = getUnitBySlug(entry.entity_slug);
      return {
        href: `/units/${entry.entity_slug}`,
        iconSrc: unit ? unit.iconUrl : null,
        tooltip: unit ? `${unit.name} — Cost ${unit.cost}` : null,
      };
    }
    case "synergy": {
      const synergy = getSynergyBySlug(entry.entity_slug);
      return {
        href: `/synergies/${entry.entity_slug}`,
        iconSrc: synergy ? synergy.iconUrl : null,
        tooltip: synergy ? `${synergy.name}: ${synergy.description}` : null,
      };
    }
    default:
      return { href: null, iconSrc: null, tooltip: null };
  }
}

async function loadPatch(slug: string, isDraft: boolean): Promise<Patch | null> {
  if (isDraft) {
    const draft = await loadDraftPatchNote(slug, true);
    if (!draft) return null;
    return {
      date: draft.date,
      title: draft.title,
      source: draft.source,
      flavor: draft.flavor,
      sections: draft.sections.map((s) => ({
        heading: s.heading,
        entries: s.entries.map((e) => ({
          kind: e.kind as EntryKind,
          name: e.name,
          detail: e.detail,
          entity_type: e.entityType as PatchEntry["entity_type"],
          entity_slug: e.entitySlug,
          commentary: e.commentary,
          evidence: e.evidence,
        })),
      })),
    };
  }

  const filePath = path.join(
    process.cwd(),
    "..",
    "data",
    "patch_notes",
    `${slug}.json`
  );
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Patch;
}

export function generateStaticParams() {
  return (patchIndex.patches as IndexPatch[]).map((patch) => ({
    slug: patch.slug,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const patch = await loadPatch(slug, false);
  if (!patch) return {};

  const localizedTitle =
    pickLocalized(patch.titles ?? undefined, DEFAULT_LOCALE) || patch.title;
  const title = `${localizedTitle} | Patch Notes | ${SITE_TITLE}`;
  const description = buildPatchDescription(patch);

  return {
    title,
    description,
    alternates: { canonical: `/patch-notes/${slug}` },
    robots: "index, follow, max-image-preview:large",
    openGraph: {
      title,
      description,
      type: "article",
      siteName: SITE_NAME,
      url: `/patch-notes/${slug}`,
      locale: "en_US",
      images: ["/logo.svg"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/logo.svg"],
    },
  };
}

export default async function PatchDetailPage({ params }: Props) {
  const { slug } = await params;
  const { isEnabled: isDraft } = await draftMode();

  const patch = await loadPatch(slug, isDraft);
  if (!patch) notFound();

  const locale = DEFAULT_LOCALE;
  const localizedTitle =
    pickLocalized(patch.titles ?? undefined, locale) || patch.title;
  const description = buildPatchDescription(patch);
  const pagePath = `/patch-notes/${slug}`;
  const pageUrl = absoluteUrl(pagePath);
  const patchIndexUrl = absoluteUrl("/patch-notes");
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: localizedTitle,
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
          name: localizedTitle,
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className={styles.page}>
        <div className={styles.container}>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span>/</span>
            <Link href="/patch-notes">Patch Notes</Link>
            <span>/</span>
            <span>{localizedTitle}</span>
          </nav>
          <div className={styles.date}>{patch.date}</div>
          <h1 className={styles.title}>{localizedTitle}</h1>

          {(patch.source || patch.workshop_url) && (
            <div className={styles["link-row"]}>
              {patch.source && (
                <a
                  className={styles.source}
                  href={patch.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  Official notes
                </a>
              )}
              {patch.workshop_url && (
                <a
                  className={styles.source}
                  href={patch.workshop_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Workshop changelog
                </a>
              )}
            </div>
          )}

          {patch.flavor && <div className={styles.flavor}>{patch.flavor}</div>}

          {patch.sections.length === 0 && summaryLines.length > 0 && (
            <div className={styles.summary}>
              {summaryLines.map((line, index) => {
                const isBullet = /^[•·*-]/.test(line);
                const cleanedLine = isBullet
                  ? line.replace(/^[•·*-]\s*/, "")
                  : line;

                return (
                  <div
                    key={index}
                    className={[
                      styles["summary-line"],
                      isBullet ? styles.bullet : "",
                      index === summaryLines.length - 1 && !patch.source
                        ? styles["summary-last"]
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
                <div className={styles["summary-footer"]}>
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
            <div key={section.heading} className={styles.section}>
              <div className={styles["section-heading"]}>{section.heading}</div>
              {section.entries.map((entry, index) => {
                const { href, iconSrc, tooltip } = resolveEntryMeta(entry);

                return (
                  <div key={index} className={styles.entry}>
                    <span
                      className={styles.kind}
                      style={{ color: KIND_COLOR[entry.kind] }}
                    >
                      {KIND_LABEL[entry.kind]}
                    </span>
                    <div>
                      <div className={styles["entry-name-row"]}>
                        {iconSrc && (
                          <HideOnErrorImg
                            className={styles["entry-icon"]}
                            src={iconSrc}
                            alt=""
                          />
                        )}
                        {href ? (
                          <Link
                            href={href}
                            className={`${styles["entry-name"]} ${styles["entry-link"]}`}
                          >
                            {entry.name}
                          </Link>
                        ) : (
                          <span className={styles["entry-name"]}>{entry.name}</span>
                        )}
                        {tooltip && (
                          <span
                            className={styles["entry-tooltip"]}
                            data-tooltip={tooltip}
                          >
                            ⓘ
                          </span>
                        )}
                      </div>
                      <div className={styles["entry-detail"]}>{entry.detail}</div>
                      <EntryCommentary
                        commentary={entry.commentary}
                        evidence={entry.evidence}
                      />
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
