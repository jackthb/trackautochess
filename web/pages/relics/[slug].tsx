import Link from "next/link";
import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SeoHead } from "@/lib/seo";
import {
  getAllRelics,
  getRelicBySlug,
  type DisplayRelic,
} from "@/lib/relics";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

interface RelicDetailPageProps {
  relic: DisplayRelic;
  relatedRelics: DisplayRelic[];
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
  relatedRelics,
  supabase,
}: RelicDetailPageProps) {
  const title = `${relic.name} Dota Auto Chess Relic Guide | ${SITE_NAME}`;
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
      about: {
        "@type": "Thing",
        name: relic.name,
      },
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

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path={`/relics/${relic.slug}`}
        structuredData={structuredData}
      />

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: 100vh;
        }
        .container {
          max-width: 920px;
          margin: 0 auto;
          padding: 40px 32px 80px;
        }
        .breadcrumbs {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 22px;
          font-size: 12px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .breadcrumbs a {
          color: var(--text-muted);
        }
        .breadcrumbs a:hover {
          color: var(--text-secondary);
        }
        .hero {
          display: flex;
          gap: 20px;
          align-items: flex-start;
          padding: 24px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          margin-bottom: 24px;
        }
        .icon {
          width: 72px;
          height: 72px;
          flex-shrink: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          object-fit: cover;
        }
        .title {
          font-family: "Cinzel", serif;
          font-size: 34px;
          letter-spacing: 3px;
          color: var(--text-primary);
          margin: 0 0 12px;
        }
        .lede {
          font-size: 15px;
          line-height: 1.7;
          color: var(--text-secondary);
          max-width: 720px;
          white-space: pre-line;
        }
        .section {
          padding: 24px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          margin-bottom: 18px;
        }
        .section-title {
          font-family: "Cinzel", serif;
          font-size: 15px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-primary);
          margin: 0 0 14px;
        }
        .body-copy {
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-secondary);
          white-space: pre-line;
        }
        .links {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 18px;
        }
        .link-chip {
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--text-secondary);
          border: 1px solid var(--border);
          padding: 8px 12px;
          transition: color 0.15s, border-color 0.15s, background 0.15s;
        }
        .link-chip:hover {
          color: var(--text-primary);
          border-color: var(--text-muted);
          background: var(--bg-hover);
        }
        .related-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border);
        }
        .related-card {
          background: var(--bg-surface);
          padding: 14px 16px;
          color: inherit;
          text-decoration: none;
        }
        .related-card:hover {
          background: var(--bg-hover);
        }
        .related-name {
          font-size: 14px;
          color: var(--text-primary);
          margin-bottom: 6px;
          font-weight: 500;
        }
        .related-desc {
          font-size: 12px;
          line-height: 1.6;
          color: var(--text-secondary);
        }
      `}</style>

      <div className="page">
        <div className="container">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span>/</span>
            <Link href="/relics">Relics</Link>
            <span>/</span>
            <span>{relic.name}</span>
          </nav>

          <section className="hero">
            <img
              className="icon"
              src={`/icons/relics/${relic.iconStem}.png`}
              alt={relic.name}
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
            <div>
              <h1 className="title">{relic.name}</h1>
              <div className="lede">
                {cleanText(relic.description) ||
                  `${relic.name} is a Dota Auto Chess relic.`}
              </div>
              <div className="links">
                <Link href="/relics" className="link-chip">
                  All relics
                </Link>
                <Link href="/patch-notes" className="link-chip">
                  Patch notes
                </Link>
                <Link href="/items" className="link-chip">
                  Items
                </Link>
              </div>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">Relic Overview</h2>
            <div className="body-copy">
              {cleanText(relic.description) ||
                `${relic.name} is a relic in Dota Auto Chess.`}
            </div>
          </section>

          {relic.lore && (
            <section className="section">
              <h2 className="section-title">Lore</h2>
              <div className="body-copy">{cleanText(relic.lore)}</div>
            </section>
          )}

          {relatedRelics.length > 0 && (
            <section className="section">
              <h2 className="section-title">More Relics</h2>
              <div className="related-grid">
                {relatedRelics.map((relatedRelic) => (
                  <Link
                    key={relatedRelic.slug}
                    href={`/relics/${relatedRelic.slug}`}
                    className="related-card"
                  >
                    <div className="related-name">{relatedRelic.name}</div>
                    <div className="related-desc">
                      {cleanText(relatedRelic.description) || "Open relic page"}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: getAllRelics().map((relic) => ({
      params: { slug: relic.slug },
    })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };

  const relic = getRelicBySlug(slug);
  if (!relic) return { notFound: true };

  const relatedRelics = getAllRelics()
    .filter((candidate) => candidate.slug !== relic.slug)
    .slice(0, 6);

  return {
    props: {
      relic,
      relatedRelics,
    },
  };
};
