import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { BetaFeaturesGate } from "@/components/app/BetaFeaturesGate";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllItems } from "@/lib/items";
import { getAllUnits } from "@/lib/units";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { BuildsPageClient } from "./BuildsPageClient";
import type { BuilderItem, BuilderUnit } from "./BuildPlanner";

const title = `Builds | ${SITE_TITLE}`;
const description =
  "Plan Dota Auto Chess boards, submit builds for the public list, and browse community lineups.";

export const metadata: Metadata = {
  title,
  description,
  robots: "noindex, nofollow",
  alternates: { canonical: "/builds" },
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
    <BetaFeaturesGate title="Builds">
      <PageLayout title="Builds">
        <BuildsPageClient units={units} items={items} />
      </PageLayout>
    </BetaFeaturesGate>
  );
}
