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

interface RelicDetailPageProps {
  relic: DisplayRelic;
  related: DisplayRelic[];
  supabase: SupabaseClient | null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildDescription(relic: DisplayRelic): string {
  const fallback = `${relic.name} is a Dota Auto Chess relic.`;
  const summary = cleanText(relic.description) || fallback;
  return truncate(
    `See what ${relic.name} does in Dota Auto Chess. ${summary}`,
    158
  );
}

export default function RelicDetailPage({
  relic,
  related,
  supabase,
}: RelicDetailPageProps) {
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
    cleanText(relic.description) ||
    `${relic.name} is a relic in Dota Auto Chess.`;
  const overview = (
    <>
      {baseOverview}
    </>
  );

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
        structuredData={structuredData}
      />
      <EntityDetail
        variant="relic"
        name={relic.name}
        iconSrc={relic.iconUrl}
        overview={overview}
        lore={relic.lore ? cleanText(relic.lore) : undefined}
        relatedTitle="More Relics"
        related={relatedEntities}
      />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: getAllRelics().map((relic) => ({ params: { slug: relic.slug } })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };

  const relic = getRelicBySlug(slug);
  if (!relic) return { notFound: true };

  const related = getAllRelics()
    .filter((candidate) => candidate.slug !== relic.slug)
    .slice(0, 8);

  return { props: { relic, related } };
};
