import fs from "fs";
import path from "path";
import Head from "next/head";
import type { GetStaticPaths, GetStaticProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NavBar } from "../../components/NavBar";
import patchIndex from "@data/patch_notes/index.json";

type EntryKind =
  | "added"
  | "removed"
  | "buff"
  | "nerf"
  | "change"
  | "rework"
  | "fix";

interface PatchEntry {
  kind: EntryKind;
  name: string;
  detail: string;
}

interface PatchSection {
  heading: string;
  entries: PatchEntry[];
}

interface Patch {
  date: string;
  title: string;
  source?: string;
  workshop_url?: string;
  flavor?: string;
  summary?: string;
  sections: PatchSection[];
}

interface IndexPatch {
  date: string;
  title: string;
  slug: string;
}

const KIND_COLOR: Record<EntryKind, string> = {
  added: "var(--green-bright)",
  removed: "var(--red-bright)",
  buff: "var(--green-bright)",
  nerf: "var(--red-bright)",
  change: "var(--text-secondary)",
  rework: "var(--gold)",
  fix: "var(--text-secondary)",
};

const KIND_LABEL: Record<EntryKind, string> = {
  added: "NEW",
  removed: "REMOVED",
  buff: "BUFF",
  nerf: "NERF",
  change: "CHANGE",
  rework: "REWORK",
  fix: "FIX",
};

interface PatchPageProps {
  supabase: SupabaseClient | null;
  patch: Patch;
}

export default function PatchDetailPage({ supabase, patch }: PatchPageProps) {
  return (
    <>
      <Head>
        <title>{patch.title} — Patch Notes — DAC Tools</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: 100vh;
        }
        .container {
          max-width: 760px;
          margin: 0 auto;
          padding: 40px 32px 80px;
        }
        .back {
          display: inline-block;
          font-size: 12px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 20px;
          transition: color 0.15s;
        }
        .back:hover {
          color: var(--text-secondary);
        }
        .date {
          font-size: 12px;
          letter-spacing: 2px;
          color: var(--text-muted);
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .title {
          font-family: "Cinzel", serif;
          font-size: 36px;
          font-weight: 700;
          letter-spacing: 5px;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 24px;
        }
        .source-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 24px;
        }
        .source {
          display: inline-block;
          font-size: 11px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          border: 1px solid var(--border);
          padding: 6px 12px;
          transition: all 0.15s;
        }
        .source:hover {
          color: var(--text-secondary);
          border-color: var(--text-muted);
        }
        .summary {
          padding: 20px 24px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          margin-bottom: 32px;
        }
        .summary-line {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-primary);
          padding: 8px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .summary-line:last-child,
        .summary-line:has(+ .summary-footer) {
          border-bottom: none;
        }
        .summary-line.bullet {
          position: relative;
          padding-left: 20px;
        }
        .summary-line.bullet::before {
          content: "●";
          position: absolute;
          left: 0;
          top: 8px;
          color: var(--accent-dim);
          font-size: 8px;
          line-height: 1.6;
        }
        .summary-footer {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid var(--border-subtle);
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .summary-footer a {
          color: var(--accent-dim);
          text-decoration: underline;
        }
        .summary-footer a:hover {
          color: var(--accent);
        }
        .flavor {
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-secondary);
          font-style: italic;
          padding: 18px 20px;
          border-left: 2px solid var(--accent-dim);
          background: var(--bg-surface);
          margin-bottom: 40px;
        }
        .section {
          margin-bottom: 36px;
        }
        .section-heading {
          font-family: "Cinzel", serif;
          font-size: 15px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-primary);
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 16px;
        }
        .entry {
          display: grid;
          grid-template-columns: 90px 1fr;
          gap: 16px;
          padding: 12px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .entry:last-child {
          border-bottom: none;
        }
        .kind {
          font-size: 10px;
          letter-spacing: 1.5px;
          font-weight: 600;
          padding-top: 2px;
        }
        .entry-name {
          font-size: 14px;
          color: var(--text-primary);
          font-weight: 500;
          margin-bottom: 4px;
        }
        .entry-detail {
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-secondary);
        }
      `}</style>

      <div className="page">
        <NavBar supabase={supabase} />
        <div className="container">
          <a href="/patch-notes" className="back">
            ← All patches
          </a>
          <div className="date">{patch.date}</div>
          <h1 className="title">{patch.title}</h1>
          <div className="source-row">
            {patch.source && (
              <a
                className="source"
                href={patch.source}
                target="_blank"
                rel="noreferrer"
              >
                Official notes ↗
              </a>
            )}
            {patch.workshop_url && (
              <a
                className="source"
                href={patch.workshop_url}
                target="_blank"
                rel="noreferrer"
              >
                Workshop changelog ↗
              </a>
            )}
          </div>
          {patch.flavor && <div className="flavor">{patch.flavor}</div>}

          {patch.sections.length === 0 && patch.summary && (
            <div className="summary">
              {patch.summary
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                // Drop the repeated title line and Drodo's trailing "click the
                // title link" footer — we already render both via the big
                // title and the "Official notes" button.
                .filter(
                  (l) =>
                    l !== patch.title &&
                    !/^click the title link/i.test(l)
                )
                .map((line, i) => {
                  const isBullet = /^[●•·-]/.test(line);
                  return (
                    <div
                      key={i}
                      className={"summary-line" + (isBullet ? " bullet" : "")}
                    >
                      {isBullet ? line.replace(/^[●•·-]\s*/, "") : line}
                    </div>
                  );
                })}
              {patch.source && (
                <div className="summary-footer">
                  Full prose lives in the{" "}
                  <a href={patch.source} target="_blank" rel="noreferrer">
                    official notes
                  </a>
                  .
                </div>
              )}
            </div>
          )}

          {patch.sections.map((section) => (
            <div key={section.heading} className="section">
              <div className="section-heading">{section.heading}</div>
              {section.entries.map((entry, i) => (
                <div key={i} className="entry">
                  <span
                    className="kind"
                    style={{ color: KIND_COLOR[entry.kind] }}
                  >
                    {KIND_LABEL[entry.kind]}
                  </span>
                  <div>
                    <div className="entry-name">{entry.name}</div>
                    <div className="entry-detail">{entry.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: (patchIndex.patches as IndexPatch[]).map((p) => ({
      params: { slug: p.slug },
    })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug as string;
  const filePath = path.join(process.cwd(), "..", "data", "patch_notes", `${slug}.json`);
  const patch: Patch = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return { props: { patch } };
};
