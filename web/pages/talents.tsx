import type { SupabaseClient } from "@supabase/supabase-js";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllTalents, getTierLabel } from "@/lib/talents";

interface TalentsPageProps {
  supabase: SupabaseClient | null;
}

export default function TalentsPage({ supabase }: TalentsPageProps) {
  void supabase;
  const title = `Talents | ${SITE_TITLE}`;
  const description =
    "Browse all Dota Auto Chess talent choices by round, compare branch A/B effects, and quickly cross-reference patch notes updates.";
  const talents = getAllTalents();

  return (
    <>
      <SeoHead title={title} description={description} path="/talents" />
      <style jsx>{`
        .page { max-width: 920px; margin: 0 auto; padding: var(--s-32); }
        h1 { font-family: var(--font-display); letter-spacing: var(--tr-display); text-transform: uppercase; color: var(--accent); }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--s-14); margin-top: var(--s-20); }
        .card { border: 1px solid var(--border); border-radius: var(--r-8); background: var(--bg-surface); padding: var(--s-14); }
        .meta { font-size: var(--fs-11); letter-spacing: var(--tr-upper); text-transform: uppercase; color: var(--text-muted); margin-bottom: var(--s-6); }
        .name { font-size: var(--fs-16); color: var(--text-primary); margin-bottom: var(--s-6); }
        .desc { font-size: var(--fs-13); color: var(--text-secondary); line-height: var(--lh-body); }
      `}</style>
      <div className="page">
        <h1>Talents</h1>
        <div className="grid">
          {talents.map((talent) => (
            <article className="card" key={talent.key}>
              <div className="meta">{talent.key} · {getTierLabel(talent.tier)}</div>
              <div className="name">{talent.name}</div>
              <div className="desc">{talent.description}</div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
