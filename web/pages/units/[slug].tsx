import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import { absoluteUrl, SITE_TITLE } from "@/lib/site";
import { getAllUnits, getUnitBySlug, type DisplayUnit } from "@/lib/units";
import {
  getAllSynergies,
  type DisplaySynergy,
} from "@/lib/synergies";
import { slugifyName } from "@/lib/slugs";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import {
  loadDraftUnits,
  loadDraftSynergies,
} from "@/lib/sanity/draftLoaders";
import { getCommentaryForEntity } from "@/lib/patchCommentary";
import type { EntityCommentary } from "@/lib/patchCommentaryTypes";
import { EntityCommentaryList } from "@/components/PatchCommentary";

interface UnitDetailPageProps {
  unit: DisplayUnit;
  related: DisplayUnit[];
  synergies: DisplaySynergy[];
  commentary: EntityCommentary[];
  locale: Locale;
  draftMode: boolean;
  supabase: SupabaseClient | null;
}

const t = {
  title: (n: string) => `${n} Unit Guide | ${SITE_TITLE}`,
  description: (n: string, c: number) =>
    `${n} is a cost ${c} unit in Dota Auto Chess.`,
  cost: (c: number) => `Cost ${c}`,
  crumbUnits: "Units",
};

const RELATED_LABELS = {
  unitSynergies: (n: string) => `${n} Synergies`,
  moreUnits: "More Units",
};

export default function UnitDetailPage({
  unit,
  related,
  synergies,
  commentary,
  locale,
}: UnitDetailPageProps) {
  const description = t.description(unit.name, unit.cost);
  // synergies are localized; the unit's `synergies` field stores English
  // names so we look up by slug derived from the English form.
  const synergyByEnglishSlug = new Map(
    synergies.map((syn) => [syn.slug, syn]),
  );
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
      iconSrc:
        matched?.iconUrl ?? `/icons/synergies/${matched?.iconStem ?? ""}.png`,
      variant: "synergy",
    };
  });

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
      <SeoHead
        title={t.title(unit.name)}
        description={description}
        path={`/units/${unit.slug}`}
        locale={locale}
        structuredData={structuredData}
      />
      <EntityDetail
        variant="unit"
        name={unit.name}
        iconSrc={unit.iconUrl}
        tag={{ label: t.cost(unit.cost) }}
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

export const getStaticPaths: GetStaticPaths = async () => ({
  // Slugs are locale-stable (English canonical), so a single set of paths
  // serves all locales.
  paths: getAllUnits().map((unit) => ({ params: { slug: unit.slug } })),
  // 'blocking' so new draft-only documents render in Presentation without
  // a rebuild. Production traffic for unknown slugs still 404s via the
  // notFound branch in getStaticProps.
  fallback: "blocking",
});

export const getStaticProps: GetStaticProps<UnitDetailPageProps> = async ({
  params,
  draftMode = false,
  locale: rawLocale,
}) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };
  const locale = normalizeLocale(rawLocale);

  const allUnits = draftMode
    ? await loadDraftUnits(true)
    : getAllUnits(locale);
  const unit = draftMode
    ? allUnits.find((u) => u.slug === slug) ?? null
    : getUnitBySlug(slug, locale);
  if (!unit) return { notFound: true };

  const related = allUnits
    .filter((candidate) => candidate.cost === unit.cost && candidate.slug !== unit.slug)
    .slice(0, 8);

  const synergies = draftMode
    ? await loadDraftSynergies(true)
    : getAllSynergies(locale);

  return {
    props: {
      unit,
      related,
      synergies,
      commentary: getCommentaryForEntity("unit", slug),
      locale,
      draftMode,
      supabase: null,
    },
  };
};
