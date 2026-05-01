import type { SupabaseClient } from "@supabase/supabase-js";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllTalents, getTierLabel, type DisplayTalent } from "@/lib/talents";

interface TalentsPageProps {
  supabase: SupabaseClient | null;
}

export default function TalentsPage({ supabase }: TalentsPageProps) {
  void supabase;
  const title = `Talents | ${SITE_TITLE}`;
  const description =
    "Browse all Dota Auto Chess talent choices by round, compare branch A/B effects, and quickly cross-reference patch notes updates.";

  const talents = getAllTalents();

  // Group by tier, preserving A/B order within each tier
  const tiers = new Map<number, { A: DisplayTalent | null; B: DisplayTalent | null }>();
  for (const t of talents) {
    if (!tiers.has(t.tier)) tiers.set(t.tier, { A: null, B: null });
    const entry = tiers.get(t.tier)!;
    if (t.branch === "A") entry.A = t;
    else entry.B = t;
  }
  const tierRows = [...tiers.entries()].sort(([a], [b]) => a - b);

  return (
    <>
      <SeoHead title={title} description={description} path="/talents" />
      <style jsx>{`
        .page { max-width: 960px; margin: 0 auto; padding: var(--s-32); }
        h1 {
          font-family: var(--font-display);
          letter-spacing: var(--tr-display);
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: var(--s-32);
        }
        .tier-block { margin-bottom: var(--s-32); }
        .tier-label {
          font-size: var(--fs-11);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: var(--s-10);
        }
        .columns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--s-14);
        }
        .col-header {
          font-size: var(--fs-11);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
          padding-bottom: var(--s-6);
          border-bottom: 1px solid var(--border);
          margin-bottom: var(--s-10);
        }
        .card {
          border: 1px solid var(--border);
          border-radius: var(--r-8);
          background: var(--bg-surface);
          padding: var(--s-14);
        }
        .name { font-size: var(--fs-16); color: var(--text-primary); margin-bottom: var(--s-6); }
        .desc { font-size: var(--fs-13); color: var(--text-secondary); line-height: var(--lh-body); }
        .empty { color: var(--text-muted); font-size: var(--fs-13); font-style: italic; }
      `}</style>
      <div className="page">
        <h1>Talents</h1>

        {/* Column headers — rendered once above the first tier */}
        <div className="columns" style={{ marginBottom: "var(--s-6)" }}>
          <div className="col-header">A</div>
          <div className="col-header">B</div>
        </div>

        {tierRows.map(([tier, { A, B }]) => (
          <div className="tier-block" key={tier}>
            <div className="tier-label">{getTierLabel(tier)}</div>
            <div className="columns">
              {A ? (
                <article className="card">
                  <div className="name">{A.name}</div>
                  <div className="desc">{A.description}</div>
                </article>
              ) : (
                <div className="empty">—</div>
              )}
              {B ? (
                <article className="card">
                  <div className="name">{B.name}</div>
                  <div className="desc">{B.description}</div>
                </article>
              ) : (
                <div className="empty">—</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
