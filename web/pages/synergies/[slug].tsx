import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import {
  getAllSynergies,
  getSynergyBySlug,
  type DisplaySynergy,
} from "@/lib/synergies";
import { getAllUnits, type DisplayUnit } from "@/lib/units";
import {
  loadDraftSynergies,
  loadDraftUnits,
} from "@/lib/sanity/draftLoaders";

interface SynergyDetailPageProps {
  synergy: DisplaySynergy;
  related: DisplaySynergy[];
  units: DisplayUnit[];
  draftMode: boolean;
  supabase: SupabaseClient | null;
}

export default function SynergyDetailPage({
  synergy,
  related,
  units,
}: SynergyDetailPageProps) {
  const description = `See what ${synergy.name} does in Dota Auto Chess.`;
  const moreSynergies: RelatedEntity[] = related.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    iconSrc: s.iconUrl,
  }));
  const unitsForSynergy: RelatedEntity[] = units
    .filter((unit) => unit.synergies.includes(synergy.name))
    .map((unit) => ({
      slug: unit.slug,
      name: unit.name,
      description: `Cost ${unit.cost} • ${unit.synergies.join(", ")}`,
      iconSrc: unit.iconUrl,
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
        iconSrc={synergy.iconUrl}
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
  fallback: "blocking",
});

export const getStaticProps: GetStaticProps<SynergyDetailPageProps> = async ({
  params,
  draftMode = false,
}) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };

  const allSynergies = draftMode
    ? await loadDraftSynergies(true)
    : getAllSynergies();
  const synergy = draftMode
    ? allSynergies.find((s) => s.slug === slug) ?? null
    : getSynergyBySlug(slug);
  if (!synergy) return { notFound: true };

  const related = allSynergies
    .filter(
      (candidate) =>
        candidate.slug !== synergy.slug && candidate.category === synergy.category
    )
    .slice(0, 8);

  const units = draftMode ? await loadDraftUnits(true) : getAllUnits();

  return {
    props: {
      synergy,
      related,
      units,
      draftMode,
      supabase: null,
    },
  };
};
