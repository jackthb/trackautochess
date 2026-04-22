import Link from "next/link";
import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SeoHead } from "@/lib/seo";
import {
  getAllItems,
  getItemBySlug,
  iconUrl,
  type DisplayItem,
  TIER_COLOR,
  TIER_LABEL,
} from "@/lib/items";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

interface ItemDetailPageProps {
  item: DisplayItem;
  relatedItems: DisplayItem[];
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
  relatedItems,
  supabase,
}: ItemDetailPageProps) {
  const title = `${item.name} Dota Auto Chess Item Guide | ${SITE_NAME}`;
  const description = buildDescription(item);
  const pageUrl = absoluteUrl(`/items/${item.slug}`);
  const itemsUrl = absoluteUrl("/items");
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${item.name} item guide`,
      description,
      ...(pageUrl ? { url: pageUrl } : {}),
      about: {
        "@type": "Thing",
        name: item.name,
      },
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

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path={`/items/${item.slug}`}
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
        .tier {
          display: inline-flex;
          align-items: center;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          padding: 7px 10px;
          border: 1px solid currentColor;
          margin-bottom: 16px;
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
        .notes {
          margin: 0;
          padding-left: 18px;
          color: var(--text-secondary);
          line-height: 1.7;
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
            <Link href="/items">Items</Link>
            <span>/</span>
            <span>{item.name}</span>
          </nav>

          <section className="hero">
            <img
              className="icon"
              src={iconUrl(item)}
              alt={item.name}
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
            <div>
              <h1 className="title">{item.name}</h1>
              <div className="tier" style={{ color: TIER_COLOR[item.tier] }}>
                {TIER_LABEL[item.tier]}
              </div>
              <div className="lede">
                {cleanText(item.description) ||
                  `${item.name} is a ${TIER_LABEL[item.tier]} item in Dota Auto Chess.`}
              </div>
              <div className="links">
                <Link href="/items" className="link-chip">
                  All items
                </Link>
                <Link href="/patch-notes" className="link-chip">
                  Patch notes
                </Link>
                <Link href="/relics" className="link-chip">
                  Relics
                </Link>
              </div>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">Item Overview</h2>
            <div className="body-copy">
              {`${item.name} is listed as a ${TIER_LABEL[item.tier]} item in Dota Auto Chess.`}
              {item.description
                ? ` ${cleanText(item.description)}`
                : " A fuller in-game description is not available in the current data export."}
            </div>
          </section>

          {item.notes.length > 0 && (
            <section className="section">
              <h2 className="section-title">Notes</h2>
              <ul className="notes">
                {item.notes.map((note, index) => (
                  <li key={index}>{cleanText(note)}</li>
                ))}
              </ul>
            </section>
          )}

          {item.lore && (
            <section className="section">
              <h2 className="section-title">Lore</h2>
              <div className="body-copy">{cleanText(item.lore)}</div>
            </section>
          )}

          {relatedItems.length > 0 && (
            <section className="section">
              <h2 className="section-title">More {TIER_LABEL[item.tier]} Items</h2>
              <div className="related-grid">
                {relatedItems.map((relatedItem) => (
                  <Link
                    key={relatedItem.slug}
                    href={`/items/${relatedItem.slug}`}
                    className="related-card"
                  >
                    <div className="related-name">{relatedItem.name}</div>
                    <div className="related-desc">
                      {cleanText(relatedItem.description) || "Open item page"}
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
    paths: getAllItems().map((item) => ({
      params: { slug: item.slug },
    })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug;
  if (typeof slug !== "string") return { notFound: true };

  const item = getItemBySlug(slug);
  if (!item) return { notFound: true };

  const relatedItems = getAllItems()
    .filter((candidate) => candidate.tier === item.tier && candidate.slug !== item.slug)
    .slice(0, 6);

  return {
    props: {
      item,
      relatedItems,
    },
  };
};
