import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllUnits, getUnitBySlug, type DisplayUnit } from "@/lib/units";
import {
  getAllSynergies,
  getSynergyNameTranslator,
  type DisplaySynergy,
} from "@/lib/synergies";
import { slugifyName } from "@/lib/slugs";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import {
  loadDraftUnits,
  loadDraftSynergies,
} from "@/lib/sanity/draftLoaders";

interface UnitDetailPageProps {
  unit: DisplayUnit;
  related: DisplayUnit[];
  synergies: DisplaySynergy[];
  locale: Locale;
  draftMode: boolean;
  supabase: SupabaseClient | null;
}

const T = {
  en: {
    title: (n: string) => `${n} Unit Guide | ${SITE_TITLE}`,
    description: (n: string, c: number) =>
      `${n} is a cost ${c} unit in Dota Auto Chess.`,
    activates: (u: string) => `${u} activates this synergy.`,
    cost: (c: number) => `Cost ${c}`,
  },
  ru: {
    title: (n: string) => `${n} — гайд по фигуре | ${SITE_TITLE}`,
    description: (n: string, c: number) =>
      `${n} — фигура за ${c} золота в Dota Auto Chess.`,
    activates: (u: string) => `${u} активирует эту синергию.`,
    cost: (c: number) => `Цена ${c}`,
  },
  zh: {
    title: (n: string) => `${n} 棋子指南 | ${SITE_TITLE}`,
    description: (n: string, c: number) =>
      `${n} 是 Dota 自走棋中的 ${c} 费棋子。`,
    activates: (u: string) => `${u} 触发此羁绊。`,
    cost: (c: number) => `${c} 费`,
  },
} as const;

export default function UnitDetailPage({
  unit,
  related,
  synergies,
  locale,
}: UnitDetailPageProps) {
  const t = T[locale];
  const description = t.description(unit.name, unit.cost);
  // synergies are localized; the unit's `synergies` field stores English
  // names so we look up by slug derived from the English form.
  const synergyByEnglishSlug = new Map(
    synergies.map((syn) => [syn.slug, syn]),
  );
  const translateSyn = getSynergyNameTranslator(locale);
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
      description: t.activates(unit.name),
      iconSrc:
        matched?.iconUrl ?? `/icons/synergies/${matched?.iconStem ?? ""}.png`,
      variant: "synergy",
    };
  });

  return (
    <>
      <SeoHead
        title={t.title(unit.name)}
        description={description}
        path={`/units/${unit.slug}`}
        locale={locale}
      />
      <EntityDetail
        variant="unit"
        name={unit.name}
        iconSrc={unit.iconUrl}
        overview={<>{description} {unit.synergies.length ? `${RELATED_LABELS[locale].synergies}: ${unit.synergies.map(translateSyn).join(", ")}.` : ""}</>}
        tag={{ label: t.cost(unit.cost) }}
        relatedTitle={RELATED_LABELS[locale].unitSynergies(unit.name)}
        related={synergyEntities}
        extraRelatedTitle={RELATED_LABELS[locale].moreUnits}
        extraRelated={relatedEntities}
      />
    </>
  );
}

const RELATED_LABELS = {
  en: {
    synergies: "Synergies",
    unitSynergies: (n: string) => `${n} Synergies`,
    moreUnits: "More Units",
  },
  ru: {
    synergies: "Синергии",
    unitSynergies: (n: string) => `Синергии ${n}`,
    moreUnits: "Ещё фигуры",
  },
  zh: {
    synergies: "羁绊",
    unitSynergies: (n: string) => `${n} 羁绊`,
    moreUnits: "更多棋子",
  },
} as const;

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
      locale,
      draftMode,
      supabase: null,
    },
  };
};
