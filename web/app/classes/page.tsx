import type { Metadata } from "next";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getClasses } from "@/lib/synergies";

// App Router migration of pages/classes.tsx — the template for the EntityBrowser
// "list" pages. getStaticProps -> direct call in the Server Component (the data
// helpers are sync JSON reads); SeoHead -> generateMetadata + a JSON-LD <script>;
// shared chrome comes from app/layout.tsx. Single (English) locale.

const title = `Classes | ${SITE_TITLE}`;
const description =
  "Browse all Dota Auto Chess class traits like Warrior and Wizard, then open each class detail page.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/classes" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/classes",
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
  name: "Dota Auto Chess classes",
  description,
  about: "Dota Auto Chess class synergies",
};

export default function ClassesPage() {
  const data: BrowsableEntity[] = getClasses(DEFAULT_LOCALE).map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    description: entry.description,
    lore: entry.lore,
    iconSrc: entry.iconUrl,
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityBrowser
        title="Classes"
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
