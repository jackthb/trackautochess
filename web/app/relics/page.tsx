import type { Metadata } from "next";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { pageMetadata, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllRelics } from "@/lib/relics";
import { collectionPage, JsonLd } from "@/lib/structuredData";

const title = `Relics | ${SITE_TITLE}`;
const description =
  "Browse every Dota Auto Chess relic, search recent additions, and open dedicated relic pages on Track Auto Chess.";

export const metadata: Metadata = pageMetadata({
  title,
  description,
  path: "/relics",
});

const structuredData = collectionPage({
  name: "Dota Auto Chess relics",
  description,
  about: "Dota Auto Chess relics",
});

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
      <JsonLd data={structuredData} />
      <EntityBrowser
        title="Relics"
        variant="relic"
        data={data}
      />
    </>
  );
}
