import type { Metadata } from "next";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { pageMetadata, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getSpecies } from "@/lib/synergies";
import { collectionPage, JsonLd } from "@/lib/structuredData";

const title = `Species | ${SITE_TITLE}`;
const description =
  "Browse all Dota Auto Chess species traits like Beast and Demon, then open each species detail page.";

export const metadata: Metadata = pageMetadata({
  title,
  description,
  path: "/species",
});

const structuredData = collectionPage({
  name: "Dota Auto Chess species",
  description,
  about: "Dota Auto Chess species synergies",
});

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
      <JsonLd data={structuredData} />
      <EntityBrowser
        title="Species"
        variant="synergy"
        searchPlaceholder="Search species..."
        data={data}
      />
    </>
  );
}
