import type { GetStaticProps } from "next";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { COST_COLOR, COST_LABEL, getUnitsByCost } from "@/lib/units";
import {
  getSynergyNameTranslator,
} from "@/lib/synergies";
import { normalizeLocale, type Locale } from "@/lib/i18n";

interface UnitsPageProps {
  locale: Locale;
  data: BrowsableEntity[][];
}

// UI chrome strings stay English across locales for now. Entity names
// (units, items, synergies, relics, talents) ARE localized via Sanity →
// data/*.json and rendered through pickLocalized.
const t = {
  title: `Units | ${SITE_TITLE}`,
  description:
    "Browse every Dota Auto Chess unit by cost tier, search heroes by name, and open dedicated unit pages on Track Auto Chess.",
  heading: "Units",
  cost: (c: number) => `Cost ${c}`,
  costLabel: COST_LABEL,
  structuredName: "Dota Auto Chess units",
  structuredAbout: "Dota Auto Chess units",
};

export default function UnitsPage({ data, locale }: UnitsPageProps) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t.structuredName,
    description: t.description,
    about: t.structuredAbout,
  };
  return (
    <>
      <SeoHead
        title={t.title}
        description={t.description}
        path="/units"
        locale={locale}
        structuredData={structuredData}
      />
      <EntityBrowser
        title={t.heading}
        variant="unit"
        data={data}
        tierLabel={(tier) => t.costLabel[tier as 1 | 2 | 3 | 4 | 5] ?? COST_LABEL[tier]}
        tierColor={(tier) => COST_COLOR[tier]}
        sidebarLeft={<BannerAd slot="sidebar-left" />}
        sidebarRight={<BannerAd slot="sidebar" />}
        topAd={<BannerAd slot="in-content" />}
        bottomAd={<BannerAd slot="in-content-2" />}
      />
    </>
  );
}

export const getStaticProps: GetStaticProps<UnitsPageProps> = async ({
  locale: rawLocale,
}) => {
  const locale = normalizeLocale(rawLocale);
  const translateSyn = getSynergyNameTranslator(locale);
  const data: BrowsableEntity[][] = getUnitsByCost(locale).map((tier) =>
    tier.map((unit) => ({
      slug: unit.slug,
      name: unit.name,
      description: unit.synergies.length
        ? `${unit.synergies.map(translateSyn).join(", ")} • ${t.cost(unit.cost)}`
        : t.cost(unit.cost),
      iconSrc: unit.iconUrl,
    })),
  );
  return { props: { locale, data } };
};
