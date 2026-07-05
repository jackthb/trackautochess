import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllItems } from "@/lib/items";
import { getAllUnits } from "@/lib/units";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { AdminGate } from "@/components/app/AdminGate";
import { BuildPlanner, type BuilderItem, type BuilderUnit } from "./BuildPlanner";

const title = `Builds | ${SITE_TITLE}`;
const description =
  "Plan Dota Auto Chess boards with pieces, items, draft status, and saved build snapshots.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/builds" },
  robots: "noindex, nofollow",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/builds",
    locale: "en_US",
    images: ["/logo.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/logo.svg"],
  },
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
    <PageLayout title="Builds">
      <AdminGate>
        <BuildPlanner units={units} items={items} />
      </AdminGate>
    </PageLayout>
  );
}
