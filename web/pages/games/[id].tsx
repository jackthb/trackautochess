import Head from "next/head";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import unitsData from "../../data/units.json";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { Game } from "@dac/shared/types";

const UNIT_COSTS: Record<string, number> = {};
for (const [name, info] of Object.entries(unitsData.units)) {
  UNIT_COSTS[name] = (info as { cost: number }).cost;
}

interface GamePageProps {
  game: Game;
}

export default function GamePage({ game }: GamePageProps) {
  return (
    <>
      <Head>
        <title>
          {game.placement ? `#${game.placement} — ` : ""}DAC Match
        </title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: 100vh;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 40px;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(8, 9, 11, 0.9);
          backdrop-filter: blur(8px);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .logo {
          font-family: 'Cinzel', serif;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .logo b { color: var(--gold-dim); }
        .back-link {
          font-size: 13px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
          transition: color 0.15s;
        }
        .back-link:hover { color: var(--text-secondary); }
        .container {
          max-width: 1200px;
          margin: 48px auto;
          padding: 0 32px 80px;
          border: 1px solid var(--border);
        }
      `}</style>

      <div className="page">
        <header className="header">
          <Link href="/" className="logo">
            <b>DAC</b> Tools
          </Link>
          <Link href="/dashboard" className="back-link">
            ← Dashboard
          </Link>
        </header>

        <div className="container">
          <GameRowDisplay
            game={game}
            unitCosts={UNIT_COSTS}
            iconUrl={(type, stem) => `/icons/${type}/${stem}.png`}
          />
        </div>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { id } = context.params!;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return { notFound: true };

  const supabase = createClient(url, key);
  const { data } = await supabase
    .from("games")
    .select("*")
    .eq("id", id)
    .single();

  if (!data) return { notFound: true };

  return { props: { game: data } };
};
