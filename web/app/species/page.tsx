import type { Metadata } from "next";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getSpecies } from "@/lib/synergies";

// App Router migration of pages/species.tsx — mirrors app/classes/page.tsx, the
// template for the EntityBrowser "list" pages. getStaticProps -> direct call in
// the Server Component (the data helpers are sync JSON reads); SeoHead ->
// static metadata + a JSON-LD <script>; shared chrome comes from app/layout.tsx.
// Single (English) locale.

const title = `Species | ${SITE_TITLE}`;
const description =
  "Browse all Dota Auto Chess species traits like Beast and Demon, then open each species detail page.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/species" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/species",
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
  name: "Dota Auto Chess species",
  description,
  about: "Dota Auto Chess species synergies",
};

export default function SpeciesPage() {
  const data: BrowsableEntity[] = getSpecies(DEFAULT_LOCALE).map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    lore: s.lore,
    iconSrc: s.iconUrl,
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityBrowser
        title="Species"
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
