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

const T = {
  en: {
    title: `Units | ${SITE_TITLE}`,
    description:
      "Browse every Dota Auto Chess unit by cost tier, search heroes by name, and open dedicated unit pages on Track Auto Chess.",
    heading: "Units",
    cost: (c: number) => `Cost ${c}`,
    costLabel: COST_LABEL,
  },
  ru: {
    title: `Фигуры | ${SITE_TITLE}`,
    description:
      "Просматривайте все фигуры Dota Auto Chess по стоимости, ищите героев по имени и открывайте отдельные страницы на Track Auto Chess.",
    heading: "Фигуры",
    cost: (c: number) => `Цена ${c}`,
    costLabel: { 1: "Цена 1", 2: "Цена 2", 3: "Цена 3", 4: "Цена 4", 5: "Цена 5" },
  },
  zh: {
    title: `棋子 | ${SITE_TITLE}`,
    description:
      "按费用浏览所有 Dota 自走棋棋子，按名称搜索英雄，在 Track Auto Chess 查看每个棋子的详情。",
    heading: "棋子",
    cost: (c: number) => `${c} 费`,
    costLabel: { 1: "1 费", 2: "2 费", 3: "3 费", 4: "4 费", 5: "5 费" },
  },
} as const;

export default function UnitsPage({ data, locale }: UnitsPageProps) {
  const t = T[locale];
  return (
    <>
      <SeoHead
        title={t.title}
        description={t.description}
        path="/units"
        locale={locale}
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
  const t = T[locale];
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
