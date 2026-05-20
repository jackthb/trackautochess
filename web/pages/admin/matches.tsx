import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { playerProfilePath } from "@/lib/steam";
import { createSupabaseClient } from "@/lib/supabase";
import { isAdminSteamId } from "@/lib/admin";
import { PageLayout } from "@/components/PageLayout";
import type { MatchSummary } from "../api/admin/matches";

type Phase = "loading" | "forbidden" | "ready" | "error";

function formatPlayedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MatchesPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [matches, setMatches] = useState<MatchSummary[]>([]);
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
        const resp = await fetch("/api/admin/matches", {
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
        const json = (await resp.json()) as { matches: MatchSummary[] };
        if (!cancelled) {
          setMatches(json.matches);
          setPhase("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setErrorMessage(err instanceof Error ? err.message : "Network error");
        }
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      const meta = data.session?.user?.user_metadata as
        | { steam_id?: unknown }
        | null
        | undefined;
      const steamId = meta && typeof meta.steam_id === "string" ? meta.steam_id : null;
      void load(data.session?.access_token ?? null, steamId);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SeoHead
        title={`Matches | ${SITE_TITLE}`}
        description="All uploaded matches."
        path="/admin/matches"
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
          grid-template-columns: 56px 180px 1fr 64px;
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
        .match-row {
          display: contents;
          cursor: pointer;
        }
        .match-row:hover .cell {
          background: rgba(255, 255, 255, 0.025);
        }
        .cell-meta {
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
        .winner {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid var(--border);
          background: var(--bg-surface);
          flex-shrink: 0;
        }
        .avatar-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .winner-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-primary);
        }
        .player-link {
          color: var(--text-primary);
          text-decoration: none;
          transition: color 0.15s;
        }
        .player-link:hover {
          color: var(--accent);
        }
        .placement {
          font-variant-numeric: tabular-nums;
          color: var(--text-muted);
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
            grid-template-columns: 44px 1fr 56px;
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

      <PageLayout title="Matches">

          {phase === "loading" && <div className="gate">Loading…</div>}

          {phase === "forbidden" && (
            <div className="gate">
              This page is restricted. Sign in with the admin Steam account to view it.
            </div>
          )}

          {phase === "error" && (
            <div className="gate">
              Failed to load matches{errorMessage ? `: ${errorMessage}` : "."}
            </div>
          )}

          {phase === "ready" && (
            <>
              <p className="lead">
                The {matches.length} most recent uploaded matches across all players.
              </p>

              {matches.length === 0 ? (
                <div className="empty">No matches uploaded yet.</div>
              ) : (
                <div className="table" role="table">
                  <div className="row header-row">
                    <div className="cell">#</div>
                    <div className="cell hide-sm">Date</div>
                    <div className="cell">Winner</div>
                    <div className="cell">Players</div>
                  </div>
                  {matches.map((m, i) => {
                    const winner = m.players[0];
                    const display =
                      winner?.name || winner?.customUrl || winner?.steamId || "Unknown";
                    const initial = (display.charAt(0) || "?").toUpperCase();
                    const matchHref = `/games/${m.representativeGameId}`;
                    return (
                      <div
                        key={`${m.matchId ?? m.representativeGameId}`}
                        className="match-row"
                        role="link"
                        tabIndex={0}
                        onClick={() => router.push(matchHref)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(matchHref);
                          }
                        }}
                      >
                        <div className="cell cell-meta">{i + 1}</div>
                        <div className="cell cell-meta hide-sm">
                          {formatPlayedAt(m.playedAt)}
                        </div>
                        <div className="cell">
                          <div className="winner">
                            {winner?.avatarUrl ? (
                              <img
                                className="avatar"
                                src={winner.avatarUrl}
                                alt=""
                                width={28}
                                height={28}
                                referrerPolicy="no-referrer"
                                loading="lazy"
                              />
                            ) : (
                              <span className="avatar avatar-fallback" aria-hidden="true">
                                {initial}
                              </span>
                            )}
                            <span className="winner-name">
                              {winner?.steamId ? (
                                <Link
                                  href={playerProfilePath(winner.steamId, winner.customUrl)}
                                  className="player-link"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {display}
                                </Link>
                              ) : (
                                display
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="cell placement">{m.players.length}</div>
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
