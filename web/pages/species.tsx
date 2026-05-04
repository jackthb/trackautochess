import type { GetStaticProps } from "next";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getSpecies } from "@/lib/synergies";
import { normalizeLocale, type Locale } from "@/lib/i18n";

interface SpeciesPageProps {
  locale: Locale;
  data: BrowsableEntity[];
}

const T = {
  en: {
    title: `Species | ${SITE_TITLE}`,
    description:
      "Browse all Dota Auto Chess species traits like Beast and Demon, then open each species detail page.",
    heading: "Species",
  },
  ru: {
    title: `Расы | ${SITE_TITLE}`,
    description:
      "Все расовые синергии Dota Auto Chess (Звери, Демоны и др.) с подробными страницами.",
    heading: "Расы",
  },
  zh: {
    title: `种族 | ${SITE_TITLE}`,
    description:
      "浏览 Dota 自走棋所有种族羁绊（野兽、恶魔等），并查看每个种族的详情。",
    heading: "种族",
  },
} as const;

export default function SpeciesPage({ data, locale }: SpeciesPageProps) {
  const t = T[locale];
  return (
    <>
      <SeoHead
        title={t.title}
        description={t.description}
        path="/species"
        locale={locale}
      />
      <EntityBrowser
        title={t.heading}
        variant="synergy"
        data={data}
        sidebarLeft={<BannerAd slot="sidebar-left" />}
        sidebarRight={<BannerAd slot="sidebar" />}
        topAd={<BannerAd slot="in-content" />}
        bottomAd={<BannerAd slot="in-content-2" />}
      />
    </>
  );
}

export const getStaticProps: GetStaticProps<SpeciesPageProps> = async ({
  locale: rawLocale,
}) => {
  const locale = normalizeLocale(rawLocale);
  const data: BrowsableEntity[] = getSpecies(locale).map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    lore: s.lore,
    iconSrc: s.iconUrl,
  }));
  return { props: { locale, data } };
};
