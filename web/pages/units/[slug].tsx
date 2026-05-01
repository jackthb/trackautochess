import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllUnits, getUnitBySlug, type DisplayUnit } from "@/lib/units";

interface UnitDetailPageProps {
  unit: DisplayUnit;
  related: DisplayUnit[];
  supabase: SupabaseClient | null;
}

export default function UnitDetailPage({ unit, related }: UnitDetailPageProps) {
  const description = `${unit.name} is a cost ${unit.cost} unit in Dota Auto Chess.`;
  const relatedEntities: RelatedEntity[] = related.map((u) => ({
    slug: u.slug,
    name: u.name,
    description: `Cost ${u.cost}`,
    iconSrc: `/icons/units/${u.iconStem}.png`,
  }));

  return (
    <>
      <SeoHead title={`${unit.name} Unit Guide | ${SITE_TITLE}`} description={description} path={`/units/${unit.slug}`} />
      <EntityDetail
        variant="unit"
        name={unit.name}
        iconSrc={`/icons/units/${unit.iconStem}.png`}
        overview={<>{description} {unit.synergies.length ? `Synergies: ${unit.synergies.join(", ")}.` : ""}</>}
        tag={{ label: `Cost ${unit.cost}` }}
        relatedTitle="More Units"
        related={relatedEntities}
      />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: getAllUnits().map((unit) => ({ params: { slug: unit.slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };
  const unit = getUnitBySlug(slug);
  if (!unit) return { notFound: true };

  const related = getAllUnits()
    .filter((candidate) => candidate.cost === unit.cost && candidate.slug !== unit.slug)
    .slice(0, 8);

  return { props: { unit, related } };
};
