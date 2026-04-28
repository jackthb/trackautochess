import Head from "next/head";
import Link from "next/link";
import { useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { absoluteUrl, getRequestSiteUrl } from "@/lib/site";
import unitsData from "@data/units.json";
import unitsFullData from "@data/units_full.json";
import synergiesData from "@data/synergies.json";
import relicsData from "@data/relics.json";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { PlayerGame, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";
import { mmrToRank } from "@dac/shared/game-utils";
import {
  fetchSteamProfile,
  resolveSteamInput,
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
const DRODO_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function isFreshDrodoCache(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return false;
  const fetchedTime = new Date(fetchedAt).getTime();
  return Number.isFinite(fetchedTime) && Date.now() - fetchedTime < DRODO_CACHE_TTL_MS;
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
    season_games: number | null;
    candy: number | null;
    chicken_count: number | null;
  } | null;
  seasons: SeasonSnapshot[];
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  supabase: SupabaseClient | null;
}

export default function PlayerPage({
  steamId,
  steamProfile,
  games,
  drodo,
  seasons,
  ogImageUrl,
  canonicalUrl,
  supabase,
}: PlayerPageProps) {
  const displayName = steamProfile.name || steamId;
  const profileUrl = steamProfileUrl(steamId, steamProfile.customUrl);
  const title = `${displayName} - DAC Tools`;
  const description = drodo?.mmr
    ? `${displayName} is ${mmrToRank(drodo.mmr)} at ${drodo.mmr.toLocaleString("en-US")} MMR.`
    : `Dota Auto Chess profile for ${displayName}.`;

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
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="profile" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
        {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
        {ogImageUrl && <meta property="og:image" content={ogImageUrl} />}
        {ogImageUrl && <meta name="twitter:image" content={ogImageUrl} />}
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
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 32px;
        }
        .player-heading { min-width: 0; }
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
        .refresh-link {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 12px;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--text-muted);
          border: 1px solid var(--border);
          border-radius: var(--r-3);
          padding: 8px 12px;
          transition: color 0.15s, border-color 0.15s;
        }
        .refresh-link:hover {
          color: var(--text-secondary);
          border-color: var(--text-muted);
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
        @media (max-width: 620px) {
          .player-header {
            flex-direction: column;
          }
        }
      `}</style>

      <div className="page">
        <div className="dashboard">
          <div className="player-header">
            <div className="player-heading">
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
                {drodo && drodo.mmr != null && (
                  <>
                    {" \u00B7 "}
                    {mmrToRank(drodo.mmr)}
                  </>
                )}
              </div>
            </div>
            <Link href={`/players/${steamId}?refresh=1`} className="refresh-link">
              Refresh MMR
            </Link>
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
                    {mmrToRank(drodo.mmr) || "MMR"}
                  </div>
                </div>
              )}
              {drodo && drodo.max_mmr != null && (
                <div className="stat-cell">
                  <div className="stat-value gold">{drodo.max_mmr}</div>
                  <div className="stat-label">Peak MMR</div>
                </div>
              )}
              {drodo && drodo.season_games != null && (
                <div className="stat-cell">
                  <div className="stat-value">{drodo.season_games}</div>
                  <div className="stat-label">Season Games</div>
                </div>
              )}
              {drodo && drodo.candy != null && (
                <div className="stat-cell">
                  <div className="stat-value gold">{drodo.candy}</div>
                  <div className="stat-label">Candies</div>
                </div>
              )}
              {drodo && drodo.chicken_count != null && (
                <div className="stat-cell">
                  <div className="stat-value gold">{drodo.chicken_count}</div>
                  <div className="stat-label">Wins</div>
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
  const forceRefresh = context.query.refresh === "1";
  const supabase = url && key ? createClient(url, key) : null;
  const baseUrl = getRequestSiteUrl(context.req.headers);

  // Accept numeric Steam IDs, vanity slugs, or pasted Steam community URLs.
  // Redirect anything non-canonical to the numeric player route once resolved.
  const steamId = await resolveSteamInput(rawSteamId, supabase ?? undefined, {
    persist: false,
  });
  if (!steamId) {
    return { notFound: true };
  }
  if (steamId !== rawSteamId) {
    return {
      redirect: {
        destination: `/players/${steamId}`,
        permanent: false,
      },
    };
  }

  const gamesResult = supabase
    ? await supabase
        .from("games")
        .select("*")
        .eq("user_id", steamId)
        .order("played_at", { ascending: false })
    : { data: [] };

  // Fetch drodo profile and season history (using service key for cached data)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let drodo = null;
  let staleDrodo = null;
  let seasons: SeasonSnapshot[] = [];
  if (url && serviceKey && !forceRefresh) {
    const adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [profileResult, seasonsResult] = await Promise.all([
      adminClient
        .from("drodo_profiles")
        .select("mmr, max_mmr, mmr_level, season, season_games, candy, chicken_count, fetched_at")
        .eq("steam_id", steamId)
        .single(),
      adminClient
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played")
        .eq("steam_id", steamId)
        .order("season", { ascending: true }),
    ]);
    if (profileResult.data) {
      staleDrodo = profileResult.data;
      if (
        isFreshDrodoCache(
          (profileResult.data as { fetched_at?: string }).fetched_at
        )
      ) {
        drodo = profileResult.data;
      }
    }
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
              season_games: data.season_games ?? null,
              candy: data.candy ?? null,
              chicken_count: data.chicken_count ?? null,
            };
            if (Array.isArray(data.seasons)) seasons = data.seasons;
          }
        }
      } catch {
        // Drodo API unreachable — fall through with no stats.
      }
    }
  }

  if (!drodo && !staleDrodo) {
    try {
      const proto = context.req.headers["x-forwarded-proto"] ?? "http";
      const host = context.req.headers.host;
      if (host) {
        const base = `${proto}://${host}`;
        const resp = await fetch(
          `${base}/api/drodo/${steamId}${forceRefresh ? "?refresh=1" : ""}`
        );
        if (resp.ok) {
          const data = await resp.json();
          drodo = {
            mmr: data.mmr ?? null,
            max_mmr: data.max_mmr ?? null,
            mmr_level: data.mmr_level ?? null,
            season: data.season ?? null,
            season_games: data.season_games ?? null,
            candy: data.candy ?? null,
            chicken_count: data.chicken_count ?? null,
          };
          if (Array.isArray(data.seasons)) seasons = data.seasons;
        }
      }
    } catch {
      // Drodo API unreachable; still render the Steam profile shell.
    }
  }

  // Keep rendering using stale cached Drodo stats if the refresh path fails.
  if (!drodo && staleDrodo) {
    drodo = staleDrodo;
  }

  const hasGames = Boolean(gamesResult.data?.length);

  const shouldPersistSteamProfile = hasGames || drodo !== null || seasons.length > 0;
  const steamProfile = await fetchSteamProfile(steamId, supabase ?? undefined, {
    persist: shouldPersistSteamProfile,
  });

  return {
    props: {
      steamId,
      steamProfile,
      games: (gamesResult.data as PlayerGame[]) || [],
      drodo,
      seasons,
      ogImageUrl: absoluteUrl(`/api/og/player/${steamId}`, baseUrl),
      canonicalUrl: absoluteUrl(`/players/${steamId}`, baseUrl),
    },
  };
};
