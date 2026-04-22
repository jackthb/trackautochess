import Head from "next/head";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import patchIndex from "@data/patch_notes/index.json";

interface IndexPatch {
  date: string;
  title: string;
  slug: string;
}

interface PatchNotesPageProps {
  supabase: SupabaseClient | null;
}

export default function PatchNotesPage({ supabase }: PatchNotesPageProps) {
  const patches = [...(patchIndex.patches as IndexPatch[])].sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  return (
    <>
      <Head>
        <title>Patch Notes — DAC Tools</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .container {
          max-width: 720px;
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
          margin-bottom: 32px;
        }
        .list {
          border: 1px solid var(--border);
        }
        .entry {
          display: grid;
          grid-template-columns: 120px 1fr auto;
          gap: 20px;
          align-items: baseline;
          padding: 18px 22px;
          border-bottom: 1px solid var(--border-subtle);
          transition: background 0.15s;
        }
        .entry:last-child {
          border-bottom: none;
        }
        .entry:hover {
          background: var(--bg-hover);
        }
        .date {
          font-size: 12px;
          letter-spacing: 1.5px;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .title {
          font-family: "Cinzel", serif;
          font-size: 15px;
          letter-spacing: 1.5px;
          color: var(--text-primary);
        }
        .arrow {
          font-size: 14px;
          color: var(--accent-dim);
        }
      `}</style>

      <div className="page">
        <div className="container">
          <h1 className="page-title">Patch Notes</h1>
          <div className="list">
            {patches.map((p) => (
              <Link
                key={p.slug}
                href={`/patch-notes/${p.slug}`}
                className="entry"
              >
                <span className="date">{p.date}</span>
                <span className="title">{p.title}</span>
                <span className="arrow">→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
