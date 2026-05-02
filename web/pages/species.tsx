import type { SupabaseClient } from "@supabase/supabase-js";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getSpecies } from "@/lib/synergies";

interface SpeciesPageProps {
  supabase: SupabaseClient | null;
}

const ALL_SPECIES: BrowsableEntity[] = getSpecies().map((species) => ({
  slug: species.slug,
  name: species.name,
  description: species.description,
  lore: species.lore,
  iconSrc: `/icons/synergies/${species.iconStem}.png`,
}));

export default function SpeciesPage({ supabase }: SpeciesPageProps) {
  const title = `Species | ${SITE_TITLE}`;
  const description =
    "Browse all Dota Auto Chess species traits like Beast and Demon, then open each species detail page.";

  return (
    <>
      <SeoHead title={title} description={description} path="/species" />
      <EntityBrowser
        title="Species"
        variant="synergy"
        data={ALL_SPECIES}
        sidebar={<BannerAd slot="sidebar" />}
      />
    </>
  );
}
