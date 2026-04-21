import Head from "next/head";
import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NavBar } from "../components/NavBar";
import itemsFull from "@data/items_full.json";
import itemsSimple from "@data/items.json";

interface FullItem {
  name: string;
  description: string;
  lore: string;
  quality: string;
  texture: string;
  notes: string[];
}

interface SimpleItem {
  tier: number;
  icon: string;
}

interface DisplayItem {
  name: string;
  description: string;
  tier: number;
  icon: string;
  texture: string;
}

const TIER_LABEL: Record<number, string> = {
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
  4: "Tier 4",
  5: "Tier 5",
};

const TIER_COLOR: Record<number, string> = {
  1: "var(--text-secondary)",
  2: "#5a8fd5",
  3: "#4eaa62",
  4: "#a85fd2",
  5: "var(--gold)",
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/'/g, "");
}

function iconUrl(item: DisplayItem): string {
  // Prefer the explicit icon filename from items.json; fall back to a stem
  // derived from the VPK texture path for items that slipped through.
  if (item.icon) return `/icons/items/${item.icon}`;
  const stem = (item.texture || "")
    .replace(/^item_custom\//, "")
    .replace(/^custom\//, "")
    .replace(/^item_/, "");
  return stem ? `/icons/items/${stem}.png` : "";
}

interface ItemsPageProps {
  supabase: SupabaseClient | null;
}

export default function ItemsPage({ supabase }: ItemsPageProps) {
  const [query, setQuery] = useState("");

  // Build tier-joined item list once: walk items.json (the canonical in-game
  // 76-item list) and look up each one in items_full.json for VPK metadata.
  const allItems = useMemo<DisplayItem[]>(() => {
    const simple = (itemsSimple as { items: Record<string, SimpleItem> }).items;
    const fullByNorm = new Map<string, [string, FullItem]>();
    for (const [iid, v] of Object.entries(itemsFull as Record<string, FullItem>)) {
      if (!v.name?.trim()) continue;
      fullByNorm.set(norm(v.name), [iid, v]);
    }

    const out: DisplayItem[] = [];
    for (const [simpleName, s] of Object.entries(simple)) {
      const match = fullByNorm.get(norm(simpleName));
      const full = match?.[1];
      out.push({
        // Prefer the VPK's canonical name (fixes items.json casing drift like
        // "Gossamar Cape" -> "Gossamer Cape", "Vladmirs Offering", etc.)
        name: full?.name ?? simpleName,
        description: full?.description ?? "",
        tier: s.tier,
        icon: s.icon,
        texture: full?.texture ?? "",
      });
    }
    return out;
  }, []);

  const grouped = useMemo(() => {
    const filtered = allItems.filter((i) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
      );
    });
    const byTier: Record<number, DisplayItem[]> = {};
    for (const i of filtered) (byTier[i.tier] ??= []).push(i);
    for (const t in byTier) byTier[t].sort((a, b) => a.name.localeCompare(b.name));
    return byTier;
  }, [allItems, query]);

  return (
    <>
      <Head>
        <title>Items — DAC Tools</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: 100vh;
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
          margin-bottom: 24px;
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
        <NavBar supabase={supabase} />
        <div className="container">
          <h1 className="page-title">Items</h1>
          <input
            className="search"
            placeholder="Search items..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {[1, 2, 3, 4, 5]
            .filter((t) => grouped[t]?.length)
            .map((t) => (
              <div key={t} className="tier-section">
                <div
                  className="tier-header"
                  style={{ color: TIER_COLOR[t] }}
                >
                  {TIER_LABEL[t]} ({grouped[t].length})
                </div>
                <div className="grid">
                  {grouped[t].map((item) => (
                    <div key={item.name} className="card">
                      <img
                        className="icon"
                        src={iconUrl(item)}
                        alt={item.name}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                        }}
                      />
                      <div className="body">
                        <div className="name">{item.name}</div>
                        <div className="desc">{item.description || "—"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
