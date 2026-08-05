import type { Metadata } from "next";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { pageMetadata, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { COST_COLOR, COST_LABEL, getUnitsByCost } from "@/lib/units";
import { getAllSynergies, getSynergyNameTranslator } from "@/lib/synergies";
import { slugifyName } from "@/lib/slugs";
import { collectionPage, JsonLd } from "@/lib/structuredData";

const title = `Units | ${SITE_TITLE}`;
const description =
  "Browse every Dota Auto Chess unit by cost tier, search heroes by name, and open dedicated unit pages on Track Auto Chess.";

export const metadata: Metadata = pageMetadata({
  title,
  description,
  path: "/units",
});

const structuredData = collectionPage({
  name: "Dota Auto Chess units",
  description,
  about: "Dota Auto Chess units",
});

const cost = (c: number) => `Cost ${c}`;

export default function UnitsPage() {
  const translateSyn = getSynergyNameTranslator(DEFAULT_LOCALE);
  const synBySlug = new Map(
    getAllSynergies(DEFAULT_LOCALE).map((s) => [s.slug, s]),
  );

  const data: BrowsableEntity[][] = getUnitsByCost(DEFAULT_LOCALE).map((tier) =>
    tier.map((unit) => ({
      slug: unit.slug,
      name: unit.name,
      description: unit.synergies.length
        ? `${unit.synergies.map(translateSyn).join(", ")} • ${cost(unit.cost)}`
        : cost(unit.cost),
      iconSrc: unit.iconUrl,
      filterTags: unit.synergies.flatMap((synName) => {
        const slug = slugifyName(synName);
        const syn = synBySlug.get(slug);
        if (!syn) return [];
        return [{ slug, label: syn.name, iconSrc: syn.iconUrl }];
      }),
    })),
  );

  return (
    <>
      <JsonLd data={structuredData} />
      <EntityBrowser
        title="Units"
        variant="unit"
        data={data}
        tierLabel={COST_LABEL}
        tierColor={COST_COLOR}
      />
    </>
  );
}
