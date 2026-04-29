import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import {
  getAllItems,
  iconUrl,
  TIER_COLOR,
  TIER_LABEL,
} from "@/lib/items";
import { SITE_NAME } from "@/lib/site";

interface ItemsPageProps {
  supabase: SupabaseClient | null;
}

function buildTieredItems(): BrowsableEntity[][] {
  const tiers: BrowsableEntity[][] = [[], [], [], [], []];
  for (const item of getAllItems()) {
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
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }
  return tiers;
}

const TIERED_ITEMS = buildTieredItems();

export default function ItemsPage({ supabase }: ItemsPageProps) {
  const title = `Dota Auto Chess Items | ${SITE_NAME}`;
  const description =
    "Browse every Dota Auto Chess item by tier, search specific items like Vanguard, and open dedicated item pages on Track Auto Chess.";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Dota Auto Chess items",
    description,
    about: "Dota Auto Chess items",
  };

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path="/items"
        structuredData={structuredData}
      />
      <EntityBrowser
        title="Items"
        variant="item"
        data={TIERED_ITEMS}
        tierLabel={(tier) => TIER_LABEL[tier]}
        tierColor={(tier) => TIER_COLOR[tier]}
      />
    </>
  );
}
