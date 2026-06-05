import type { MetadataRoute } from "next";
import { patchIndexData } from "@/generated/content-data";
import { getAllItems } from "@/lib/items";
import { getAllRelics } from "@/lib/relics";
import { getAllUnits } from "@/lib/units";
import { getAllSynergies } from "@/lib/synergies";
import { getSiteUrl, DEFAULT_SITE_URL } from "@/lib/site";

// App Router sitemap (replaces pages/sitemap.xml.ts) — serves /sitemap.xml.
// Single (English) locale. /synergies is omitted (it 308-redirects to /classes).

interface IndexPatch {
  date: string;
  slug: string;
}

const STATIC_PATHS = [
  "/",
  "/items",
  "/units",
  "/classes",
  "/species",
  "/relics",
  "/talents",
  "/ranks",
  "/queens",
  "/about",
  "/privacy",
  "/patch-notes",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl() ?? DEFAULT_SITE_URL;
  return [
    ...STATIC_PATHS.map((p) => ({ url: `${base}${p}` })),
    ...getAllItems().map((i) => ({ url: `${base}/items/${i.slug}` })),
    ...getAllUnits().map((u) => ({ url: `${base}/units/${u.slug}` })),
    ...getAllSynergies().map((s) => ({ url: `${base}/synergies/${s.slug}` })),
    ...getAllRelics().map((r) => ({ url: `${base}/relics/${r.slug}` })),
    ...((patchIndexData as { patches: IndexPatch[] }).patches).map((p) => ({
      url: `${base}/patch-notes/${p.slug}`,
      lastModified: p.date,
    })),
  ];
}
