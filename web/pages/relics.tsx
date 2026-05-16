import type { GetStaticProps } from "next";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { getAllRelics } from "@/lib/relics";
import { SITE_TITLE } from "@/lib/site";
import { normalizeLocale, type Locale } from "@/lib/i18n";

interface RelicsPageProps {
  locale: Locale;
  data: BrowsableEntity[];
}

const t = {
  title: `Relics | ${SITE_TITLE}`,
  description:
    "Browse every Dota Auto Chess relic, search recent additions, and open dedicated relic pages on Track Auto Chess.",
  heading: "Relics",
  structuredName: "Dota Auto Chess relics",
  structuredAbout: "Dota Auto Chess relics",
};

export default function RelicsPage({ data, locale }: RelicsPageProps) {
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
        path="/relics"
        locale={locale}
        structuredData={structuredData}
      />
      <EntityBrowser
        title={t.heading}
        variant="relic"
        data={data}
        sidebarLeft={<BannerAd slot="sidebar-left" />}
        sidebarRight={<BannerAd slot="sidebar" />}
        topAd={<BannerAd slot="in-content" />}
        bottomAd={<BannerAd slot="in-content-2" />}
      />
    </>
  );
}

export const getStaticProps: GetStaticProps<RelicsPageProps> = async ({
  locale: rawLocale,
}) => {
  const locale = normalizeLocale(rawLocale);
  const data: BrowsableEntity[] = getAllRelics(locale).map((relic) => ({
    slug: relic.slug,
    name: relic.name,
    description: relic.description,
    lore: relic.lore,
    iconSrc: relic.iconUrl,
  }));
  return { props: { locale, data } };
};
