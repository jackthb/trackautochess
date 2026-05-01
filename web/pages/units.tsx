import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllUnits } from "@/lib/units";

interface UnitsPageProps {
  supabase: SupabaseClient | null;
}

const ALL_UNITS: BrowsableEntity[] = getAllUnits().map((unit) => ({
  slug: unit.slug,
  name: unit.name,
  description: `Cost ${unit.cost}${unit.synergies.length ? ` • ${unit.synergies.join(", ")}` : ""}`,
  iconSrc: `/icons/units/${unit.iconStem}.png`,
}));

export default function UnitsPage({ supabase }: UnitsPageProps) {
  const title = `Units | ${SITE_TITLE}`;
  const description =
    "Browse every Dota Auto Chess unit, search heroes by name, and open dedicated unit pages on Track Auto Chess.";

  return (
    <>
      <SeoHead title={title} description={description} path="/units" />
      <EntityBrowser title="Units" variant="unit" data={ALL_UNITS} />
    </>
  );
}
