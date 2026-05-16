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

const t = {
  title: `Species | ${SITE_TITLE}`,
  description:
    "Browse all Dota Auto Chess species traits like Beast and Demon, then open each species detail page.",
  heading: "Species",
  structuredName: "Dota Auto Chess species",
  structuredAbout: "Dota Auto Chess species synergies",
};

export default function SpeciesPage({ data, locale }: SpeciesPageProps) {
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
        path="/species"
        locale={locale}
        structuredData={structuredData}
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
