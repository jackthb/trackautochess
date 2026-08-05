import type { Metadata } from "next";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { pageMetadata, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllItems, iconUrl, TIER_COLOR, TIER_LABEL } from "@/lib/items";
import { collectionPage, JsonLd } from "@/lib/structuredData";

const title = `Items | ${SITE_TITLE}`;
const description =
  "Browse every Dota Auto Chess item by tier, search specific items like Vanguard, and open dedicated item pages on Track Auto Chess.";

export const metadata: Metadata = pageMetadata({
  title,
  description,
  path: "/items",
});

const structuredData = collectionPage({
  name: "Dota Auto Chess items",
  description,
  about: "Dota Auto Chess items",
});

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
      <JsonLd data={structuredData} />
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
