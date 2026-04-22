import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import patchIndex from "@data/patch_notes/index.json";
import { SeoHead } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

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
  const latestPatch = patches[0];
  const title = `Dota Auto Chess Patch Notes | ${SITE_NAME}`;
  const description =
    "Read the latest Dota Auto Chess patch notes, including new relics, new items, balance changes, and update history on DAC Tools.";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Dota Auto Chess patch notes",
    description,
    about: "Dota Auto Chess patch notes",
  };

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path="/patch-notes"
        structuredData={structuredData}
      />

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .container {
          max-width: 760px;
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
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-secondary);
          margin-bottom: 16px;
        }
        .intro-links {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 28px;
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
        .latest {
          display: block;
          border: 1px solid var(--border);
          background: var(--bg-surface);
          padding: 22px;
          margin-bottom: 24px;
          color: inherit;
          text-decoration: none;
        }
        .latest:hover {
          background: var(--bg-hover);
        }
        .latest-label {
          font-size: 11px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--accent-dim);
          margin-bottom: 8px;
        }
        .latest-title {
          font-family: "Cinzel", serif;
          font-size: 22px;
          color: var(--text-primary);
          margin-bottom: 8px;
        }
        .latest-copy {
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-secondary);
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
          color: inherit;
          text-decoration: none;
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
          <p className="intro">
            Track every Dota Auto Chess update in one place, including new
            relics, new items, and major balance changes. This page is the main
            crawl path for update-related searches.
          </p>
          <div className="intro-links">
            <Link href="/relics" className="intro-link">
              Browse relics
            </Link>
            <Link href="/items" className="intro-link">
              Browse items
            </Link>
          </div>

          {latestPatch && (
            <Link href={`/patch-notes/${latestPatch.slug}`} className="latest">
              <div className="latest-label">Latest update</div>
              <div className="latest-title">{latestPatch.title}</div>
              <div className="latest-copy">
                Read the newest Dota Auto Chess patch notes and scan the latest
                changes before you browse the full archive.
              </div>
            </Link>
          )}

          <div className="list">
            {patches.map((patch) => (
              <Link
                key={patch.slug}
                href={`/patch-notes/${patch.slug}`}
                className="entry"
              >
                <span className="date">{patch.date}</span>
                <span className="title">{patch.title}</span>
                <span className="arrow">-&gt;</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
