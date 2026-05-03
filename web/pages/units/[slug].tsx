import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllUnits, getUnitBySlug, type DisplayUnit } from "@/lib/units";
import { getAllSynergies, type DisplaySynergy } from "@/lib/synergies";
import { slugifyName } from "@/lib/slugs";
import {
  loadDraftUnits,
  loadDraftSynergies,
} from "@/lib/sanity/draftLoaders";

interface UnitDetailPageProps {
  unit: DisplayUnit;
  related: DisplayUnit[];
  synergies: DisplaySynergy[];
  draftMode: boolean;
  supabase: SupabaseClient | null;
}

export default function UnitDetailPage({
  unit,
  related,
  synergies,
}: UnitDetailPageProps) {
  const description = `${unit.name} is a cost ${unit.cost} unit in Dota Auto Chess.`;
  const synergyByName = new Map(synergies.map((syn) => [syn.name, syn]));
  const relatedEntities: RelatedEntity[] = related.map((u) => ({
    slug: u.slug,
    name: u.name,
    description: `Cost ${u.cost}`,
    iconSrc: u.iconUrl,
  }));
  const synergyEntities: RelatedEntity[] = unit.synergies.map((syn) => {
    const matched = synergyByName.get(syn);
    return {
      slug: slugifyName(syn),
      name: syn,
      description: `${unit.name} activates this synergy.`,
      iconSrc: matched?.iconUrl ?? `/icons/synergies/${matched?.iconStem ?? ""}.png`,
      variant: "synergy",
    };
  });

  return (
    <>
      <SeoHead title={`${unit.name} Unit Guide | ${SITE_TITLE}`} description={description} path={`/units/${unit.slug}`} />
      <EntityDetail
        variant="unit"
        name={unit.name}
        iconSrc={unit.iconUrl}
        overview={<>{description} {unit.synergies.length ? `Synergies: ${unit.synergies.join(", ")}.` : ""}</>}
        tag={{ label: `Cost ${unit.cost}` }}
        relatedTitle={`${unit.name} Synergies`}
        related={synergyEntities}
        extraRelatedTitle="More Units"
        extraRelated={relatedEntities}
      />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: getAllUnits().map((unit) => ({ params: { slug: unit.slug } })),
  // 'blocking' so new draft-only documents render in Presentation without
  // a rebuild. Production traffic for unknown slugs still 404s via the
  // notFound branch in getStaticProps.
  fallback: "blocking",
});

export const getStaticProps: GetStaticProps<UnitDetailPageProps> = async ({
  params,
  draftMode = false,
}) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };

  const allUnits = draftMode ? await loadDraftUnits(true) : getAllUnits();
  const unit = draftMode
    ? allUnits.find((u) => u.slug === slug) ?? null
    : getUnitBySlug(slug);
  if (!unit) return { notFound: true };

  const related = allUnits
    .filter((candidate) => candidate.cost === unit.cost && candidate.slug !== unit.slug)
    .slice(0, 8);

  const synergies = draftMode
    ? await loadDraftSynergies(true)
    : getAllSynergies();

  return {
    props: {
      unit,
      related,
      synergies,
      draftMode,
      supabase: null,
    },
  };
};
