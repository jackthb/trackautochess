import Head from "next/head";
import { useEffect, useState, useMemo } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

interface Game {
  id: number;
  played_at: string;
  placement: string;
  rank: string | null;
  rank_change: string | null;
  lineup: string | null;
  synergies: string | null;
  relic: string | null;
  level: string | null;
  wl: string | null;
  user_id: string;
  created_at: string;
}

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

interface HomeProps {
  supabase: SupabaseClient | null;
}

function placementColor(p: number): string {
  if (p === 1) return "var(--gold)";
  if (p <= 3) return "var(--silver)";
  if (p === 4) return "var(--text-secondary)";
  return "var(--red-bright)";
}

function placementBg(p: number): string {
  if (p === 1) return "rgba(201,168,76,0.08)";
  if (p <= 3) return "rgba(138,146,168,0.05)";
  if (p === 4) return "transparent";
  return "rgba(155,58,58,0.05)";
}

function rankTier(rank: string | null): string {
  if (!rank) return "";
  return rank.split("-")[0];
}

function unitStem(name: string): string {
  return name.toLowerCase().replace(/ /g, "_").replace(/-/g, "_").replace(/'/g, "");
}

function relicStem(name: string): string {
  return name.toLowerCase().replace(/ /g, "_").replace(/-/g, "_");
}

function parseRelics(relic: string | null): string[] {
  if (!relic) return [];
  return relic.split("|").filter(Boolean);
}

function parseLineup(lineup: string | null): { name: string; stars: number }[] {
  if (!lineup) return [];
  return lineup.split("|").filter(Boolean).map((entry) => {
    const m = entry.match(/^(.+?)(?:\((\d)\))?$/);
    if (!m) return { name: entry, stars: 1 };
    return { name: m[1], stars: m[2] ? parseInt(m[2]) : 1 };
  });
}

const SYN_ICON_MAP: Record<string, string> = {
  "Demon Hunter": "demonhunter",
  "Elemental": "element",
  "Faceless": "nraqi",
  "Pandaren": "pandaman",
};

function synIconName(name: string): string {
  if (SYN_ICON_MAP[name]) return SYN_ICON_MAP[name];
  return name.toLowerCase().replace(/ /g, "");
}

function parseSynergies(syn: string | null): { name: string; count: number }[] {
  if (!syn) return [];
  return syn.split("|").filter(Boolean).map((entry) => {
    const [name, count] = entry.split(":");
    return { name, count: parseInt(count) || 0 };
  }).filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
}

function parseWL(wl: string | null): { w: number; l: number } | null {
  if (!wl) return null;
  const parts = wl.split("-");
  if (parts.length !== 2) return null;
  return { w: parseInt(parts[0]) || 0, l: parseInt(parts[1]) || 0 };
}

const TIER_NAMES = ["Pawn", "Knight", "Rook", "Bishop", "King", "Queen"];
function mmrLevelToTier(level: number | null): string {
  if (level == null) return "";
  const tier = TIER_NAMES[Math.floor(level / 3)] ?? "Queen";
  const sub = (level % 3) + 1;
  return `${tier} ${sub}`;
}

export default function Home({ supabase }: HomeProps) {
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
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

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

    setGamesLoading(true);
    supabase
      .from("games")
      .select("*")
      .eq("user_id", steamId)
      .order("played_at", { ascending: false })
      .then(({ data }) => {
        setGames((data as Game[]) || []);
        setGamesLoading(false);
      });

    fetchDrodo(steamId);
  }, [supabase, user]);

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setGames([]);
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
        <title>DAC Tools</title>
        <meta name="description" content="Dota Auto Chess match tracker" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: 100vh;
        }

        /* ── Header ── */
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 32px;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(8,9,11,0.9);
          backdrop-filter: blur(8px);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .logo {
          font-family: 'Cinzel', serif;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .logo span {
          color: var(--gold-dim);
        }
        .header-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .player-name {
          font-size: 12px;
          color: var(--text-secondary);
        }
        .btn-ghost {
          font-family: inherit;
          font-size: 11px;
          color: var(--text-muted);
          background: none;
          border: 1px solid var(--border);
          padding: 5px 14px;
          cursor: pointer;
          letter-spacing: 0.5px;
          transition: all 0.2s;
        }
        .btn-ghost:hover {
          color: var(--text-secondary);
          border-color: var(--text-muted);
        }

        /* ── Hero (logged out) ── */
        .hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: calc(100vh - 53px);
          padding: 60px 32px;
          text-align: center;
        }
        .hero-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(var(--border-subtle) 1px, transparent 1px),
            linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
          background-size: 64px 64px;
          mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
          pointer-events: none;
        }
        .hero-title {
          font-family: 'Cinzel', serif;
          font-size: clamp(32px, 5vw, 56px);
          font-weight: 700;
          letter-spacing: 6px;
          text-transform: uppercase;
          color: var(--text-primary);
          margin-bottom: 16px;
          position: relative;
        }
        .hero-title::after {
          content: '';
          display: block;
          width: 60px;
          height: 1px;
          background: var(--gold-dim);
          margin: 20px auto 0;
        }
        .hero-sub {
          font-size: 13px;
          color: var(--text-muted);
          max-width: 400px;
          margin-bottom: 48px;
          line-height: 1.8;
          position: relative;
        }
        .btn-steam {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-primary);
          background: linear-gradient(135deg, #1b2838 0%, #171a21 100%);
          border: 1px solid #2a3a4e;
          padding: 14px 32px;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.3s;
        }
        .btn-steam:hover {
          border-color: var(--accent);
          box-shadow: 0 0 20px rgba(74,111,165,0.15);
          transform: translateY(-1px);
        }
        .btn-steam svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
          opacity: 0.7;
        }

        /* ── Dashboard ── */
        .dashboard {
          max-width: 1040px;
          margin: 0 auto;
          padding: 32px 24px 64px;
        }

        /* ── Stats Bar ── */
        .stats-bar {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border);
          margin-bottom: 32px;
        }
        .stat-cell {
          background: var(--bg-surface);
          padding: 20px 16px;
          text-align: center;
        }
        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }
        .stat-value.gold { color: var(--gold); }
        .stat-value.green { color: var(--green-bright); }
        .stat-label {
          font-size: 10px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        /* ── Refresh row ── */
        .refresh-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }
        .btn-refresh {
          font-family: inherit;
          font-size: 11px;
          color: var(--text-muted);
          background: none;
          border: 1px solid var(--border);
          padding: 5px 14px;
          cursor: pointer;
          letter-spacing: 0.5px;
          transition: all 0.2s;
        }
        .btn-refresh:hover:not(:disabled) {
          color: var(--text-secondary);
          border-color: var(--text-muted);
        }
        .btn-refresh:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .refresh-time {
          font-size: 10px;
          color: var(--text-muted);
        }

        /* ── Table ── */
        .table-wrap {
          border: 1px solid var(--border);
          overflow: hidden;
        }
        .table-header {
          display: grid;
          grid-template-columns: 56px 1fr 100px 80px 120px 100px;
          padding: 0 16px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border);
        }
        .th {
          font-size: 9px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 12px 4px;
        }
        .game-entry {
          border-bottom: 1px solid var(--border-subtle);
          transition: background 0.15s;
        }
        .game-entry:last-child { border-bottom: none; }
        .game-entry:hover { background: var(--bg-hover); }
        .game-row {
          display: grid;
          grid-template-columns: 56px 1fr 100px 80px 120px 100px;
          padding: 0 16px;
          align-items: center;
        }
        .cell {
          padding: 14px 4px;
          font-size: 13px;
        }
        .placement {
          font-size: 22px;
          font-weight: 700;
          font-family: 'Cinzel', serif;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          border-color: inherit;
          opacity: 0.9;
        }
        .rank-cell {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .rank-tier {
          font-size: 12px;
          color: var(--text-secondary);
        }
        .rank-num {
          font-size: 11px;
          color: var(--text-muted);
        }
        .arrow-up {
          color: var(--green-bright);
          font-size: 10px;
        }
        .arrow-down {
          color: var(--red-bright);
          font-size: 10px;
        }
        .wl {
          font-size: 12px;
        }
        .wl-w { color: var(--green-bright); }
        .wl-l { color: var(--red-bright); }
        .wl-sep { color: var(--text-muted); }
        .date-cell {
          font-size: 11px;
          color: var(--text-muted);
        }
        .level-cell {
          font-size: 13px;
          color: var(--text-secondary);
        }

        /* ── Lineup & Synergies row ── */
        .detail-row {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 0 16px 10px 76px;
          flex-wrap: wrap;
        }
        .lineup {
          display: flex;
          gap: 2px;
          align-items: center;
          flex-wrap: wrap;
        }
        .unit-icon-wrap {
          position: relative;
          width: 28px;
          height: 28px;
        }
        .unit-icon {
          width: 28px;
          height: 28px;
          border-radius: 4px;
          border: 1px solid var(--border);
          object-fit: cover;
          background: var(--bg-surface);
        }
        .unit-icon.stars-2 { border-color: #5a8fd5; }
        .unit-icon.stars-3 { border-color: var(--gold); }
        .unit-stars {
          position: absolute;
          bottom: -2px;
          right: -2px;
          font-size: 7px;
          line-height: 1;
          background: var(--bg-deep);
          border-radius: 2px;
          padding: 1px 2px;
        }
        .unit-stars.s2 { color: #5a8fd5; }
        .unit-stars.s3 { color: var(--gold); }
        .synergies {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
          margin-left: auto;
        }
        .syn-badge {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 10px;
          color: var(--text-muted);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 3px;
          padding: 2px 5px 2px 3px;
        }
        .syn-icon {
          width: 14px;
          height: 14px;
          border-radius: 2px;
          object-fit: cover;
        }
        .syn-count {
          color: var(--text-secondary);
          font-weight: 600;
        }
        .relics-cell {
          display: flex;
          align-items: center;
        }
        .relics {
          display: flex;
          gap: 3px;
          align-items: center;
        }
        .relic-icon {
          width: 22px;
          height: 22px;
          border-radius: 3px;
          border: 1px solid var(--border);
          object-fit: cover;
          background: var(--bg-surface);
        }
        .empty-state {
          text-align: center;
          padding: 64px 24px;
          color: var(--text-muted);
          font-size: 13px;
          background: var(--bg-surface);
        }

        /* ── Loading ── */
        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 200px;
          color: var(--text-muted);
          font-size: 12px;
          letter-spacing: 1px;
        }
        .loading::after {
          content: '';
          width: 12px;
          height: 12px;
          border: 1.5px solid var(--text-muted);
          border-top-color: transparent;
          border-radius: 50%;
          margin-left: 10px;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* ── Animations ── */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-up {
          animation: fadeUp 0.4s ease-out both;
        }
        .delay-1 { animation-delay: 0.1s; }
        .delay-2 { animation-delay: 0.2s; }
        .delay-3 { animation-delay: 0.3s; }

        /* ── Season History ── */
        .section-title {
          font-size: 10px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 32px 0 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .seasons-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border);
          margin-bottom: 32px;
        }
        .season-card {
          background: var(--bg-surface);
          padding: 16px;
        }
        .season-label {
          font-size: 10px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .season-mmr {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 2px;
        }
        .season-tier {
          font-size: 11px;
          color: var(--gold-dim);
          margin-bottom: 6px;
        }
        .season-meta {
          font-size: 10px;
          color: var(--text-muted);
        }
        .season-peak {
          color: var(--gold);
        }
      `}</style>

      <div className="page">
        <header className="header">
          <div className="logo">
            <span>DAC</span> Tools
          </div>
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
        ) : user ? (
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
                    <div className="th">Rank</div>
                    <div className="th">W – L</div>
                    <div className="th">Level</div>
                    <div className="th">Relic</div>
                    <div className="th">Date</div>
                  </div>
                  {games.map((g) => {
                    const p = parseInt(g.placement) || 0;
                    const wl = parseWL(g.wl);
                    const tier = rankTier(g.rank);
                    const rankNum = g.rank?.split("-")[1] || "";
                    const lineup = parseLineup(g.lineup);
                    const syns = parseSynergies(g.synergies);
                    return (
                      <div
                        key={g.id}
                        className="game-entry"
                        style={{ background: placementBg(p) }}
                      >
                        <div className="game-row">
                          <div className="cell">
                            <div
                              className="placement"
                              style={{
                                color: placementColor(p),
                                borderColor: placementColor(p),
                              }}
                            >
                              {g.placement}
                            </div>
                          </div>
                          <div className="cell rank-cell">
                            <span className="rank-tier">{tier}</span>
                            <span className="rank-num">{rankNum}</span>
                            {g.rank_change === "up" && (
                              <span className="arrow-up">▲</span>
                            )}
                            {g.rank_change === "down" && (
                              <span className="arrow-down">▼</span>
                            )}
                          </div>
                          <div className="cell wl">
                            {wl ? (
                              <>
                                <span className="wl-w">{wl.w}</span>
                                <span className="wl-sep"> – </span>
                                <span className="wl-l">{wl.l}</span>
                              </>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </div>
                          <div className="cell level-cell">
                            {g.level || "—"}
                          </div>
                          <div className="cell relics-cell">
                            {parseRelics(g.relic).length > 0 ? (
                              <div className="relics">
                                {parseRelics(g.relic).map((r, i) => (
                                  <img
                                    key={i}
                                    className="relic-icon"
                                    src={`/icons/relics/${relicStem(r)}.png`}
                                    alt={r}
                                    title={r}
                                    loading="lazy"
                                    onError={(e) => {
                                      const el = e.target as HTMLImageElement;
                                      el.style.display = "none";
                                    }}
                                  />
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </div>
                          <div className="cell date-cell">
                            {g.played_at ? (
                              <>
                                <div>{new Date(g.played_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                                <div style={{ fontSize: "10px", opacity: 0.6 }}>{new Date(g.played_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
                              </>
                            ) : "—"}
                          </div>
                        </div>
                        {(lineup.length > 0 || syns.length > 0) && (
                          <div className="detail-row">
                            {lineup.length > 0 && (
                              <div className="lineup">
                                {lineup.map((u, i) => (
                                  <div key={i} className="unit-icon-wrap" title={`${u.name}${u.stars > 1 ? ` ★${u.stars}` : ""}`}>
                                    <img
                                      className={`unit-icon${u.stars >= 3 ? " stars-3" : u.stars === 2 ? " stars-2" : ""}`}
                                      src={`/icons/units/${unitStem(u.name)}.png`}
                                      alt={u.name}
                                      loading="lazy"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                    />
                                    {u.stars > 1 && (
                                      <span className={`unit-stars s${u.stars}`}>{"★".repeat(u.stars)}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {syns.length > 0 && (
                              <div className="synergies">
                                {syns.slice(0, 5).map((s, i) => (
                                  <div key={i} className="syn-badge" title={`${s.name}: ${s.count}`}>
                                    <img
                                      className="syn-icon"
                                      src={`/icons/synergies/${synIconName(s.name)}.png`}
                                      alt={s.name}
                                      loading="lazy"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                    />
                                    <span className="syn-count">{s.count}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="hero">
            <div className="hero-grid" />
            <h1 className="hero-title fade-up">DAC Tools</h1>
            <p className="hero-sub fade-up delay-1">
              Track your Dota Auto Chess matches. Automatic game detection,
              rank progression, and match history.
            </p>
            <a href="/api/auth/steam" className="btn-steam fade-up delay-2">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95 0-5.52-4.48-10-10-10z" />
              </svg>
              Sign in with Steam
            </a>
          </div>
        )}
      </div>
    </>
  );
}
