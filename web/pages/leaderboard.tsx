import Link from "next/link";
import { useEffect, useState } from "react";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { levelToRankName, mmrToLevel } from "@/lib/ranks";
import { playerProfilePath } from "@/lib/steam";
import { createSupabaseClient } from "@/lib/supabase";
import { isAdminSteamId } from "@/lib/admin";
import { PageLayout } from "@/components/PageLayout";

interface LeaderboardRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
}

interface LeaderboardData {
  rows: LeaderboardRow[];
  currentSeason: string | null;
}

type Phase = "loading" | "forbidden" | "ready" | "error";

export default function LeaderboardPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseClient();
    if (!supabase) {
      setPhase("forbidden");
      return;
    }
    let cancelled = false;

    const load = async (token: string | null, steamId: string | null) => {
      if (!isAdminSteamId(steamId) || !token) {
        if (!cancelled) setPhase("forbidden");
        return;
      }
      try {
        const resp = await fetch("/api/leaderboard", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => null);
          if (!cancelled) {
            setPhase(resp.status === 403 ? "forbidden" : "error");
            setErrorMessage(body?.error || `Request failed (${resp.status})`);
          }
          return;
        }
        const json = (await resp.json()) as LeaderboardData;
        if (!cancelled) {
          setData(json);
          setPhase("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setErrorMessage(err instanceof Error ? err.message : "Network error");
        }
      }
    };

    supabase.auth.getSession().then(({ data: sessionData }) => {
      const meta = sessionData.session?.user?.user_metadata as
        | { steam_id?: unknown }
        | null
        | undefined;
      const steamId = meta && typeof meta.steam_id === "string" ? meta.steam_id : null;
      void load(sessionData.session?.access_token ?? null, steamId);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const title = `Leaderboard | ${SITE_TITLE}`;
  const seasonLabel = data?.currentSeason ? data.currentSeason.toUpperCase() : "current season";
  const rows = data?.rows ?? [];

  return (
    <>
      <SeoHead
        title={title}
        description="Track Auto Chess admin leaderboard."
        path="/leaderboard"
        noindex
      />

      <style jsx>{`
        .lead {
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          color: var(--text-secondary);
          line-height: var(--lh-relaxed);
          margin: 0 0 24px;
          max-width: 720px;
        }
        .lead strong {
          color: var(--text-primary);
        }
        .gate {
          text-align: center;
          padding: 80px 20px;
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          color: var(--text-muted);
          letter-spacing: 0.4px;
        }
        .table {
          display: grid;
          grid-template-columns: 56px 44px 1fr 96px 64px 84px 80px 80px;
          border: 1px solid var(--border);
          background: var(--bg-surface);
          border-radius: var(--r-8);
          overflow: hidden;
        }
        .row {
          display: contents;
        }
        .cell {
          padding: 12px 14px;
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          min-width: 0;
        }
        .row:last-child .cell {
          border-bottom: none;
        }
        .header-row .cell {
          font-size: var(--fs-11);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.02);
        }
        .cell-rank {
          font-variant-numeric: tabular-nums;
          color: var(--text-muted);
          font-size: var(--fs-12);
        }
        .top-rank {
          color: var(--text-primary);
          font-weight: 600;
        }
        .gold {
          color: var(--gold, #d4af37);
        }
        .silver {
          color: #c0c0c0;
        }
        .bronze {
          color: #cd7f32;
        }
        .cell-avatar {
          padding: 6px 0;
        }
        .avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid var(--border);
          background: var(--bg-surface);
        }
        .avatar-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .player-link {
          color: var(--text-primary);
          text-decoration: none;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          transition: color 0.15s;
        }
        .player-link:hover {
          color: var(--accent);
        }
        .player-vanity {
          color: var(--text-muted);
          font-size: var(--fs-11);
          margin-left: 6px;
        }
        .cell-mmr {
          color: var(--text-primary);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .cell-meta {
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
        .dim {
          color: var(--text-muted);
          opacity: 0.6;
        }
        .empty {
          text-align: center;
          padding: 60px 20px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: var(--fs-13);
        }
        @media (max-width: 760px) {
          .table {
            grid-template-columns: 44px 36px 1fr 72px 56px 64px;
          }
          .hide-sm {
            display: none;
          }
          .cell {
            padding: 10px 8px;
            font-size: var(--fs-12);
          }
        }
      `}</style>

      <PageLayout title="Leaderboard">

          {phase === "loading" && <div className="gate">Loading…</div>}

          {phase === "forbidden" && (
            <div className="gate">
              This page is restricted. Sign in with the admin Steam account to view it.
            </div>
          )}

          {phase === "error" && (
            <div className="gate">
              Failed to load leaderboard{errorMessage ? `: ${errorMessage}` : "."}
            </div>
          )}

          {phase === "ready" && (
            <>
              <p className="lead">
                Every tracked Auto Chess player ranked by current{" "}
                <strong>{seasonLabel}</strong> MMR. Players appear here once their
                profile has been pulled from Drodo. Unranked players (fewer than 5
                placement games) sit at the bottom.
              </p>

              {rows.length === 0 ? (
                <div className="empty">No players tracked yet.</div>
              ) : (
                <div className="table" role="table">
                  <div className="row header-row">
                    <div className="cell cell-rank">Rank</div>
                    <div className="cell" aria-hidden="true" />
                    <div className="cell">Player</div>
                    <div className="cell">MMR</div>
                    <div className="cell">Lvl</div>
                    <div className="cell">Tier</div>
                    <div className="cell hide-sm">Games</div>
                    <div className="cell hide-sm">Wins</div>
                  </div>
                  {rows.map((row, i) => {
                    const rank = i + 1;
                    const ranked = row.drodo_mmr != null;
                    const level = ranked
                      ? (row.drodo_mmr_level ?? mmrToLevel(row.drodo_mmr))
                      : 0;
                    const tier = ranked ? levelToRankName(level) : "Unranked";
                    const initial = (
                      row.name?.charAt(0) ||
                      row.custom_url?.charAt(0) ||
                      "?"
                    ).toUpperCase();
                    const display = row.name || row.custom_url || row.steam_id;
                    const rankClass =
                      rank === 1
                        ? "gold"
                        : rank === 2
                          ? "silver"
                          : rank === 3
                            ? "bronze"
                            : "";
                    return (
                      <div key={row.steam_id} className="row">
                        <div
                          className={`cell cell-rank ${rank <= 3 ? `top-rank ${rankClass}` : ""}`}
                        >
                          {ranked ? `#${rank}` : "—"}
                        </div>
                        <div className="cell cell-avatar">
                          {row.avatar_url ? (
                            <img
                              className="avatar"
                              src={row.avatar_url}
                              alt=""
                              width={32}
                              height={32}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                            />
                          ) : (
                            <span className="avatar avatar-fallback" aria-hidden="true">
                              {initial}
                            </span>
                          )}
                        </div>
                        <div className="cell">
                          <Link
                            href={playerProfilePath(row.steam_id, row.custom_url)}
                            className="player-link"
                          >
                            {display}
                          </Link>
                          {row.custom_url && row.name && row.custom_url !== row.name && (
                            <span className="player-vanity">/{row.custom_url}</span>
                          )}
                        </div>
                        <div className={`cell cell-mmr ${ranked ? "" : "dim"}`}>
                          {ranked ? row.drodo_mmr : "—"}
                        </div>
                        <div className={`cell cell-meta ${ranked ? "" : "dim"}`}>
                          {ranked ? level : "—"}
                        </div>
                        <div className={`cell cell-meta ${ranked ? "" : "dim"}`}>
                          {tier}
                        </div>
                        <div className="cell cell-meta hide-sm">
                          {row.drodo_season_games ?? "—"}
                        </div>
                        <div className="cell cell-meta hide-sm">
                          {row.drodo_chicken_count ?? "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
      </PageLayout>
    </>
  );
}
