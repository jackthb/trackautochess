import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { EntityCommentaryList } from "@/components/PatchCommentary";
import {
  getAllRelics,
  getRelicBySlug,
  type DisplayRelic,
} from "@/lib/relics";
import { absoluteUrl, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getCommentaryForEntity } from "@/lib/patchCommentary";

// Static detail page backed by committed JSON generated from content/.

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildDescription(relic: DisplayRelic): string {
  const summary =
    cleanText(relic.description) || `${relic.name} is a Dota Auto Chess relic.`;
  return truncate(`See what ${relic.name} does in Dota Auto Chess. ${summary}`, 158);
}

interface Props {
  params: Promise<{ slug: string }>;
}

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
  const relic = getRelicBySlug(slug, DEFAULT_LOCALE);
  if (!relic) notFound();

  const related = allRelics
    .filter((candidate) => candidate.slug !== relic.slug)
    .slice(0, 8);
  const commentary = getCommentaryForEntity("relic", slug);

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
        overview={<>{baseOverview}</>}
        commentary={
          commentary.length > 0 ? (
            <EntityCommentaryList entries={commentary} />
          ) : undefined
        }
        lore={relic.lore ? cleanText(relic.lore) : undefined}
        relatedTitle="More Relics"
        related={relatedEntities}
      />
    </>
  );
}
