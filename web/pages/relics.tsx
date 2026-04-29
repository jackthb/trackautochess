import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { getAllRelics } from "@/lib/relics";
import { SITE_NAME } from "@/lib/site";

interface RelicsPageProps {
  supabase: SupabaseClient | null;
}

const ALL_RELICS: BrowsableEntity[] = getAllRelics().map((relic) => ({
  slug: relic.slug,
  name: relic.name,
  description: relic.description,
  lore: relic.lore,
  iconSrc: `/icons/relics/${relic.iconStem}.png`,
}));

export default function RelicsPage({ supabase }: RelicsPageProps) {
  const title = `Dota Auto Chess Relics | ${SITE_NAME}`;
  const description =
    "Browse every Dota Auto Chess relic, search recent additions, and open dedicated relic pages on Track Auto Chess.";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Dota Auto Chess relics",
    description,
    about: "Dota Auto Chess relics",
  };

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path="/relics"
        structuredData={structuredData}
      />
      <EntityBrowser title="Relics" variant="relic" data={ALL_RELICS} />
    </>
  );
}
