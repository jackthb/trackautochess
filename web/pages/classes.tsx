import type { GetStaticProps } from "next";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getClasses } from "@/lib/synergies";
import { normalizeLocale, type Locale } from "@/lib/i18n";

interface ClassesPageProps {
  locale: Locale;
  data: BrowsableEntity[];
}

const t = {
  title: `Classes | ${SITE_TITLE}`,
  description:
    "Browse all Dota Auto Chess class traits like Warrior and Wizard, then open each class detail page.",
  heading: "Classes",
  structuredName: "Dota Auto Chess classes",
  structuredAbout: "Dota Auto Chess class synergies",
};

export default function ClassesPage({ data, locale }: ClassesPageProps) {
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
        path="/classes"
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

export const getStaticProps: GetStaticProps<ClassesPageProps> = async ({
  locale: rawLocale,
}) => {
  const locale = normalizeLocale(rawLocale);
  const data: BrowsableEntity[] = getClasses(locale).map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    description: entry.description,
    lore: entry.lore,
    iconSrc: entry.iconUrl,
  }));
  return { props: { locale, data } };
};
