import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { EntityCommentaryList } from "@/components/PatchCommentary";
import {
  getAllRelics,
  getRelicBySlug,
  type DisplayRelic,
} from "@/lib/relics";
import { getAllItems, iconUrl, TIER_COLOR, TIER_LABEL } from "@/lib/items";
import {
  getRelatedEntitiesForRelic,
  getRelatedItemsForRelic,
  ITEM_RELATION_CATEGORY_LABEL,
} from "@/lib/itemRelations";
import { absoluteUrl, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { cleanText, truncate } from "@/lib/text";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getCommentaryForEntity } from "@/lib/patchCommentary";
import { Markdown } from "@/components/Markdown";

// Static detail page backed by committed JSON generated from content/.

function buildDescription(relic: DisplayRelic): string {
  const summary =
    cleanText(relic.description) || `${relic.name} is a Dota Auto Chess relic.`;
  return truncate(`See what ${relic.name} does in Dota Auto Chess. ${summary}`, 158);
}

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllRelics().map((relic) => ({ slug: relic.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const relic = getRelicBySlug(slug, DEFAULT_LOCALE);
  if (!relic) return {};
  const title = `${relic.name} Relic Guide | ${SITE_TITLE}`;
  const description = buildDescription(relic);
  return {
    title,
    description,
    alternates: { canonical: `/relics/${relic.slug}` },
    robots: "index, follow, max-image-preview:large",
    openGraph: {
      title,
      description,
      type: "article",
      siteName: SITE_NAME,
      url: `/relics/${relic.slug}`,
      locale: "en_US",
      images: ["/logo.svg"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/logo.svg"],
    },
  };
}

export default async function RelicDetailPage({ params }: Props) {
  const { slug } = await params;

  const allRelics = getAllRelics(DEFAULT_LOCALE);
  const allItems = getAllItems(DEFAULT_LOCALE);
  const relic = getRelicBySlug(slug, DEFAULT_LOCALE);
  if (!relic) notFound();

  const related = allRelics
    .filter((candidate) => candidate.slug !== relic.slug)
    .slice(0, 8);
  const cmsRelatedEntities = getRelatedEntitiesForRelic(relic.name, DEFAULT_LOCALE);
  const relatedItems = getRelatedItemsForRelic(relic.name, DEFAULT_LOCALE);
  const patchCommentary = getCommentaryForEntity("relic", slug);

  const title = `${relic.name} Relic Guide | ${SITE_TITLE}`;
  const description = buildDescription(relic);
  const pageUrl = absoluteUrl(`/relics/${relic.slug}`);
  const relicsUrl = absoluteUrl("/relics");

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${relic.name} relic guide`,
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
          name: "Relics",
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
    cleanText(relic.description) || `${relic.name} is a relic in Dota Auto Chess.`;

  const relatedEntities: RelatedEntity[] = related.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: cleanText(r.description),
    iconSrc: r.iconUrl,
  }));

  const relatedItemEntities: RelatedEntity[] = relatedItems.map(
    ({ item, relation }) => ({
      slug: item.slug,
      name: item.name,
      description: `${relation.label} • ${ITEM_RELATION_CATEGORY_LABEL[relation.category]}`,
      iconSrc: iconUrl(item),
      variant: "item",
      level: TIER_LABEL[item.tier],
      accentColor: TIER_COLOR[item.tier],
    }),
  );
  const relatedItemDetailSlugs =
    cmsRelatedEntities.length > 0
      ? cmsRelatedEntities
          .filter((entity) => entity.variant === "item")
          .map((entity) => entity.slug)
      : relatedItems.map(({ item }) => item.slug);
  const relatedItemDetails = relatedItemDetailSlugs
    .map((itemSlug) => allItems.find((item) => item.slug === itemSlug))
    .filter((item) => item !== undefined);
  const generatedItemsMarkdown = relatedItemDetails
    .map((item) => {
      const detail = [cleanText(item.description), item.commentary]
        .filter(Boolean)
        .join("\n\n");
      return `### ${item.name}\n\n${detail}`;
    })
    .join("\n\n");
  const visibleCmsRelatedEntities = generatedItemsMarkdown
    ? cmsRelatedEntities.filter((entity) => entity.variant !== "item")
    : cmsRelatedEntities;
  const visibleRelatedItemEntities = generatedItemsMarkdown
    ? []
    : relatedItemEntities;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityDetail
        variant="relic"
        name={relic.name}
        iconSrc={relic.iconUrl}
        bodySections={[
          { title: "Relic Overview", body: <>{baseOverview}</> },
          ...(generatedItemsMarkdown
            ? [
                {
                  title: "Generated Items",
                  body: <Markdown>{generatedItemsMarkdown}</Markdown>,
                },
              ]
            : []),
        ]}
        commentary={
          relic.commentary || patchCommentary.length > 0 ? (
            <>
              {relic.commentary ? <Markdown>{relic.commentary}</Markdown> : null}
              {patchCommentary.length > 0 ? (
                <EntityCommentaryList entries={patchCommentary} />
              ) : null}
            </>
          ) : undefined
        }
        lore={relic.lore ? cleanText(relic.lore) : undefined}
        relatedTitle={
          visibleCmsRelatedEntities.length > 0 || visibleRelatedItemEntities.length > 0
            ? "Related Entities"
            : "More Relics"
        }
        related={
          visibleCmsRelatedEntities.length > 0
            ? visibleCmsRelatedEntities
            : visibleRelatedItemEntities.length > 0
              ? visibleRelatedItemEntities
              : relatedEntities
        }
        extraRelatedTitle={
          visibleCmsRelatedEntities.length > 0 || visibleRelatedItemEntities.length > 0
            ? "More Relics"
            : undefined
        }
        extraRelated={
          visibleCmsRelatedEntities.length > 0 || visibleRelatedItemEntities.length > 0
            ? relatedEntities
            : undefined
        }
      />
    </>
  );
}
