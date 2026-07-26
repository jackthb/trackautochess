import type { Metadata } from "next";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { pageMetadata, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getClasses } from "@/lib/synergies";

const title = `Classes | ${SITE_TITLE}`;
const description =
  "Browse all Dota Auto Chess class traits like Warrior and Wizard, then open each class detail page.";

export const metadata: Metadata = pageMetadata({
  title,
  description,
  path: "/classes",
});

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
        searchPlaceholder="Search classes..."
        data={data}
      />
    </>
  );
}
