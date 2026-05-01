import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { COST_COLOR, COST_LABEL, getUnitsByCost } from "@/lib/units";

interface UnitsPageProps {
  supabase: SupabaseClient | null;
}

const TIERED_UNITS: BrowsableEntity[][] = getUnitsByCost().map((tier) =>
  tier.map((unit) => ({
    slug: unit.slug,
    name: unit.name,
    description: unit.synergies.length
      ? `${unit.synergies.join(", ")} • Cost ${unit.cost}`
      : `Cost ${unit.cost}`,
    iconSrc: `/icons/units/${unit.iconStem}.png`,
  }))
);

export default function UnitsPage({ supabase }: UnitsPageProps) {
  const title = `Units | ${SITE_TITLE}`;
  const description =
    "Browse every Dota Auto Chess unit by cost tier, search heroes by name, and open dedicated unit pages on Track Auto Chess.";

  return (
    <>
      <SeoHead title={title} description={description} path="/units" />
      <EntityBrowser
        title="Units"
        variant="unit"
        data={TIERED_UNITS}
        tierLabel={(tier) => COST_LABEL[tier]}
        tierColor={(tier) => COST_COLOR[tier]}
      />
    </>
  );
}
