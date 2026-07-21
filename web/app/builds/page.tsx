import type { Metadata } from "next";
import { AdminGate } from "@/components/app/AdminGate";
import { PageLayout } from "@/components/PageLayout";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllItems } from "@/lib/items";
import { getAllUnits } from "@/lib/units";
import { BuildsPageClient } from "./BuildsPageClient";
import type { BuilderItem, BuilderUnit } from "./BuildPlanner";

// Admin-only — see AdminGate (PostHog `admin_access`). Deliberately no public
// SEO metadata and noindex until this ships to everyone.
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
    <AdminGate>
      <PageLayout title="Builds">
        <BuildsPageClient units={units} items={items} />
      </PageLayout>
    </AdminGate>
  );
}
