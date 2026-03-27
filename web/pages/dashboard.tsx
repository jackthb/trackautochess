import Head from "next/head";
import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/router";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import unitsData from "../data/units.json";
import { parseWL } from "@dac/shared/game-utils";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { Game } from "@dac/shared/types";

interface SeasonSnapshot {
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
}

interface DrodoProfile {
  mmr: number | null;
  max_mmr: number | null;
  mmr_level: number | null;
  season: string | null;
  season_games: number | null;
  chicken_count: number | null;
  fetched_at: string | null;
  seasons?: SeasonSnapshot[];
}

interface DashboardProps {
  supabase: SupabaseClient | null;
}

// Build cost lookup from units.json
const UNIT_COSTS: Record<string, number> = {};
for (const [name, info] of Object.entries(unitsData.units)) {
  UNIT_COSTS[name] = (info as { cost: number }).cost;
}

const TIER_NAMES = ["Pawn", "Knight", "Rook", "Bishop", "King", "Queen"];
function mmrLevelToTier(level: number | null): string {
  if (level == null) return "";
  const tier = TIER_NAMES[Math.floor(level / 3)] ?? "Queen";
  const sub = (level % 3) + 1;
  return `${tier} ${sub}`;
}

export default function Dashboard({ supabase }: DashboardProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [drodo, setDrodo] = useState<DrodoProfile | null>(null);
  const [drodoLoading, setDrodoLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
      if (!user) router.replace("/");
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (!u) router.replace("/");
    });
    return () => subscription.unsubscribe();
  }, [supabase, router]);

  const fetchDrodo = (steamId: string, refresh?: boolean) => {
    setDrodoLoading(true);
    fetch(`/api/drodo/${steamId}${refresh ? "?refresh=1" : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setDrodo(data); })
      .catch(() => {})
      .finally(() => setDrodoLoading(false));
  };

  useEffect(() => {
    if (!supabase || !user) return;
    const steamId = user.user_metadata?.steam_id;
    if (!steamId) return;

    const cacheKey = `dac_games_${steamId}`;

    // Load cached games immediately
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { games: cachedGames } = JSON.parse(cached);
        if (cachedGames?.length) setGames(cachedGames);
      }
    } catch {}

    // Check if data changed: count + latest played_at
    setGamesLoading(true);
    supabase
      .from("games")
      .select("id, played_at")
      .eq("user_id", steamId)
      .order("played_at", { ascending: false })
      .limit(1)
      .then(async ({ data: latest }) => {
        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
          try {
            const { count, newest } = JSON.parse(cachedRaw);
            const serverNewest = latest?.[0]?.played_at ?? null;
            // Also do a count check
            const { count: serverCount } = await supabase
              .from("games")
              .select("*", { count: "exact", head: true })
              .eq("user_id", steamId);
            if (count === serverCount && newest === serverNewest) {
              // Cache is current
              setGamesLoading(false);
              return;
            }
          } catch {}
        }

        // Cache miss or stale — full fetch
        const { data } = await supabase
          .from("games")
          .select("*")
          .eq("user_id", steamId)
          .order("played_at", { ascending: false });

        const freshGames = (data as Game[]) || [];
        setGames(freshGames);
        setGamesLoading(false);

        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              games: freshGames,
              count: freshGames.length,
              newest: freshGames[0]?.played_at ?? null,
            })
          );
        } catch {}
      });

    fetchDrodo(steamId);
  }, [supabase, user]);

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setGames([]);
    router.replace("/");
  };

  const displayName =
    user?.user_metadata?.steam_name ||
    user?.user_metadata?.full_name ||
    "Player";

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

  const isReady = supabase !== null;

  return (
    <>
      <Head>
        <title>Dashboard — DAC Tools</title>
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
          background: rgba(8,9,11,0.9);
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
          text-decoration: none;
        }
        .logo b { color: var(--gold-dim); }
        .header-right {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .player-name {
          font-size: 15px;
          color: var(--text-secondary);
        }
        .btn-ghost {
          font-family: inherit;
          font-size: 14px;
          color: var(--text-muted);
          background: none;
          border: 1px solid var(--border);
          padding: 7px 18px;
          cursor: pointer;
          letter-spacing: 0.5px;
          transition: all 0.2s;
        }
        .btn-ghost:hover {
          color: var(--text-secondary);
          border-color: var(--text-muted);
        }
        .dashboard {
          max-width: 1200px;
          margin: 0 auto;
          padding: 40px 32px 80px;
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
        .stat-value.gold { color: var(--gold); }
        .stat-value.green { color: var(--green-bright); }
        .stat-label {
          font-size: 13px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .refresh-row {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 28px;
        }
        .btn-refresh {
          font-family: inherit;
          font-size: 14px;
          color: var(--text-muted);
          background: none;
          border: 1px solid var(--border);
          padding: 7px 18px;
          cursor: pointer;
          letter-spacing: 0.5px;
          transition: all 0.2s;
        }
        .btn-refresh:hover:not(:disabled) {
          color: var(--text-secondary);
          border-color: var(--text-muted);
        }
        .btn-refresh:disabled { opacity: 0.5; cursor: default; }
        .refresh-time { font-size: 13px; color: var(--text-muted); }
        .section-title {
          font-size: 13px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 40px 0 16px;
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
        .game-entry:last-child { border-bottom: none; }
        .empty-state {
          text-align: center;
          padding: 80px 32px;
          color: var(--text-muted);
          font-size: 16px;
          background: var(--bg-surface);
        }
        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 200px;
          color: var(--text-muted);
          font-size: 15px;
          letter-spacing: 1px;
        }
        .loading::after {
          content: '';
          width: 14px;
          height: 14px;
          border: 1.5px solid var(--text-muted);
          border-top-color: transparent;
          border-radius: 50%;
          margin-left: 10px;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.4s ease-out both; }
        .delay-1 { animation-delay: 0.1s; }
      `}</style>

      <div className="page">
        <header className="header">
          <a href="/" className="logo">
            <b>DAC</b> Tools
          </a>
          {user && (
            <div className="header-right">
              <span className="player-name">{displayName}</span>
              <button className="btn-ghost" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          )}
        </header>

        {!isReady || loading ? (
          <div className="loading">Loading</div>
        ) : !user ? (
          <div className="loading">Redirecting...</div>
        ) : (
          <div className="dashboard">
            {gamesLoading ? (
              <div className="loading">Fetching matches</div>
            ) : games.length === 0 ? (
              <div className="table-wrap fade-up">
                <div className="empty-state">
                  No matches recorded yet. Use the tracker to import games.
                </div>
              </div>
            ) : (
              <>
                {stats && (
                  <div className="stats-bar fade-up">
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

                {drodo?.seasons && drodo.seasons.length > 1 && (
                  <div className="fade-up delay-1">
                    <div className="section-title">Season History</div>
                    <div className="seasons-grid">
                      {[...drodo.seasons].reverse().map((s) => (
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
                  </div>
                )}

                <div className="refresh-row fade-up">
                  <button
                    className="btn-refresh"
                    disabled={drodoLoading}
                    onClick={() => {
                      const steamId = user?.user_metadata?.steam_id;
                      if (steamId) fetchDrodo(steamId, true);
                    }}
                  >
                    {drodoLoading ? "Refreshing..." : "Refresh stats"}
                  </button>
                  {drodo?.fetched_at && (
                    <span className="refresh-time">
                      Updated {new Date(drodo.fetched_at).toLocaleString()}
                    </span>
                  )}
                </div>

                <div className="table-wrap fade-up delay-1">
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
                      <Link href={`/games/${g.id}`} style={{ display: "block", color: "inherit" }}>
                        <GameRowDisplay
                          game={g}
                          unitCosts={UNIT_COSTS}
                          iconUrl={(type, stem) => `/icons/${type}/${stem}.png`}
                        />
                      </Link>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
