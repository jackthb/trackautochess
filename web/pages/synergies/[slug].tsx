import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import {
  getAllSynergies,
  getSynergyBySlug,
  getSynergyNameTranslator,
  type DisplaySynergy,
} from "@/lib/synergies";
import { getAllUnits, type DisplayUnit } from "@/lib/units";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import {
  loadDraftSynergies,
  loadDraftUnits,
} from "@/lib/sanity/draftLoaders";

interface SynergyDetailPageProps {
  synergy: DisplaySynergy;
  related: DisplaySynergy[];
  matchingUnits: DisplayUnit[];
  locale: Locale;
  draftMode: boolean;
  supabase: SupabaseClient | null;
}

const T = {
  en: {
    title: (n: string) => `${n} Synergy Guide | ${SITE_TITLE}`,
    description: (n: string) => `See what ${n} does in Dota Auto Chess.`,
    species: "Species",
    classes: "Classes",
    cost: (c: number) => `Cost ${c}`,
    nUnits: (n: string) => `${n} Units`,
    moreSynergies: "More Synergies",
  },
  ru: {
    title: (n: string) => `${n} — гайд по синергии | ${SITE_TITLE}`,
    description: (n: string) => `Что делает синергия ${n} в Dota Auto Chess.`,
    species: "Расы",
    classes: "Классы",
    cost: (c: number) => `Цена ${c}`,
    nUnits: (n: string) => `Фигуры ${n}`,
    moreSynergies: "Ещё синергии",
  },
  zh: {
    title: (n: string) => `${n} 羁绊指南 | ${SITE_TITLE}`,
    description: (n: string) => `了解 ${n} 在 Dota 自走棋中的效果。`,
    species: "种族",
    classes: "职业",
    cost: (c: number) => `${c} 费`,
    nUnits: (n: string) => `${n} 棋子`,
    moreSynergies: "更多羁绊",
  },
} as const;

export default function SynergyDetailPage({
  synergy,
  related,
  matchingUnits,
  locale,
}: SynergyDetailPageProps) {
  const t = T[locale];
  const description = t.description(synergy.name);
  const translateSyn = getSynergyNameTranslator(locale);
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

  return (
    <>
      <SeoHead
        title={t.title(synergy.name)}
        description={description}
        path={`/synergies/${synergy.slug}`}
        locale={locale}
      />
      <EntityDetail
        variant="synergy"
        name={synergy.name}
        iconSrc={synergy.iconUrl}
        overview={<>{synergy.description || description}</>}
        lore={synergy.lore || undefined}
        indexLabel={indexLabel}
        indexPath={indexPath}
        relatedTitle={t.nUnits(synergy.name)}
        related={unitsForSynergy}
        extraRelatedTitle={t.moreSynergies}
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
  locale: rawLocale,
}) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };
  const locale = normalizeLocale(rawLocale);

  const allSynergies = draftMode
    ? await loadDraftSynergies(true)
    : getAllSynergies(locale);
  const synergy = draftMode
    ? allSynergies.find((s) => s.slug === slug) ?? null
    : getSynergyBySlug(slug, locale);
  if (!synergy) return { notFound: true };

  // Units' `synergies` array stores English-canonical names. Resolve the
  // English name for the current synergy via slug, then filter units in
  // the active locale (so unit display names are correct).
  const englishName =
    getAllSynergies("en").find((s) => s.slug === synergy.slug)?.name ??
    synergy.name;
  const localizedUnits = draftMode
    ? await loadDraftUnits(true)
    : getAllUnits(locale);
  const matchingUnits = localizedUnits.filter((u) =>
    u.synergies.includes(englishName),
  );

  const related = allSynergies
    .filter(
      (candidate) =>
        candidate.slug !== synergy.slug && candidate.category === synergy.category
    )
    .slice(0, 8);

  return {
    props: {
      synergy,
      related,
      matchingUnits,
      locale,
      draftMode,
      supabase: null,
    },
  };
};
