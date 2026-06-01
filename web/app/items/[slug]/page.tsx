import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { draftMode } from "next/headers";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { EntityCommentaryList } from "@/components/PatchCommentary";import {
  getAllItems,
  getItemBySlug,
  iconUrl,
  type DisplayItem,
  TIER_COLOR,
  TIER_LABEL,
} from "@/lib/items";
import { parseItemDescription } from "@/lib/itemDescription";
import { absoluteUrl, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { loadDraftItems } from "@/lib/sanity/draftLoaders";
import { getCommentaryForEntity } from "@/lib/patchCommentary";

// App Router migration of pages/items/[slug].tsx — mirrors
// app/relics/[slug]/page.tsx. getStaticPaths -> generateStaticParams;
// getStaticProps -> async Server Component reading params + draftMode().
// Draft mode (Sanity Presentation/visual editing) is preserved: in draft we read
// stega-encoded content via the loader and mount <AppVisualEditing/>; published
// pages stay static.

const t = {
  title: (n: string) => `${n} Item Guide | ${SITE_TITLE}`,
  descriptionPrefix: (n: string) => `See what ${n} does in Dota Auto Chess. `,
  moreOf: (t: string) => `More ${t} Items`,
  fallbackTier: (n: string, t: string) => `${n} is a ${t} Dota Auto Chess item.`,
  activeAbility: "Active Ability",
  stats: "Stats",
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

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllItems().map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = getItemBySlug(slug, DEFAULT_LOCALE);
  if (!item) return {};
  const title = t.title(item.name);
  const description = buildDescription(item);
  return {
    title,
    description,
    alternates: { canonical: `/items/${item.slug}` },
    robots: "index, follow, max-image-preview:large",
    openGraph: {
      title,
      description,
      type: "article",
      siteName: SITE_NAME,
      url: `/items/${item.slug}`,
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

export default async function ItemDetailPage({ params }: Props) {
  const { slug } = await params;
  const { isEnabled: isDraft } = await draftMode();

  const allItems = isDraft
    ? await loadDraftItems(true)
    : getAllItems(DEFAULT_LOCALE);
  const item = isDraft
    ? allItems.find((i) => i.slug === slug) ?? null
    : getItemBySlug(slug, DEFAULT_LOCALE);
  if (!item) notFound();

  const related = allItems
    .filter(
      (candidate) => candidate.tier === item.tier && candidate.slug !== item.slug
    )
    .slice(0, 8);
  const commentary = getCommentaryForEntity("item", slug);

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

  const { active, stats } = parseItemDescription(item.description);
  const bodySections = [
    ...(active ? [{ title: t.activeAbility, body: active }] : []),
    ...(stats ? [{ title: t.stats, body: stats }] : []),
  ];

  const relatedEntities: RelatedEntity[] = related.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: cleanText(r.description),
    iconSrc: iconUrl(r),
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityDetail
        variant="item"
        name={item.name}
        iconSrc={iconUrl(item)}
        bodySections={bodySections}
        commentary={
          commentary.length > 0 ? (
            <EntityCommentaryList entries={commentary} />
          ) : undefined
        }
        notes={item.notes.map(cleanText)}
        lore={item.lore ? cleanText(item.lore) : undefined}
        tag={{ label: tierLabel, color: tierColor }}
        relatedTitle={t.moreOf(tierLabel)}
        related={relatedEntities}
        accentColor={tierColor}
      />    </>
  );
}
