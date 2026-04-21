import Head from "next/head";
import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NavBar } from "../components/NavBar";
import { relicStem } from "@dac/shared/game-utils";
import relicsData from "@data/relics.json";

interface RelicInfo {
  name: string;
  description: string;
  lore: string;
}

interface RelicsPageProps {
  supabase: SupabaseClient | null;
}

export default function RelicsPage({ supabase }: RelicsPageProps) {
  const [query, setQuery] = useState("");

  const relics = useMemo(() => {
    const all = Object.values(
      (relicsData as { relics: Record<string, RelicInfo> }).relics
    ).filter((r) => r.name && r.name.trim());
    if (!query) return [...all].sort((a, b) => a.name.localeCompare(b.name));
    const q = query.toLowerCase();
    return all
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.lore.toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query]);

  return (
    <>
      <Head>
        <title>Relics — DAC Tools</title>
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
          font-family: "IBM Plex Mono", monospace;
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
        <NavBar supabase={supabase} />
        <div className="container">
          <h1 className="page-title">Relics</h1>
          <input
            className="search"
            placeholder="Search relics..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="count">{relics.length} relics</div>
          <div className="grid">
            {relics.map((r) => (
              <div key={r.name} className="card">
                <img
                  className="icon"
                  src={`/icons/relics/${relicStem(r.name)}.png`}
                  alt={r.name}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
                <div className="body">
                  <div className="name">{r.name}</div>
                  <div className="desc">{r.description || "—"}</div>
                  {r.lore && !/^from:?\s*relic\s*box$/i.test(r.lore) && (
                    <div className="lore">&ldquo;{r.lore}&rdquo;</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
