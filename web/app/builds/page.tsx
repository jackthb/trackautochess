import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminGate } from "@/components/app/AdminGate";
import { PageLayout } from "@/components/PageLayout";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllItems } from "@/lib/items";
import { getAllUnits } from "@/lib/units";
import { BuildsPageClient } from "./BuildsPageClient";
import type { BuilderItem, BuilderUnit } from "./BuildPlanner";

export const metadata: Metadata = {
  title: "Builds",
  robots: "noindex, nofollow",
};

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function BuildsPage({ searchParams }: PageProps) {
  const { tab } = await searchParams;
  const initialTab = tab === "public" ? "public" : "planner";
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
    <AdminGate title="Builds">
      <PageLayout title="Builds">
        <Suspense fallback={<div style={{ padding: "24px 0", opacity: 0.7 }}>Loading…</div>}>
          <BuildsPageClient units={units} items={items} initialTab={initialTab} />
        </Suspense>
      </PageLayout>
    </AdminGate>
  );
}
