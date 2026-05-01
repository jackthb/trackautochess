import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllSynergies } from "@/lib/synergies";

interface SynergiesPageProps {
  supabase: SupabaseClient | null;
}

const ALL_SYNERGIES: BrowsableEntity[] = getAllSynergies().map((synergy) => ({
  slug: synergy.slug,
  name: synergy.name,
  description: synergy.description,
  lore: synergy.lore,
  iconSrc: `/icons/synergies/${synergy.iconStem}.png`,
}));

export default function SynergiesPage({ supabase }: SynergiesPageProps) {
  const title = `Synergies | ${SITE_TITLE}`;
  const description =
    "Browse every Dota Auto Chess synergy, search classes and races, and open dedicated synergy pages on Track Auto Chess.";

  return (
    <>
      <SeoHead title={title} description={description} path="/synergies" />
      <EntityBrowser title="Synergies" variant="synergy" data={ALL_SYNERGIES} />
    </>
  );
}
