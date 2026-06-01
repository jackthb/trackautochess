import type { MetadataRoute } from "next";
import { getSiteUrl, DEFAULT_SITE_URL } from "@/lib/site";

// App Router robots (replaces pages/robots.txt.ts) — serves /robots.txt.
export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl() ?? DEFAULT_SITE_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/*?refresh=1"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
