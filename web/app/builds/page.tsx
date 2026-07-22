import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { BetaFeaturesGate } from "@/components/app/BetaFeaturesGate";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllItems } from "@/lib/items";
import { getAllUnits } from "@/lib/units";
import { BuildsPageClient } from "./BuildsPageClient";
import type { BuilderItem, BuilderUnit } from "./BuildPlanner";

// Beta-flagged — see BetaFeaturesGate / website_beta_features. Admins bypass.
export const metadata: Metadata = {
  title: "Builds",
  robots: "noindex, nofollow",
};

export default function BuildsPage() {
  const units: BuilderUnit[] = getAllUnits(DEFAULT_LOCALE).map((unit) => ({
    slug: unit.slug,
    name: unit.name,
    cost: unit.cost,
    synergies: unit.synergies,
    iconUrl: unit.iconUrl,
  }));
  const items: BuilderItem[] = getAllItems(DEFAULT_LOCALE).map((item) => ({
    slug: item.slug,
    name: item.name,
    tier: item.tier,
    iconUrl: item.iconUrl,
  }));

  return (
    <BetaFeaturesGate title="Builds">
      <PageLayout title="Builds">
        <BuildsPageClient units={units} items={items} />
      </PageLayout>
    </BetaFeaturesGate>
  );
}
