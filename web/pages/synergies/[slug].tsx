import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllSynergies, getSynergyBySlug, type DisplaySynergy } from "@/lib/synergies";
import { getAllUnits } from "@/lib/units";

interface SynergyDetailPageProps {
  synergy: DisplaySynergy;
  related: DisplaySynergy[];
  supabase: SupabaseClient | null;
}

export default function SynergyDetailPage({ synergy, related }: SynergyDetailPageProps) {
  const description = `See what ${synergy.name} does in Dota Auto Chess.`;
  const moreSynergies: RelatedEntity[] = related.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    iconSrc: `/icons/synergies/${s.iconStem}.png`,
  }));
  const unitsForSynergy: RelatedEntity[] = getAllUnits()
    .filter((unit) => unit.synergies.includes(synergy.name))
    .map((unit) => ({
      slug: unit.slug,
      name: unit.name,
      description: `Cost ${unit.cost} • ${unit.synergies.join(", ")}`,
      iconSrc: `/icons/units/${unit.iconStem}.png`,
      variant: "unit",
    }));

  const indexLabel = synergy.category === "species" ? "Species" : "Classes";
  const indexPath = synergy.category === "species" ? "/species" : "/classes";

  return (
    <>
      <SeoHead title={`${synergy.name} Synergy Guide | ${SITE_TITLE}`} description={description} path={`/synergies/${synergy.slug}`} />
      <EntityDetail
        variant="synergy"
        name={synergy.name}
        iconSrc={`/icons/synergies/${synergy.iconStem}.png`}
        overview={<>{synergy.description || description}</>}
        lore={synergy.lore || undefined}
        indexLabel={indexLabel}
        indexPath={indexPath}
        relatedTitle={`${synergy.name} Units`}
        related={unitsForSynergy}
        extraRelatedTitle="More Synergies"
        extraRelated={moreSynergies}
      />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: getAllSynergies().map((synergy) => ({ params: { slug: synergy.slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };
  const synergy = getSynergyBySlug(slug);
  if (!synergy) return { notFound: true };

  const related = getAllSynergies()
    .filter((candidate) => candidate.slug !== synergy.slug && candidate.category === synergy.category)
    .slice(0, 8);

  return { props: { synergy, related } };
};
