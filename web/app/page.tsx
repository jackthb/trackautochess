import type { Metadata } from "next";
import HomeSearch from "@/components/home/HomeSearch";
import PatchPromo from "@/components/patch/PatchPromo";
import { fetchDotaAutoChessMetrics } from "@/lib/customGameStats";
import { fetchFeaturedMatch } from "@/lib/featuredMatch";
import {
  absoluteUrl,
  pageMetadata,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
} from "@/lib/site";

export const revalidate = 300;

const description =
  "Look up any Dota Auto Chess player's rank by Steam vanity URL or SteamID64. Drodo stopped publishing MMR stats, so profiles show rank only.";

export const metadata: Metadata = pageMetadata({
  title: SITE_TITLE,
  description,
  path: "/",
});

const siteUrl = absoluteUrl("/");
const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    ...(siteUrl ? { url: siteUrl } : {}),
    ...(siteUrl
      ? {
          potentialAction: {
            "@type": "SearchAction",
            target: `${siteUrl}/players/{search_term_string}`,
            "query-input": "required name=search_term_string",
          },
        }
      : {}),
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
    description: SITE_DESCRIPTION,
    ...(siteUrl ? { url: siteUrl } : {}),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
];

export default async function HomePage() {
  const [metrics, featuredMatch] = await Promise.all([
    fetchDotaAutoChessMetrics(),
    fetchFeaturedMatch(),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeSearch metrics={metrics} featuredMatch={featuredMatch}>
        <PatchPromo variant="compact" />
      </HomeSearch>
    </>
  );
}
