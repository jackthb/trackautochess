import type { GetServerSideProps } from "next";
import patchIndex from "@data/patch_notes/index.json";
import { getAllItems } from "@/lib/items";
import { getAllRelics } from "@/lib/relics";
import { getAllUnits } from "@/lib/units";
import { getAllSynergies } from "@/lib/synergies";
import { getRequestSiteUrl, getSiteUrl } from "@/lib/site";

interface IndexPatch {
  date: string;
  slug: string;
}

/** Locale-agnostic path. Patch notes opt out of i18n. */
interface SitemapEntry {
  path: string;
  lastmod?: string;
  /** When false, only the unprefixed URL is emitted (no hreflang alts). */
  localized?: boolean;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSitemap(siteUrl: string, entries: SitemapEntry[]): string {
  // Single (English) locale since i18n routing was removed — one <url> per
  // entry, no hreflang alternates.
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod
      ? `<lastmod>${entry.lastmod}</lastmod>`
      : "";
    return `<url><loc>${escapeXml(`${siteUrl}${entry.path}`)}</loc>${lastmod}</url>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`
  );
}

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const siteUrl = getSiteUrl() ?? getRequestSiteUrl(req.headers);
  if (!siteUrl) {
    return { notFound: true };
  }

  const entries: SitemapEntry[] = [
    { path: "/" },
    { path: "/items" },
    { path: "/units" },
    { path: "/synergies" },
    { path: "/classes" },
    { path: "/species" },
    { path: "/relics" },
    { path: "/talents" },
    { path: "/ranks" },
    // English-only static / app pages — emit a single unprefixed URL.
    { path: "/about", localized: false },
    { path: "/privacy", localized: false },
    { path: "/patch-notes", localized: false },
    ...getAllItems().map((item) => ({ path: `/items/${item.slug}` })),
    ...getAllUnits().map((unit) => ({ path: `/units/${unit.slug}` })),
    ...getAllSynergies().map((synergy) => ({
      path: `/synergies/${synergy.slug}`,
    })),
    ...getAllRelics().map((relic) => ({ path: `/relics/${relic.slug}` })),
    ...(patchIndex.patches as IndexPatch[]).map((patch) => ({
      path: `/patch-notes/${patch.slug}`,
      lastmod: patch.date,
      localized: false as const,
    })),
  ];

  res.setHeader("Content-Type", "text/xml");
  res.write(renderSitemap(siteUrl, entries));
  res.end();

  return { props: {} };
};

export default function Sitemap() {
  return null;
}
