import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SeoHead } from "@/lib/seo";
import {
  getAllItems,
  getItemBySlug,
  iconUrl,
  type DisplayItem,
  TIER_COLOR,
  TIER_LABEL,
} from "@/lib/items";
import { absoluteUrl, SITE_TITLE } from "@/lib/site";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import { loadDraftItems } from "@/lib/sanity/draftLoaders";

interface ItemDetailPageProps {
  item: DisplayItem;
  related: DisplayItem[];
  locale: Locale;
  draftMode: boolean;
  supabase: SupabaseClient | null;
}

const t = {
  title: (n: string) => `${n} Item Guide | ${SITE_TITLE}`,
  descriptionPrefix: (n: string) => `See what ${n} does in Dota Auto Chess. `,
  fallbackOverview: " A fuller in-game description is not available in the current data export.",
  overviewPrefix: (n: string, t: string) => `${n} is a ${t} item in Dota Auto Chess.`,
  moreOf: (t: string) => `More ${t} Items`,
  fallbackTier: (n: string, t: string) => `${n} is a ${t} Dota Auto Chess item.`,
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildDescription(item: DisplayItem): string {
  const tier = TIER_LABEL[item.tier];
  const fallback = t.fallbackTier(item.name, tier);
  const summary = cleanText(item.description) || fallback;
  return truncate(`${t.descriptionPrefix(item.name)}${summary}`, 158);
}

export default function ItemDetailPage({
  item,
  related,
  locale,
}: ItemDetailPageProps) {
  const tierLabel = TIER_LABEL[item.tier];
  const title = t.title(item.name);
  const description = buildDescription(item);
  const pageUrl = absoluteUrl(`/items/${item.slug}`);
  const itemsUrl = absoluteUrl("/items");
  const tierColor = TIER_COLOR[item.tier];

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${item.name} item guide`,
      description,
      ...(pageUrl ? { url: pageUrl } : {}),
      about: { "@type": "Thing", name: item.name },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Items",
          ...(itemsUrl ? { item: itemsUrl } : {}),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: item.name,
          ...(pageUrl ? { item: pageUrl } : {}),
        },
      ],
    },
  ];

  const cleanedDesc = cleanText(item.description);
  const overview = (
    <>
      {t.overviewPrefix(item.name, tierLabel)}
      {cleanedDesc ? ` ${cleanedDesc}` : t.fallbackOverview}
    </>
  );

  const relatedEntities: RelatedEntity[] = related.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: cleanText(r.description),
    iconSrc: iconUrl(r),
  }));

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path={`/items/${item.slug}`}
        locale={locale}
        structuredData={structuredData}
      />
      <EntityDetail
        variant="item"
        name={item.name}
        iconSrc={iconUrl(item)}
        overview={overview}
        notes={item.notes.map(cleanText)}
        lore={item.lore ? cleanText(item.lore) : undefined}
        tag={{ label: tierLabel, color: tierColor }}
        relatedTitle={t.moreOf(tierLabel)}
        related={relatedEntities}
        accentColor={tierColor}
      />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: getAllItems().map((item) => ({ params: { slug: item.slug } })),
  fallback: "blocking",
});

export const getStaticProps: GetStaticProps<ItemDetailPageProps> = async ({
  params,
  locale: rawLocale,
  draftMode = false,
}) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };
  const locale = normalizeLocale(rawLocale);

  const allItems = draftMode
    ? await loadDraftItems(true)
    : getAllItems(locale);
  const item = draftMode
    ? allItems.find((i) => i.slug === slug) ?? null
    : getItemBySlug(slug, locale);
  if (!item) return { notFound: true };

  const related = allItems
    .filter(
      (candidate) => candidate.tier === item.tier && candidate.slug !== item.slug
    )
    .slice(0, 8);

  return {
    props: {
      item,
      related,
      locale,
      draftMode,
      supabase: null,
    },
  };
};
