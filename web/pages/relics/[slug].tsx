import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import {
  getAllRelics,
  getRelicBySlug,
  type DisplayRelic,
} from "@/lib/relics";
import { absoluteUrl, SITE_TITLE } from "@/lib/site";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import { loadDraftRelics } from "@/lib/sanity/draftLoaders";

interface RelicDetailPageProps {
  relic: DisplayRelic;
  related: DisplayRelic[];
  locale: Locale;
  draftMode: boolean;
  supabase: SupabaseClient | null;
}

const T = {
  en: {
    title: (n: string) => `${n} Relic Guide | ${SITE_TITLE}`,
    descriptionPrefix: (n: string) =>
      `See what ${n} does in Dota Auto Chess. `,
    relicsLabel: "Relics",
    relicGuide: (n: string) => `${n} relic guide`,
    moreRelics: "More Relics",
    fallback: (n: string) => `${n} is a Dota Auto Chess relic.`,
    overviewFallback: (n: string) => `${n} is a relic in Dota Auto Chess.`,
  },
  ru: {
    title: (n: string) => `${n} — гайд по реликвии | ${SITE_TITLE}`,
    descriptionPrefix: (n: string) => `Что делает ${n} в Dota Auto Chess. `,
    relicsLabel: "Реликвии",
    relicGuide: (n: string) => `Гайд по реликвии ${n}`,
    moreRelics: "Ещё реликвии",
    fallback: (n: string) => `${n} — реликвия в Dota Auto Chess.`,
    overviewFallback: (n: string) => `${n} — реликвия в Dota Auto Chess.`,
  },
  zh: {
    title: (n: string) => `${n} 圣物指南 | ${SITE_TITLE}`,
    descriptionPrefix: (n: string) => `了解 ${n} 在 Dota 自走棋中的效果。`,
    relicsLabel: "圣物",
    relicGuide: (n: string) => `${n} 圣物指南`,
    moreRelics: "更多圣物",
    fallback: (n: string) => `${n} 是 Dota 自走棋中的圣物。`,
    overviewFallback: (n: string) => `${n} 是 Dota 自走棋中的圣物。`,
  },
} as const;

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildDescription(relic: DisplayRelic, locale: Locale): string {
  const t = T[locale];
  const summary = cleanText(relic.description) || t.fallback(relic.name);
  return truncate(`${t.descriptionPrefix(relic.name)}${summary}`, 158);
}

export default function RelicDetailPage({
  relic,
  related,
  locale,
}: RelicDetailPageProps) {
  const t = T[locale];
  const title = t.title(relic.name);
  const description = buildDescription(relic, locale);
  const pageUrl = absoluteUrl(`/relics/${relic.slug}`);
  const relicsUrl = absoluteUrl("/relics");

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: t.relicGuide(relic.name),
      description,
      ...(pageUrl ? { url: pageUrl } : {}),
      about: { "@type": "Thing", name: relic.name },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: t.relicsLabel,
          ...(relicsUrl ? { item: relicsUrl } : {}),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: relic.name,
          ...(pageUrl ? { item: pageUrl } : {}),
        },
      ],
    },
  ];

  const baseOverview =
    cleanText(relic.description) || t.overviewFallback(relic.name);
  const overview = <>{baseOverview}</>;

  const relatedEntities: RelatedEntity[] = related.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: cleanText(r.description),
    iconSrc: r.iconUrl,
  }));

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path={`/relics/${relic.slug}`}
        locale={locale}
        structuredData={structuredData}
      />
      <EntityDetail
        variant="relic"
        name={relic.name}
        iconSrc={relic.iconUrl}
        overview={overview}
        lore={relic.lore ? cleanText(relic.lore) : undefined}
        relatedTitle={t.moreRelics}
        related={relatedEntities}
      />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: getAllRelics().map((relic) => ({ params: { slug: relic.slug } })),
  fallback: "blocking",
});

export const getStaticProps: GetStaticProps<RelicDetailPageProps> = async ({
  params,
  draftMode = false,
  locale: rawLocale,
}) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };
  const locale = normalizeLocale(rawLocale);

  const allRelics = draftMode
    ? await loadDraftRelics(true)
    : getAllRelics(locale);
  const relic = draftMode
    ? allRelics.find((r) => r.slug === slug) ?? null
    : getRelicBySlug(slug, locale);
  if (!relic) return { notFound: true };

  const related = allRelics
    .filter((candidate) => candidate.slug !== relic.slug)
    .slice(0, 8);

  return {
    props: {
      relic,
      related,
      locale,
      draftMode,
      supabase: null,
    },
  };
};
