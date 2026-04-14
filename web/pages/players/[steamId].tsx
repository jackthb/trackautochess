import Head from "next/head";
import Link from "next/link";
import { useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import unitsData from "../../data/units.json";
import unitsFullData from "@data/units_full.json";
import synergiesData from "../../data/synergies.json";
import relicsData from "../../data/relics.json";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { PlayerGame, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";

const UNIT_COSTS: Record<string, number> = {};
for (const [name, info] of Object.entries(unitsData.units)) {
  UNIT_COSTS[name] = (info as { cost: number }).cost;
}
const UNITS_FULL = unitsFullData as Record<string, UnitFullInfo>;
const SYNERGIES_DATA = synergiesData as Record<string, SynergyInfo>;
const RELICS_DATA = (relicsData as any).relics as Record<string, RelicInfo>;

const TIER_NAMES = ["Pawn", "Knight", "Rook", "Bishop", "King", "Queen"];
function mmrLevelToTier(level: number | null): string {
  if (level == null) return "";
  const tier = TIER_NAMES[Math.floor(level / 3)] ?? "Queen";
  const sub = (level % 3) + 1;
  return `${tier} ${sub}`;
}

interface PlayerPageProps {
  steamId: string;
  steamName: string | null;
  games: PlayerGame[];
  drodo: {
    mmr: number | null;
    max_mmr: number | null;
    mmr_level: number | null;
    season: string | null;
  } | null;
}

export default function PlayerPage({
  steamId,
  steamName,
  games,
  drodo,
}: PlayerPageProps) {
  const displayName = steamName || steamId;

  const stats = useMemo(() => {
    if (!games.length) return null;
    const placements = games.map((g) => parseInt(g.placement) || 0);
    const avg = placements.reduce((a, b) => a + b, 0) / placements.length;
    const top4 = placements.filter((p) => p >= 1 && p <= 4).length;
    const top1 = placements.filter((p) => p === 1).length;
    return {
      total: games.length,
      avg: avg.toFixed(1),
      top4pct: ((top4 / games.length) * 100).toFixed(0),
      top1,
    };
  }, [games]);

  return (
    <>
      <Head>
        <title>{displayName} — DAC Tools</title>
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
          font-family: "Cinzel", serif;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-secondary);
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .logo b {
          color: var(--accent-dim);
        }
        .logo img { width: 28px; height: 28px; }
        .dashboard {
          max-width: 1200px;
          margin: 0 auto;
          padding: 40px 32px 80px;
        }
        .player-header {
          margin-bottom: 32px;
        }
        .player-name {
          font-family: "Cinzel", serif;
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }
        .player-meta {
          font-size: 13px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .player-meta a {
          color: var(--text-muted);
          transition: color 0.15s;
        }
        .player-meta a:hover {
          color: var(--text-secondary);
        }
        .stats-bar {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border);
          margin-bottom: 40px;
        }
        .stat-cell {
          background: var(--bg-surface);
          padding: 24px 20px;
          text-align: center;
        }
        .stat-value {
          font-size: 32px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 6px;
        }
        .stat-value.gold {
          color: var(--gold);
        }
        .stat-value.green {
          color: var(--green-bright);
        }
        .stat-label {
          font-size: 13px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .table-wrap {
          border: 1px solid var(--border);
          overflow: hidden;
        }
        .table-header {
          display: grid;
          grid-template-columns: 72px 1fr 120px 80px 60px 120px 100px;
          padding: 0 20px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border);
        }
        .th {
          font-size: 13px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 14px 6px;
        }
        .game-entry {
          border-bottom: 1px solid var(--border-subtle);
        }
        .game-entry:last-child {
          border-bottom: none;
        }
        .empty-state {
          text-align: center;
          padding: 80px 32px;
          color: var(--text-muted);
          font-size: 16px;
          background: var(--bg-surface);
        }
      `}</style>

      <div className="page">
        <header className="header">
          <Link href="/" className="logo">
            <img src="/logo.svg" alt="" />
            <b>DAC</b> Tools
          </Link>
        </header>

        <div className="dashboard">
          <div className="player-header">
            <div className="player-name">{displayName}</div>
            <div className="player-meta">
              Steam ID: {steamId}
              {" · "}
              <a
                href={`https://steamcommunity.com/profiles/${steamId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Steam Profile
              </a>
              {drodo && drodo.mmr_level != null && (
                <>
                  {" · "}
                  {mmrLevelToTier(drodo.mmr_level)}
                </>
              )}
            </div>
          </div>

          {stats && (
            <div className="stats-bar">
              <div className="stat-cell">
                <div className="stat-value">{stats.total}</div>
                <div className="stat-label">Games</div>
              </div>
              <div className="stat-cell">
                <div className="stat-value gold">{stats.avg}</div>
                <div className="stat-label">Avg Place</div>
              </div>
              <div className="stat-cell">
                <div className="stat-value green">{stats.top4pct}%</div>
                <div className="stat-label">Top 4 Rate</div>
              </div>
              <div className="stat-cell">
                <div className="stat-value gold">{stats.top1}</div>
                <div className="stat-label">Wins</div>
              </div>
              {drodo && drodo.mmr != null && (
                <div className="stat-cell">
                  <div className="stat-value">{drodo.mmr}</div>
                  <div className="stat-label">
                    {drodo.mmr_level != null
                      ? mmrLevelToTier(drodo.mmr_level)
                      : "MMR"}
                  </div>
                </div>
              )}
              {drodo && drodo.max_mmr != null && (
                <div className="stat-cell">
                  <div className="stat-value gold">{drodo.max_mmr}</div>
                  <div className="stat-label">Peak MMR</div>
                </div>
              )}
            </div>
          )}

          {games.length === 0 ? (
            <div className="table-wrap">
              <div className="empty-state">No matches recorded for this player.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <div className="table-header">
                <div className="th">#</div>
                <div className="th">Lineup</div>
                <div className="th">Rank</div>
                <div className="th">W – L</div>
                <div className="th">Lv</div>
                <div className="th">Relic</div>
                <div className="th">Date</div>
              </div>
              {games.map((g) => (
                <div key={g.id} className="game-entry">
                  <Link
                    href={`/games/${g.id}`}
                    style={{ display: "block", color: "inherit" }}
                  >
                    <GameRowDisplay
                      game={g}
                      unitCosts={UNIT_COSTS}
                      unitsFull={UNITS_FULL}
                      synergiesData={SYNERGIES_DATA}
                      relicsData={RELICS_DATA}
                      iconUrl={(type, stem) => `/icons/${type}/${stem}.png`}
                      shareUrl={`/games/${g.id}`}
                    />
                  </Link>
                </div>
              ))}
            </div>
          )}
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
  const { steamId } = context.params!;
  if (
    !steamId ||
    typeof steamId !== "string" ||
    !/^\d+$/.test(steamId)
  ) {
    return { notFound: true };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { notFound: true };

  const supabase = createClient(url, key);

  const [gamesResult, steamName] = await Promise.all([
    supabase
      .from("games")
      .select("*")
      .eq("user_id", steamId)
      .order("played_at", { ascending: false }),
    fetchSteamName(steamId),
  ]);

  // Fetch drodo profile if available (using service key for cached data)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let drodo = null;
  if (serviceKey) {
    const adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await adminClient
      .from("drodo_profiles")
      .select("mmr, max_mmr, mmr_level, season")
      .eq("steam_id", steamId)
      .single();
    if (data) drodo = data;
  }

  return {
    props: {
      steamId,
      steamName,
      games: (gamesResult.data as PlayerGame[]) || [],
      drodo,
    },
  };
};
