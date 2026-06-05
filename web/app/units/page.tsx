import type { Metadata } from "next";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { COST_COLOR, COST_LABEL, getUnitsByCost } from "@/lib/units";
import { getSynergyNameTranslator } from "@/lib/synergies";

const title = `Units | ${SITE_TITLE}`;
const description =
  "Browse every Dota Auto Chess unit by cost tier, search heroes by name, and open dedicated unit pages on Track Auto Chess.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/units" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/units",
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

const structuredData = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Dota Auto Chess units",
  description,
  about: "Dota Auto Chess units",
};

const cost = (c: number) => `Cost ${c}`;

export default function UnitsPage() {
  const translateSyn = getSynergyNameTranslator(DEFAULT_LOCALE);
  const data: BrowsableEntity[][] = getUnitsByCost(DEFAULT_LOCALE).map((tier) =>
    tier.map((unit) => ({
      slug: unit.slug,
      name: unit.name,
      description: unit.synergies.length
        ? `${unit.synergies.map(translateSyn).join(", ")} • ${cost(unit.cost)}`
        : cost(unit.cost),
      iconSrc: unit.iconUrl,
    })),
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityBrowser
        title="Units"
        variant="unit"
        data={data}
        tierLabel={COST_LABEL}
        tierColor={COST_COLOR}
      />
    </>
  );
}
