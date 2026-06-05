import type { Metadata } from "next";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllItems, iconUrl, TIER_COLOR, TIER_LABEL } from "@/lib/items";

const title = `Items | ${SITE_TITLE}`;
const description =
  "Browse every Dota Auto Chess item by tier, search specific items like Vanguard, and open dedicated item pages on Track Auto Chess.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/items" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/items",
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
  name: "Dota Auto Chess items",
  description,
  about: "Dota Auto Chess items",
};

export default function ItemsPage() {
  const tiers: BrowsableEntity[][] = [[], [], [], [], []];
  for (const item of getAllItems(DEFAULT_LOCALE)) {
    const bucket = tiers[item.tier - 1];
    if (!bucket) continue;
    bucket.push({
      slug: item.slug,
      name: item.name,
      description: item.description,
      iconSrc: iconUrl(item),
    });
  }
  for (const bucket of tiers) {
    bucket.sort((a, b) => a.name.localeCompare(b.name, DEFAULT_LOCALE));
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityBrowser
        title="Items"
        variant="item"
        data={tiers}
        tierLabel={TIER_LABEL}
        tierColor={TIER_COLOR}
        tierNav
      />
    </>
  );
}
