import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { draftMode } from "next/headers";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { SynergyDescription } from "@/components/SynergyDescription";
import { EntityCommentaryList } from "@/components/PatchCommentary";import {
  getAllSynergies,
  getSynergyBySlug,
  getSynergyNameTranslator,
} from "@/lib/synergies";
import { getAllUnits } from "@/lib/units";
import { absoluteUrl, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import {
  loadDraftSynergies,
  loadDraftUnits,
} from "@/lib/sanity/draftLoaders";
import { getCommentaryForEntity } from "@/lib/patchCommentary";

// App Router migration of pages/synergies/[slug].tsx. getStaticPaths ->
// generateStaticParams; getStaticProps -> async Server Component reading
// params + draftMode(). Draft mode (Sanity Presentation/visual editing) is
// preserved: in draft we read stega-encoded content via the loaders and
// mount <AppVisualEditing/>; published pages stay static.

const t = {
  title: (n: string) => `${n} Synergy Guide | ${SITE_TITLE}`,
  description: (n: string) => `See what ${n} does in Dota Auto Chess.`,
  species: "Species",
  classes: "Classes",
  cost: (c: number) => `Cost ${c}`,
  nUnits: (n: string) => `${n} Units`,
  moreSynergies: "More Synergies",
};

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllSynergies().map((synergy) => ({ slug: synergy.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const synergy = getSynergyBySlug(slug, DEFAULT_LOCALE);
  if (!synergy) return {};
  const title = t.title(synergy.name);
  const description = t.description(synergy.name);
  return {
    title,
    description,
    alternates: { canonical: `/synergies/${synergy.slug}` },
    robots: "index, follow, max-image-preview:large",
    openGraph: {
      title,
      description,
      type: "article",
      siteName: SITE_NAME,
      url: `/synergies/${synergy.slug}`,
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

export default async function SynergyDetailPage({ params }: Props) {
  const { slug } = await params;
  const { isEnabled: isDraft } = await draftMode();

  const allSynergies = isDraft
    ? await loadDraftSynergies(true)
    : getAllSynergies(DEFAULT_LOCALE);
  const synergy = isDraft
    ? allSynergies.find((s) => s.slug === slug) ?? null
    : getSynergyBySlug(slug, DEFAULT_LOCALE);
  if (!synergy) notFound();

  // Units' `synergies` array stores English-canonical names. Resolve the
  // English name for the current synergy via slug, then filter units (so
  // unit display names are correct).
  const englishName =
    getAllSynergies(DEFAULT_LOCALE).find((s) => s.slug === synergy.slug)?.name ??
    synergy.name;
  const localizedUnits = isDraft
    ? await loadDraftUnits(true)
    : getAllUnits(DEFAULT_LOCALE);
  const matchingUnits = localizedUnits.filter((u) =>
    u.synergies.includes(englishName),
  );

  const related = allSynergies
    .filter(
      (candidate) =>
        candidate.slug !== synergy.slug && candidate.category === synergy.category
    )
    .slice(0, 8);

  const commentary = getCommentaryForEntity("synergy", slug);

  const description = t.description(synergy.name);
  const translateSyn = getSynergyNameTranslator(DEFAULT_LOCALE);
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
  const pageUrl = absoluteUrl(`/synergies/${synergy.slug}`);
  const indexUrl = absoluteUrl(indexPath);
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${synergy.name} synergy guide`,
      description,
      ...(pageUrl ? { url: pageUrl } : {}),
      about: { "@type": "Thing", name: synergy.name },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: indexLabel,
          ...(indexUrl ? { item: indexUrl } : {}),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: synergy.name,
          ...(pageUrl ? { item: pageUrl } : {}),
        },
      ],
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EntityDetail
        variant="synergy"
        name={synergy.name}
        iconSrc={synergy.iconUrl}
        overview={<SynergyDescription description={synergy.description || description} />}
        commentary={
          commentary.length > 0 ? (
            <EntityCommentaryList entries={commentary} />
          ) : undefined
        }
        lore={synergy.lore || undefined}
        indexLabel={indexLabel}
        indexPath={indexPath}
        relatedTitle={t.nUnits(synergy.name)}
        related={unitsForSynergy}
        extraRelatedTitle={t.moreSynergies}
        extraRelated={moreSynergies}
      />    </>
  );
}
