import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SeoHead } from "@/lib/seo";
import { getAllRelics } from "@/lib/relics";
import { SITE_NAME } from "@/lib/site";

interface RelicsPageProps {
  supabase: SupabaseClient | null;
}

const ALL_RELICS = getAllRelics();

export default function RelicsPage({ supabase }: RelicsPageProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const search = router.query.q;
    if (typeof search === "string") {
      setQuery(search);
    }
  }, [router.query.q]);

  const relics = useMemo(() => {
    if (!query) return ALL_RELICS;
    const normalizedQuery = query.toLowerCase();
    return ALL_RELICS.filter(
      (relic) =>
        relic.name.toLowerCase().includes(normalizedQuery) ||
        relic.description.toLowerCase().includes(normalizedQuery) ||
        relic.lore.toLowerCase().includes(normalizedQuery)
    );
  }, [query]);

  const title = `Dota Auto Chess Relics | ${SITE_NAME}`;
  const description =
    "Browse every Dota Auto Chess relic, search recent additions, and open dedicated relic pages on DAC Tools.";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Dota Auto Chess relics",
    description,
    about: "Dota Auto Chess relics",
  };

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path="/relics"
        structuredData={structuredData}
      />

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 40px 32px 80px;
        }
        .page-title {
          font-family: "Cinzel", serif;
          font-size: 28px;
          font-weight: 600;
          letter-spacing: 4px;
          text-transform: uppercase;
          color: var(--text-primary);
          margin-bottom: 14px;
        }
        .intro {
          max-width: 720px;
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-secondary);
          margin-bottom: 16px;
        }
        .intro-links {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 32px;
        }
        .intro-link {
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--text-secondary);
          border: 1px solid var(--border);
          padding: 8px 12px;
          transition: color 0.15s, border-color 0.15s, background 0.15s;
        }
        .intro-link:hover {
          color: var(--text-primary);
          border-color: var(--text-muted);
          background: var(--bg-hover);
        }
        .search {
          width: 100%;
          max-width: 360px;
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border);
          padding: 8px 14px;
          letter-spacing: 0.5px;
          margin-bottom: 20px;
        }
        .search:focus {
          outline: none;
          border-color: var(--accent-dim);
        }
        .count {
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 1.5px;
          text-transform: uppercase;
          margin-bottom: 14px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border);
        }
        .card {
          background: var(--bg-surface);
          padding: 18px 20px;
          display: flex;
          gap: 16px;
          align-items: flex-start;
          color: inherit;
          text-decoration: none;
          transition: background 0.15s;
        }
        .card:hover {
          background: var(--bg-hover);
        }
        .icon {
          width: 56px;
          height: 56px;
          flex-shrink: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          object-fit: cover;
        }
        .body {
          flex: 1;
          min-width: 0;
        }
        .name {
          font-family: "Cinzel", serif;
          font-size: 16px;
          letter-spacing: 1.5px;
          color: var(--gold);
          margin-bottom: 8px;
        }
        .desc {
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-primary);
          margin-bottom: 10px;
          white-space: pre-line;
        }
        .lore {
          font-size: 11px;
          line-height: 1.5;
          color: var(--text-muted);
          font-style: italic;
        }
      `}</style>

      <div className="page">
        <div className="container">
          <h1 className="page-title">Relics</h1>
          <p className="intro">
            Browse every Dota Auto Chess relic, search relic effects, and keep
            an indexable page for searches around new relics and update notes.
          </p>
          <div className="intro-links">
            <Link href="/patch-notes" className="intro-link">
              Latest relic updates
            </Link>
            <Link href="/items" className="intro-link">
              Browse items
            </Link>
          </div>
          <input
            className="search"
            placeholder="Search relics..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="count">{relics.length} relics</div>
          <div className="grid">
            {relics.map((relic) => (
              <Link
                key={relic.slug}
                href={`/relics/${relic.slug}`}
                className="card"
              >
                <img
                  className="icon"
                  src={`/icons/relics/${relic.iconStem}.png`}
                  alt={relic.name}
                  onError={(event) => {
                    event.currentTarget.style.visibility = "hidden";
                  }}
                />
                <div className="body">
                  <div className="name">{relic.name}</div>
                  <div className="desc">{relic.description || "-"}</div>
                  {relic.lore && !/^from:?\s*relic\s*box$/i.test(relic.lore) && (
                    <div className="lore">"{relic.lore}"</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
