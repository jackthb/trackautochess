import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import type { SupabaseClient } from "@supabase/supabase-js";
import patchIndex from "@data/patch_notes/index.json";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { normalizeLocale, pickLocalized } from "@/lib/i18n";
import styles from "./patch-notes.module.css";

interface IndexPatch {
  date: string;
  title: string;
  slug: string;
  titles?: Record<string, string> | null;
}

interface PatchNotesPageProps {
  supabase: SupabaseClient | null;
}

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function formatDate(iso: string): { month: string; day: string; year: string } {
  // Parse YYYY-MM-DD without timezone drift.
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  return {
    month: MONTHS[(m || 1) - 1] ?? "",
    day: String(d || 1).padStart(2, "0"),
    year: String(y || ""),
  };
}

export default function PatchNotesPage({ supabase }: PatchNotesPageProps) {
  void supabase;
  const router = useRouter();
  const locale = normalizeLocale(router.locale ?? router.defaultLocale ?? undefined);
  const patches = [...(patchIndex.patches as IndexPatch[])].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  const title = `Patch Notes | ${SITE_TITLE}`;
  const description =
    "Read the latest Dota Auto Chess patch notes, including new relics, new items, balance changes, and update history on Track Auto Chess.";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Dota Auto Chess patch notes",
    description,
    about: "Dota Auto Chess patch notes",
  };

  let lastYear = "";

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path="/patch-notes"
        locale={locale}
        structuredData={structuredData}
      />

      <div className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.pageTitle}>Patch Notes</h1>

          <div className={styles.timeline}>
            {patches.map((patch) => {
              const { month, day, year } = formatDate(patch.date);
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
                    className={styles.entry}
                  >
                    <div className={styles.date}>
                      <span className={styles.month}>{month}</span>
                      <span className={styles.day}>{day}</span>
                    </div>
                    <span className={styles.title}>
                      {pickLocalized(patch.titles ?? undefined, locale) || patch.title}
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
