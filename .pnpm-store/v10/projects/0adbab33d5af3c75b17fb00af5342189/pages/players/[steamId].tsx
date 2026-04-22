import Head from "next/head";
import Link from "next/link";
import { useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import unitsData from "@data/units.json";
import unitsFullData from "@data/units_full.json";
import synergiesData from "@data/synergies.json";
import relicsData from "@data/relics.json";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { PlayerGame, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";
import {
  fetchSteamProfile,
  resolveSteamId,
  steamProfileUrl,
  type SteamProfile,
} from "../../lib/steam";

const UNIT_COSTS: Record<string, number> = {};
for (const [name, info] of Object.entries(unitsData.units)) {
  UNIT_COSTS[name] = (info as { cost: number }).cost;
}
for (const [alias, canonical] of Object.entries(
  (unitsData as { aliases?: Record<string, string> }).aliases ?? {}
)) {
  if (UNIT_COSTS[canonical] !== undefined) {
    UNIT_COSTS[alias] = UNIT_COSTS[canonical];
  }
}
const UNITS_FULL = unitsFullData as Record<string, UnitFullInfo>;
const SYNERGIES_DATA = synergiesData as Record<string, SynergyInfo>;
const RELICS_DATA = (relicsData as any).relics as Record<string, RelicInfo>;

const TIER_NAMES = ["Pawn", "Knight", "Bishop", "Rook", "King"];
function mmrLevelToTier(level: number | null): string {
  if (level == null) return "";
  const tierIdx = Math.floor(level / 9);
  if (tierIdx >= TIER_NAMES.length) return "Queen";
  return `${TIER_NAMES[tierIdx]} ${(level % 9) + 1}`;
}

interface SeasonSnapshot {
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
}

interface PlayerPageProps {
  steamId: string;
  steamProfile: SteamProfile;
  games: PlayerGame[];
  drodo: {
    mmr: number | null;
    max_mmr: number | null;
    mmr_level: number | null;
    season: string | null;
  } | null;
  seasons: SeasonSnapshot[];
  supabase: SupabaseClient | null;
}

export default function PlayerPage({
  steamId,
  steamProfile,
  games,
  drodo,
  seasons,
  supabase,
}: PlayerPageProps) {
  const displayName = steamProfile.name || steamId;
  const profileUrl = steamProfileUrl(steamId, steamProfile.customUrl);

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
          min-height: calc(100vh - var(--nav-height));
        }
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
        .section-title {
          font-size: 13px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0 0 16px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .seasons-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border);
          margin-bottom: 40px;
        }
        .season-card { background: var(--bg-surface); padding: 20px; }
        .season-label {
          font-size: 13px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 10px;
        }
        .season-mmr {
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 3px;
        }
        .season-meta { font-size: 13px; color: var(--text-muted); }
        .season-peak { color: var(--gold); }
        .empty-state {
          text-align: center;
          padding: 80px 32px;
          color: var(--text-muted);
          font-size: 16px;
          background: var(--bg-surface);
        }
      `}</style>

      <div className="page">
        <div className="dashboard">
          <div className="player-header">
            <div className="player-name">{displayName}</div>
            <div className="player-meta">
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {steamProfile.customUrl
                  ? `steamcommunity.com/id/${steamProfile.customUrl}`
                  : `Steam ID: ${steamId}`}
              </a>
              {drodo && drodo.mmr_level != null && (
                <>
                  {" \u00B7 "}
                  {mmrLevelToTier(drodo.mmr_level)}
                </>
              )}
            </div>
          </div>

          {(stats || (drodo && (drodo.mmr != null || drodo.max_mmr != null))) && (
            <div className="stats-bar">
              {stats && (
                <>
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
                </>
              )}
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

          {seasons.length > 1 && (
            <>
              <div className="section-title">Season History</div>
              <div className="seasons-grid">
                {[...seasons].reverse().map((s) => (
                  <div key={s.season} className="season-card">
                    <div className="season-label">{s.season.toUpperCase()}</div>
                    {s.mmr != null ? (
                      <div className="season-mmr">{s.mmr}</div>
                    ) : (
                      <div className="season-mmr" style={{ color: "var(--text-muted)" }}>—</div>
                    )}
                    {s.max_mmr != null && (
                      <div className="season-meta">
                        Peak <span className="season-peak">{s.max_mmr}</span>
                      </div>
                    )}
                    {s.games_played != null && (
                      <div className="season-meta">{s.games_played} games</div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {games.length === 0 ? (
            <div className="table-wrap">
              <div className="empty-state">
                No matches recorded for this player.
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <div className="table-header">
                <div className="th">#</div>
                <div className="th">Lineup</div>
                <div className="th">Rank</div>
                <div className="th">W &ndash; L</div>
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

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { steamId: rawSteamId } = context.params!;
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return { notFound: true };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { notFound: true };

  const supabase = createClient(url, key);

  // Accept numeric SteamID64 or a vanity slug (/id/agit142). Redirect slugs to
  // the canonical numeric URL once we resolve them via Steam's XML API.
  let steamId = rawSteamId;
  if (!/^\d+$/.test(rawSteamId)) {
    const resolved = await resolveSteamId(rawSteamId, supabase);
    if (!resolved) return { notFound: true };
    return {
      redirect: {
        destination: `/players/${resolved}`,
        permanent: false,
      },
    };
  }

  const [gamesResult, steamProfile] = await Promise.all([
    supabase
      .from("games")
      .select("*")
      .eq("user_id", steamId)
      .order("played_at", { ascending: false }),
    fetchSteamProfile(steamId, supabase),
  ]);

  // Fetch drodo profile and season history (using service key for cached data)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let drodo = null;
  let seasons: SeasonSnapshot[] = [];
  if (serviceKey) {
    const adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [profileResult, seasonsResult] = await Promise.all([
      adminClient
        .from("drodo_profiles")
        .select("mmr, max_mmr, mmr_level, season")
        .eq("steam_id", steamId)
        .single(),
      adminClient
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played")
        .eq("steam_id", steamId)
        .order("season", { ascending: true }),
    ]);
    if (profileResult.data) drodo = profileResult.data;
    if (seasonsResult.data) seasons = seasonsResult.data;

    // Cache miss? Pull fresh from Drodo and re-fetch — this lets newly looked
    // up players (e.g. pasted Steam URLs) see their MMR immediately instead of
    // waiting for a manual refresh.
    if (!drodo) {
      try {
        const proto = context.req.headers["x-forwarded-proto"] ?? "http";
        const host = context.req.headers.host;
        if (host) {
          const base = `${proto}://${host}`;
          const resp = await fetch(`${base}/api/drodo/${steamId}`);
          if (resp.ok) {
            const data = await resp.json();
            drodo = {
              mmr: data.mmr ?? null,
              max_mmr: data.max_mmr ?? null,
              mmr_level: data.mmr_level ?? null,
              season: data.season ?? null,
            };
            if (Array.isArray(data.seasons)) seasons = data.seasons;
          }
        }
      } catch {
        // Drodo API unreachable — fall through with no stats.
      }
    }
  }

  return {
    props: {
      steamId,
      steamProfile,
      games: (gamesResult.data as PlayerGame[]) || [],
      drodo,
      seasons,
    },
  };
};
