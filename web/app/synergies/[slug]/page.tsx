import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SynergyDescription } from "@/components/SynergyDescription";
import { EntityCommentaryList } from "@/components/PatchCommentary";
import { Markdown } from "@/components/Markdown";
import {
  getAllSynergies,
  getSynergyBySlug,
  getSynergyNameTranslator,
} from "@/lib/synergies";
import { getAllUnits } from "@/lib/units";
import { TIER_COLOR, TIER_LABEL, iconUrl } from "@/lib/items";
import { getRelatedItemsForSynergy } from "@/lib/itemRelations";
import { absoluteUrl, pageMetadata, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getCommentaryForEntity } from "@/lib/patchCommentary";

// Static detail page backed by committed JSON generated from content/.

const t = {
  title: (n: string) => `${n} Synergy Guide | ${SITE_TITLE}`,
  description: (n: string) => `See what ${n} does in Dota Auto Chess.`,
  species: "Species",
  classes: "Classes",
  cost: (c: number) => `Cost ${c}`,
  nUnits: (n: string) => `${n} Units`,
  moreSynergies: "More Synergies",
  relatedItems: (n: string) => `${n} Items`,
};

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllSynergies().map((synergy) => ({ slug: synergy.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const synergy = getSynergyBySlug(slug, DEFAULT_LOCALE);
  if (!synergy) return {};
  const title = t.title(synergy.name);
  const description = t.description(synergy.name);
  return pageMetadata({
    title,
    description,
    path: `/synergies/${synergy.slug}`,
    type: "article",
  });
}

export default async function SynergyDetailPage({ params }: Props) {
  const { slug } = await params;

  const allSynergies = getAllSynergies(DEFAULT_LOCALE);
  const synergy = getSynergyBySlug(slug, DEFAULT_LOCALE);
  if (!synergy) notFound();

  // Units' `synergies` array stores English-canonical names. Resolve the
  // English name for the current synergy via slug, then filter units (so
  // unit display names are correct).
  const englishName =
    getAllSynergies(DEFAULT_LOCALE).find((s) => s.slug === synergy.slug)?.name ??
    synergy.name;
  const localizedUnits = getAllUnits(DEFAULT_LOCALE);
  const matchingUnits = localizedUnits.filter((u) =>
    u.synergies.includes(englishName),
  );

  const relatedItems = getRelatedItemsForSynergy(englishName, DEFAULT_LOCALE);

  const related = allSynergies
    .filter(
      (candidate) =>
        candidate.slug !== synergy.slug && candidate.category === synergy.category
    )
    .slice(0, 8);

  const commentary = getCommentaryForEntity("synergy", slug);
  const commentaryContent =
    synergy.commentary || commentary.length > 0 ? (
      <>
        {synergy.commentary && <Markdown>{synergy.commentary}</Markdown>}
        {commentary.length > 0 && (
          <EntityCommentaryList entries={commentary} />
        )}
      </>
    ) : undefined;

  const description = t.description(synergy.name);
  const translateSyn = getSynergyNameTranslator(DEFAULT_LOCALE);
  const itemEntities: RelatedEntity[] = relatedItems.map(({ item, relation }) => ({
    slug: item.slug,
    name: item.name,
    description: `${relation.label} • ${relation.description}`,
    iconSrc: iconUrl(item),
    variant: "item",
    level: TIER_LABEL[item.tier],
    accentColor: TIER_COLOR[item.tier],
  }));

  const moreSynergies: RelatedEntity[] = related.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    iconSrc: s.iconUrl,
  }));
  const unitsForSynergy: RelatedEntity[] = matchingUnits.map((unit) => ({
    slug: unit.slug,
    name: unit.name,
    description: `${t.cost(unit.cost)} • ${unit.synergies.map(translateSyn).join(", ")}`,
    iconSrc: unit.iconUrl,
    variant: "unit",
  }));

  const indexLabel = synergy.category === "species" ? t.species : t.classes;
  const indexPath = synergy.category === "species" ? "/species" : "/classes";
  const pageUrl = absoluteUrl(`/synergies/${synergy.slug}`);
  const indexUrl = absoluteUrl(indexPath);
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${synergy.name} synergy guide`,
      description,
      ...(pageUrl ? { url: pageUrl } : {}),
      about: { "@type": "Thing", name: synergy.name },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: indexLabel,
          ...(indexUrl ? { item: indexUrl } : {}),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: synergy.name,
          ...(pageUrl ? { item: pageUrl } : {}),
        },
      ],
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityDetail
        variant="synergy"
        name={synergy.name}
        iconSrc={synergy.iconUrl}
        overview={<SynergyDescription description={synergy.description || description} />}
        notes={synergy.notes.length > 0 ? synergy.notes : undefined}
        commentary={commentaryContent}
        lore={synergy.lore || undefined}
        indexLabel={indexLabel}
        indexPath={indexPath}
        relatedTitle={t.nUnits(synergy.name)}
        related={unitsForSynergy}
        extraRelatedTitle={itemEntities.length > 0 ? t.relatedItems(synergy.name) : t.moreSynergies}
        extraRelated={itemEntities.length > 0 ? itemEntities : moreSynergies}
      />
    </>
  );
}
