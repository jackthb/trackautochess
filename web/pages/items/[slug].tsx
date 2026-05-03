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
import { loadDraftItems } from "@/lib/sanity/draftLoaders";

interface ItemDetailPageProps {
  item: DisplayItem;
  related: DisplayItem[];
  draftMode: boolean;
  supabase: SupabaseClient | null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildDescription(item: DisplayItem): string {
  const fallback = `${item.name} is a ${TIER_LABEL[item.tier]} Dota Auto Chess item.`;
  const summary = cleanText(item.description) || fallback;
  return truncate(
    `See what ${item.name} does in Dota Auto Chess. ${summary}`,
    158
  );
}

export default function ItemDetailPage({
  item,
  related,
}: ItemDetailPageProps) {
  const title = `${item.name} Item Guide | ${SITE_TITLE}`;
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
      {item.name} is a {TIER_LABEL[item.tier]} item in Dota Auto Chess.
      {cleanedDesc
        ? ` ${cleanedDesc}`
        : " A fuller in-game description is not available in the current data export."}
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
        structuredData={structuredData}
      />
      <EntityDetail
        variant="item"
        name={item.name}
        iconSrc={iconUrl(item)}
        overview={overview}
        notes={item.notes.map(cleanText)}
        lore={item.lore ? cleanText(item.lore) : undefined}
        tag={{ label: TIER_LABEL[item.tier], color: tierColor }}
        relatedTitle={`More ${TIER_LABEL[item.tier]} Items`}
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
  draftMode = false,
}) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };

  const allItems = draftMode ? await loadDraftItems(true) : getAllItems();
  const item = draftMode
    ? allItems.find((i) => i.slug === slug) ?? null
    : getItemBySlug(slug);
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
      draftMode,
      supabase: null,
    },
  };
};
