import type { GetStaticProps } from "next";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import {
  getAllItems,
  iconUrl,
  TIER_COLOR,
  TIER_LABEL,
} from "@/lib/items";
import { SITE_TITLE } from "@/lib/site";
import { normalizeLocale, type Locale } from "@/lib/i18n";

interface ItemsPageProps {
  locale: Locale;
  data: BrowsableEntity[][];
}

const T = {
  en: {
    title: `Items | ${SITE_TITLE}`,
    description:
      "Browse every Dota Auto Chess item by tier, search specific items like Vanguard, and open dedicated item pages on Track Auto Chess.",
    heading: "Items",
    structuredName: "Dota Auto Chess items",
    structuredAbout: "Dota Auto Chess items",
    tierLabel: TIER_LABEL,
  },
  ru: {
    title: `Предметы | ${SITE_TITLE}`,
    description:
      "Просматривайте все предметы Dota Auto Chess по уровням, ищите конкретные предметы и открывайте отдельные страницы на Track Auto Chess.",
    heading: "Предметы",
    structuredName: "Предметы Dota Auto Chess",
    structuredAbout: "Предметы Dota Auto Chess",
    tierLabel: { 1: "Уровень 1", 2: "Уровень 2", 3: "Уровень 3", 4: "Уровень 4", 5: "Уровень 5" },
  },
} as const;

export default function ItemsPage({ data, locale }: ItemsPageProps) {
  const t = T[locale];
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
        path="/items"
        locale={locale}
        structuredData={structuredData}
      />
      <EntityBrowser
        title={t.heading}
        variant="item"
        data={data}
        tierLabel={(tier) => t.tierLabel[tier as 1 | 2 | 3 | 4 | 5] ?? TIER_LABEL[tier]}
        tierColor={(tier) => TIER_COLOR[tier]}
        sidebarLeft={<BannerAd slot="sidebar-left" />}
        sidebarRight={<BannerAd slot="sidebar" />}
        topAd={<BannerAd slot="in-content" />}
        bottomAd={<BannerAd slot="in-content-2" />}
      />
    </>
  );
}

export const getStaticProps: GetStaticProps<ItemsPageProps> = async ({
  locale: rawLocale,
}) => {
  const locale = normalizeLocale(rawLocale);
  const tiers: BrowsableEntity[][] = [[], [], [], [], []];
  for (const item of getAllItems(locale)) {
    const bucket = tiers[item.tier - 1];
    if (!bucket) continue;
    bucket.push({
      slug: item.slug,
      name: item.name,
      description: item.description,
      iconSrc: iconUrl(item),
    });
  }
  for (const bucket of tiers) {
    bucket.sort((a, b) => a.name.localeCompare(b.name, locale));
  }
  return { props: { locale, data: tiers } };
};
