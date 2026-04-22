import type { GetServerSideProps } from "next";
import patchIndex from "@data/patch_notes/index.json";
import { getAllItems } from "@/lib/items";
import { getAllRelics } from "@/lib/relics";
import { getRequestSiteUrl } from "@/lib/site";

interface IndexPatch {
  date: string;
  slug: string;
}

interface SitemapEntry {
  path: string;
  lastmod?: string;
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
  const urlset = entries
    .map((entry) => {
      const loc = `${siteUrl}${entry.path}`;
      const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : "";
      return `<url><loc>${escapeXml(loc)}</loc>${lastmod}</url>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlset}</urlset>`;
}

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const siteUrl = getRequestSiteUrl(req.headers);
  if (!siteUrl) {
    return { notFound: true };
  }

  const entries: SitemapEntry[] = [
    { path: "/" },
    { path: "/items" },
    { path: "/relics" },
    { path: "/patch-notes" },
    ...getAllItems().map((item) => ({ path: `/items/${item.slug}` })),
    ...getAllRelics().map((relic) => ({ path: `/relics/${relic.slug}` })),
    ...(patchIndex.patches as IndexPatch[]).map((patch) => ({
      path: `/patch-notes/${patch.slug}`,
      lastmod: patch.date,
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
