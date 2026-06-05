import type { Metadata } from "next";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllRelics } from "@/lib/relics";

const title = `Relics | ${SITE_TITLE}`;
const description =
  "Browse every Dota Auto Chess relic, search recent additions, and open dedicated relic pages on Track Auto Chess.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/relics" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/relics",
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
  name: "Dota Auto Chess relics",
  description,
  about: "Dota Auto Chess relics",
};

export default function RelicsPage() {
  const data: BrowsableEntity[] = getAllRelics(DEFAULT_LOCALE).map((relic) => ({
    slug: relic.slug,
    name: relic.name,
    description: relic.description,
    lore: relic.lore,
    iconSrc: relic.iconUrl,
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityBrowser
        title="Relics"
        variant="relic"
        data={data}
      />
    </>
  );
}
