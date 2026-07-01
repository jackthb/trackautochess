import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { formatIsoDateParts } from "@dac/shared/game-utils";
import PatchPromo from "@/components/patch/PatchPromo";
import { patchIndexData } from "@/generated/content-data";
import { getLatestPatchPromo, getLatestPatchSlug, getPatchPromo } from "@/lib/latestPatch";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE, pickLocalized } from "@/lib/i18n";
import styles from "./patch-notes.module.css";

interface IndexPatch {
  date: string;
  title: string;
  slug: string;
  titles?: Record<string, string> | null;
}

const title = `Patch Notes | ${SITE_TITLE}`;
const description =
  "Read the latest Dota Auto Chess patch notes, including new relics, new items, balance changes, and update history on Track Auto Chess.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/patch-notes" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/patch-notes",
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

const structuredData = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Dota Auto Chess patch notes",
  description,
  about: "Dota Auto Chess patch notes",
};

export default function PatchNotesPage() {
  const latestSlug = getLatestPatchSlug();
  const featuredPatch = latestSlug ? getPatchPromo(latestSlug) : null;
  const patches = [...((patchIndexData as { patches: IndexPatch[] }).patches)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((patch) => patch.slug !== featuredPatch?.slug);

  let lastYear = "";

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.pageTitle}>Patch Notes</h1>

          {featuredPatch && (
            <PatchPromo
              variant="featured"
              patch={featuredPatch}
              showSyncStatus
            />
          )}

          <div className={styles.timeline}>
            {patches.map((patch) => {
              const { month, day, year } = formatIsoDateParts(patch.date);
              const showYear = year !== lastYear;
              lastYear = year;

              return (
                <Fragment key={patch.slug}>
                  {showYear && (
                    <div className={styles.year}>
                      <div className={styles.yearBadge}>{year}</div>
                    </div>
                  )}
                  <Link
                    href={`/patch-notes/${patch.slug}`}
                    prefetch={false}
                    className={styles.entry}
                  >
                    <div className={styles.date}>
                      <span className={styles.month}>{month}</span>
                      <span className={styles.day}>{day}</span>
                    </div>
                    <span className={styles.title}>
                      {pickLocalized(patch.titles ?? undefined, DEFAULT_LOCALE) ||
                        patch.title}
                    </span>
                    <span className={styles.arrow}>READ &rarr;</span>
                  </Link>
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
