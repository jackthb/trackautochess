import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import { absoluteUrl, getRequestSiteUrl, SITE_NAME } from "@/lib/site";
import unitsData from "@data/units.json";
import unitsFullData from "@data/units_full.json";
import synergiesData from "@data/synergies.json";
import relicsData from "@data/relics.json";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { PlayerGame, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";
import { mmrToRank } from "@dac/shared/game-utils";
import { StatsGrid, type StatItem } from "@/components/StatsGrid";
import {
  fetchSteamProfile,
  playerProfilePath,
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
const USER_DRODO_SELECT = [
  "drodo_mmr",
  "drodo_max_mmr",
  "drodo_mmr_level",
  "drodo_season",
  "drodo_season_games",
  "drodo_candy",
  "drodo_chicken_count",
  "drodo_last_fetched_at",
  "drodo_profile_missing",
].join(", ");
const DRODO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface SeasonSnapshot {
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
}

interface CachedUserDrodoRow {
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_candy: number | null;
  drodo_chicken_count: number | null;
  drodo_last_fetched_at: string | null;
  drodo_profile_missing: boolean | null;
}

interface PlayerPageProps {
  supabase?: SupabaseClient | null;
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
  drodoProfileMissing: boolean;
  drodoLastFetchedAt: string | null;
  forceRefresh: boolean;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
}

export default function PlayerPage({
  steamId,
  steamProfile,
  games,
  drodo: initialDrodo,
  seasons: initialSeasons,
  drodoProfileMissing: initialDrodoProfileMissing,
  drodoLastFetchedAt: initialDrodoLastFetchedAt,
  forceRefresh,
  ogImageUrl,
  canonicalUrl,
  supabase,
}: PlayerPageProps) {
  const router = useRouter();
  const [drodo, setDrodo] = useState(initialDrodo);
  const [seasons, setSeasons] = useState(initialSeasons);
  const [drodoProfileMissing, setDrodoProfileMissing] = useState(
    initialDrodoProfileMissing
  );
  const [drodoLastFetchedAt, setDrodoLastFetchedAt] = useState(
    initialDrodoLastFetchedAt
  );
  const displayName = steamProfile.name || steamProfile.customUrl || steamId;
  const profileUrl = steamProfileUrl(steamId, steamProfile.customUrl);
  const title = `${displayName} - ${SITE_NAME}`;
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


  const statItems = useMemo<StatItem[]>(() => {
    const items: StatItem[] = [];
    if (stats) {
      items.push(
        { key: "games", value: stats.total, label: "Games", source: "tracked" },
        { key: "avg", value: stats.avg, label: "Avg Place", tone: "gold", source: "tracked" },
        { key: "top4", value: `${stats.top4pct}%`, label: "Top 4 Rate", tone: "green", source: "tracked" },
        { key: "wins", value: stats.top1, label: "Wins", tone: "gold", source: "tracked" },
      );
    }
    if (drodo?.mmr != null) items.push({ key: "drodo-mmr", value: drodo.mmr, label: mmrToRank(drodo.mmr) || "MMR", source: "drodo" });
    if (drodo?.max_mmr != null) items.push({ key: "drodo-peak", value: drodo.max_mmr, label: "Peak MMR", tone: "gold", source: "drodo" });
    if (drodo?.season_games != null) items.push({ key: "drodo-season-games", value: drodo.season_games, label: "Season Games", source: "drodo" });
    if (drodo?.candy != null) items.push({ key: "drodo-candy", value: drodo.candy, label: "Candies", tone: "gold", source: "drodo" });
    if (drodo?.chicken_count != null) items.push({ key: "drodo-chickens", value: drodo.chicken_count, label: "Chickens (Wins)", tone: "gold", source: "drodo" });
    return items;
  }, [stats, drodo]);

  // TODO: ingest total matches / avg rank / wins / preferred lineup / max damage from history pages for server-side season snapshots.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const ownSteamId = user.user_metadata?.steam_id;
      if (ownSteamId && ownSteamId === steamId) {
        router.replace("/dashboard");
      }
    });
  }, [supabase, steamId, router]);

  useEffect(() => {
    const fetchedTime = drodoLastFetchedAt
      ? new Date(drodoLastFetchedAt).getTime()
      : NaN;
    const hasFreshCache =
      Number.isFinite(fetchedTime) &&
      Date.now() - fetchedTime < DRODO_CACHE_TTL_MS;
    if (!forceRefresh && hasFreshCache) return;

    let cancelled = false;
    const refresh = forceRefresh ? "?refresh=1" : "";
    fetch(`/api/drodo/${encodeURIComponent(steamId)}${refresh}`)
      .then(async (resp) => {
        const data = await resp.json().catch(() => null);
        if (resp.ok) return data;
        if (resp.status === 404 && !cancelled) {
          setDrodoProfileMissing(true);
          if (typeof data?.fetched_at === "string") {
            setDrodoLastFetchedAt(data.fetched_at);
          }
        }
        return null;
      })
      .then((data) => {
        if (!data || cancelled) return;
        setDrodoProfileMissing(false);
        setDrodo({
          mmr: data.mmr ?? null,
          max_mmr: data.max_mmr ?? null,
          mmr_level: data.mmr_level ?? null,
          season: data.season ?? null,
          season_games: data.season_games ?? null,
          candy: data.candy ?? null,
          chicken_count: data.chicken_count ?? null,
        });
        if (typeof data.fetched_at === "string") {
          setDrodoLastFetchedAt(data.fetched_at);
        }
        if (Array.isArray(data.seasons)) setSeasons(data.seasons);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [drodoLastFetchedAt, forceRefresh, steamId]);

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
            <Link
              href={`${playerProfilePath(steamId, steamProfile.customUrl)}?refresh=1`}
              className="refresh-link"
            >
              Refresh MMR
            </Link>
          </div>

          {drodoProfileMissing && !drodo && (
            <div className="table-wrap" style={{ marginBottom: 32 }}>
              <div className="empty-state">
                No public Auto Chess stats found for this Steam profile.
              </div>
            </div>
          )}

          {statItems.length > 0 && <StatsGrid items={statItems} />}

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

  // Accept numeric Steam IDs or vanity slugs. Keep vanity slugs in the URL
  // when present; they are the preferred public profile route.
  const steamId = await resolveSteamInput(rawSteamId, supabase ?? undefined, {
    persist: false,
  });
  if (!steamId) {
    return { notFound: true };
  }

  // Fetch cached Drodo profile and season history from public Supabase rows.
  let drodo = null;
  let drodoProfileMissing = false;
  let drodoLastFetchedAt = null;
  let seasons: SeasonSnapshot[] = [];
  if (supabase && !forceRefresh) {
    const [profileResult, seasonsResult] = await Promise.all([
      supabase
        .from("users")
        .select(USER_DRODO_SELECT)
        .eq("steam_id", steamId)
        .maybeSingle<CachedUserDrodoRow>(),
      supabase
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played")
        .eq("steam_id", steamId)
        .order("season", { ascending: true }),
    ]);
    if (profileResult.data) {
      drodoProfileMissing = Boolean(profileResult.data.drodo_profile_missing);
      drodoLastFetchedAt = profileResult.data.drodo_last_fetched_at;
      if (profileResult.data.drodo_last_fetched_at && !drodoProfileMissing) {
        drodo = {
          mmr: profileResult.data.drodo_mmr,
          max_mmr: profileResult.data.drodo_max_mmr,
          mmr_level: profileResult.data.drodo_mmr_level,
          season: profileResult.data.drodo_season,
          season_games: profileResult.data.drodo_season_games,
          candy: profileResult.data.drodo_candy,
          chicken_count: profileResult.data.drodo_chicken_count,
        };
      }
    }
    if (seasonsResult.data) seasons = seasonsResult.data;
  }

  const steamProfile = await fetchSteamProfile(steamId, supabase ?? undefined, {
    persist: true,
  });

  let profileUserIds = [steamId];
  if (supabase) {
    const vanityKeys = [
      steamProfile.customUrl,
      !/^\d+$/.test(rawSteamId) ? rawSteamId : null,
    ].filter(Boolean) as string[];

    if (vanityKeys.length > 0) {
      const { data: vanityUsers } = await supabase
        .from("users")
        .select("steam_id")
        .in("custom_url", [...new Set(vanityKeys)]);

      const vanityIds = (vanityUsers ?? [])
        .map((row) => String(row.steam_id))
        .filter(Boolean);
      profileUserIds = [...new Set([steamId, ...vanityIds])];
    }
  }

  const gamesResult = supabase
    ? await supabase
        .from("games")
        .select("*")
        .in("user_id", profileUserIds)
        .order("played_at", { ascending: false })
    : { data: [] };

  if (
    steamProfile.customUrl &&
    rawSteamId !== steamProfile.customUrl &&
    rawSteamId === steamId
  ) {
    return {
      redirect: {
        destination: `${playerProfilePath(steamId, steamProfile.customUrl)}${
          forceRefresh ? "?refresh=1" : ""
        }`,
        permanent: false,
      },
    };
  }

  return {
    props: {
      steamId,
      steamProfile,
      games: (gamesResult.data as PlayerGame[]) || [],
      drodo,
      seasons,
      drodoProfileMissing,
      drodoLastFetchedAt,
      forceRefresh,
      ogImageUrl: absoluteUrl(`/api/og/player/${steamId}`, baseUrl),
      canonicalUrl: absoluteUrl(
        playerProfilePath(steamId, steamProfile.customUrl),
        baseUrl
      ),
    },
  };
};
