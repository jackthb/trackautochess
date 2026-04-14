import Head from "next/head";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import unitsData from "../../data/units.json";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { PlayerGame } from "@dac/shared/types";

const UNIT_COSTS: Record<string, number> = {};
for (const [name, info] of Object.entries(unitsData.units)) {
  UNIT_COSTS[name] = (info as { cost: number }).cost;
}

interface GamePageProps {
  game: PlayerGame;
  playerName: string | null;
}

export default function GamePage({ game, playerName }: GamePageProps) {
  const displayName = playerName || game.user_id;
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
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .logo b { color: var(--accent-dim); }
        .logo img { width: 28px; height: 28px; }
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
        .match-meta {
          padding: 24px 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 14px;
          color: var(--text-muted);
        }
        .match-meta .placement {
          font-size: 18px;
          font-weight: 700;
        }
        .match-meta a {
          color: var(--text-secondary);
          transition: color 0.15s;
        }
        .match-meta a:hover {
          color: var(--text-primary);
        }
      `}</style>

      <div className="page">
        <header className="header">
          <Link href="/" className="logo">
            <img src="/logo.svg" alt="" />
            <b>DAC</b> Tools
          </Link>
          <Link href="/dashboard" className="back-link">
            ← Dashboard
          </Link>
        </header>

        <div className="container">
          <div className="match-meta">
            {game.placement && (
              <span className="placement">#{game.placement}</span>
            )}
            <span>—</span>
            <Link href={`/players/${game.user_id}`}>{displayName}</Link>
          </div>
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

async function fetchSteamName(steamId: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://steamcommunity.com/profiles/${steamId}/?xml=1`
    );
    const xml = await resp.text();
    const match = xml.match(/<steamID><!\[CDATA\[(.+?)\]\]><\/steamID>/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
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

  const playerName = data.user_id ? await fetchSteamName(data.user_id) : null;

  return { props: { game: data, playerName } };
};
