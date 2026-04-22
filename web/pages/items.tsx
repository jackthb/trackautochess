import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SeoHead } from "@/lib/seo";
import {
  getAllItems,
  iconUrl,
  TIER_COLOR,
  TIER_LABEL,
} from "@/lib/items";
import { SITE_NAME } from "@/lib/site";

interface ItemsPageProps {
  supabase: SupabaseClient | null;
}

const ALL_ITEMS = getAllItems();

export default function ItemsPage({ supabase }: ItemsPageProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const search = router.query.q;
    if (typeof search === "string") {
      setQuery(search);
    }
  }, [router.query.q]);

  const grouped = useMemo(() => {
    const filtered = ALL_ITEMS.filter((item) => {
      if (!query) return true;
      const normalizedQuery = query.toLowerCase();
      return (
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery)
      );
    });

    const byTier: Record<number, typeof ALL_ITEMS> = {};
    for (const item of filtered) (byTier[item.tier] ??= []).push(item);
    return byTier;
  }, [query]);

  const title = `Dota Auto Chess Items | ${SITE_NAME}`;
  const description =
    "Browse every Dota Auto Chess item by tier, search specific items like Vanguard, and open dedicated item pages on DAC Tools.";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Dota Auto Chess items",
    description,
    about: "Dota Auto Chess items",
  };

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path="/items"
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
          margin-bottom: 32px;
        }
        .search:focus {
          outline: none;
          border-color: var(--accent-dim);
        }
        .tier-section {
          margin-bottom: 40px;
        }
        .tier-header {
          font-family: "Cinzel", serif;
          font-size: 14px;
          letter-spacing: 3px;
          text-transform: uppercase;
          margin-bottom: 14px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border);
        }
        .card {
          background: var(--bg-surface);
          padding: 14px 16px;
          display: flex;
          gap: 12px;
          align-items: flex-start;
          color: inherit;
          text-decoration: none;
          transition: background 0.15s;
        }
        .card:hover {
          background: var(--bg-hover);
        }
        .icon {
          width: 44px;
          height: 44px;
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
          font-size: 14px;
          color: var(--text-primary);
          margin-bottom: 4px;
          font-weight: 500;
        }
        .desc {
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-secondary);
          white-space: pre-line;
        }
      `}</style>

      <div className="page">
        <div className="container">
          <h1 className="page-title">Items</h1>
          <p className="intro">
            Browse every Dota Auto Chess item in one place. Search for specific
            items like Vanguard, compare tiers, and open dedicated item pages
            that can rank for long-tail item searches.
          </p>
          <div className="intro-links">
            <Link href="/patch-notes" className="intro-link">
              Latest item updates
            </Link>
            <Link href="/relics" className="intro-link">
              Browse relics
            </Link>
          </div>
          <input
            className="search"
            placeholder="Search items..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {[1, 2, 3, 4, 5]
            .filter((tier) => grouped[tier]?.length)
            .map((tier) => (
              <div key={tier} className="tier-section">
                <div className="tier-header" style={{ color: TIER_COLOR[tier] }}>
                  {TIER_LABEL[tier]} ({grouped[tier].length})
                </div>
                <div className="grid">
                  {grouped[tier].map((item) => (
                    <Link
                      key={item.slug}
                      href={`/items/${item.slug}`}
                      className="card"
                    >
                      <img
                        className="icon"
                        src={iconUrl(item)}
                        alt={item.name}
                        onError={(event) => {
                          event.currentTarget.style.visibility = "hidden";
                        }}
                      />
                      <div className="body">
                        <div className="name">{item.name}</div>
                        <div className="desc">{item.description || "-"}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
