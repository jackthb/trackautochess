import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { EntityCommentaryList } from "@/components/PatchCommentary";
import { UnitAbilities } from "@/components/UnitAbilities";
import { UnitStatsTable } from "@/components/UnitStatsTable";
import { getAllUnits, getUnitBySlug } from "@/lib/units";
import { getAllSynergies } from "@/lib/synergies";
import { slugifyName } from "@/lib/slugs";
import { absoluteUrl, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getCommentaryForEntity } from "@/lib/patchCommentary";

// Static detail page backed by committed JSON generated from content/.

const t = {
  title: (n: string) => `${n} Unit Guide | ${SITE_TITLE}`,
  description: (n: string, c: number) =>
    `${n} is a cost ${c} unit in Dota Auto Chess.`,
  cost: (c: number) => `Cost ${c}`,
  crumbUnits: "Units",
  overview: "Overview",
  commentary: "Commentary",
  abilities: "Abilities",
  stats: "Stats",
  attackType: (type: string) => `${type.charAt(0).toUpperCase()}${type.slice(1)} attack`,
};

const RELATED_LABELS = {
  unitSynergies: (n: string) => `${n} Synergies`,
  moreUnits: "More Units",
};

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllUnits().map((unit) => ({ slug: unit.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const unit = getUnitBySlug(slug, DEFAULT_LOCALE);
  if (!unit) return {};
  const title = t.title(unit.name);
  const description = t.description(unit.name, unit.cost);
  return {
    title,
    description,
    alternates: { canonical: `/units/${unit.slug}` },
    robots: "index, follow, max-image-preview:large",
    openGraph: {
      title,
      description,
      type: "article",
      siteName: SITE_NAME,
      url: `/units/${unit.slug}`,
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
}

export default async function UnitDetailPage({ params }: Props) {
  const { slug } = await params;

  const allUnits = getAllUnits(DEFAULT_LOCALE);
  const unit = getUnitBySlug(slug, DEFAULT_LOCALE);
  if (!unit) notFound();

  const related = allUnits
    .filter(
      (candidate) =>
        candidate.cost === unit.cost && candidate.slug !== unit.slug,
    )
    .slice(0, 8);

  const synergies = getAllSynergies(DEFAULT_LOCALE);

  const commentary = getCommentaryForEntity("unit", slug);

  const description = t.description(unit.name, unit.cost);
  // synergies are localized; the unit's `synergies` field stores English
  // names so we look up by slug derived from the English form.
  const synergyByEnglishSlug = new Map(synergies.map((syn) => [syn.slug, syn]));
  const relatedEntities: RelatedEntity[] = related.map((u) => ({
    slug: u.slug,
    name: u.name,
    description: t.cost(u.cost),
    iconSrc: u.iconUrl,
  }));
  const synergyEntities: RelatedEntity[] = unit.synergies.map((engName) => {
    const slug = slugifyName(engName);
    const matched = synergyByEnglishSlug.get(slug);
    return {
      slug,
      name: matched?.name ?? engName,
      description: matched?.description,
      iconSrc:
        matched?.iconUrl ?? `/icons/synergies/${matched?.iconStem ?? ""}.png`,
      variant: "synergy",
    };
  });

  const bodySections = [
    {
      title: t.overview,
      body: unit.attackType ? t.attackType(unit.attackType) : description,
    },
    // Generic editorial commentary authored in the CMS, distinct from the
    // patch-note commentary rendered in the commentary slot below.
    ...(unit.commentary
      ? [
          {
            title: t.commentary,
            body: (
              <p style={{ whiteSpace: "pre-line", margin: 0 }}>{unit.commentary}</p>
            ),
          },
        ]
      : []),
    ...(unit.abilities.length > 0
      ? [
          {
            title: t.abilities,
            body: <UnitAbilities abilities={unit.abilities} />,
          },
        ]
      : []),
    ...(unit.stats ? [{ title: t.stats, body: <UnitStatsTable stats={unit.stats} /> }] : []),
  ];

  const pageUrl = absoluteUrl(`/units/${unit.slug}`);
  const unitsUrl = absoluteUrl("/units");
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${unit.name} unit guide`,
      description,
      ...(pageUrl ? { url: pageUrl } : {}),
      about: { "@type": "Thing", name: unit.name },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: t.crumbUnits,
          ...(unitsUrl ? { item: unitsUrl } : {}),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: unit.name,
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
        variant="unit"
        name={unit.name}
        iconSrc={unit.iconUrl}
        tag={{ label: t.cost(unit.cost) }}
        bodySections={bodySections}
        commentary={
          commentary.length > 0 ? (
            <EntityCommentaryList entries={commentary} />
          ) : undefined
        }
        relatedTitle={RELATED_LABELS.unitSynergies(unit.name)}
        related={synergyEntities}
        extraRelatedTitle={RELATED_LABELS.moreUnits}
        extraRelated={relatedEntities}
      />
    </>
  );
}
