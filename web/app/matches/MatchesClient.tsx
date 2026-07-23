"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { listAvatarUrl, playerProfilePath } from "@/lib/steam";
import { useAdminAccess } from "@/lib/admin";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { PageLayout } from "@/components/PageLayout";
import type { MatchSummary } from "@/app/api/matches/route";
import styles from "./matches.module.css";

// Client island for /matches: owns admin gating (PostHog admin_access +
// Supabase session token), data fetching from /api/matches, all state,
// and rendering. styled-jsx was ported to matches.module.css.

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

function winnerDisplayName(winner: MatchSummary["players"][number] | undefined): string {
  if (!winner) return "Unknown";
  if (winner.name?.trim()) return winner.name.trim();
  if (winner.customUrl?.trim()) return winner.customUrl.trim();
  if (winner.steamId) {
    const id = winner.steamId;
    return `Player …${id.slice(-4)}`;
  }
  return "Unknown";
}

export function MatchesClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const { ready: authReady, steamId, accessToken } = useSupabaseSession();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const adminAccess = useAdminAccess(steamId);

  useEffect(() => {
    if (!authReady) {
      setPhase("loading");
      return;
    }
    if (!accessToken || !steamId) {
      setPhase("forbidden");
      return;
    }
    if (adminAccess === "loading") {
      setPhase("loading");
      return;
    }
    if (adminAccess !== "enabled") {
      setPhase("forbidden");
      return;
    }

    let cancelled = false;

    const load = async () => {
      setPhase("loading");
      try {
        const resp = await fetch("/api/matches", {
          headers: { Authorization: `Bearer ${accessToken}` },
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

    void load();

    return () => {
      cancelled = true;
    };
  }, [authReady, accessToken, steamId, adminAccess, retryToken]);

  return (
    <PageLayout title="Matches">
      {phase === "loading" && <div className={styles.gate}>Loading…</div>}

      {phase === "forbidden" && (
        <div className={styles.gate}>
          This page is restricted. Sign in with a beta-enabled Steam account to view it.
        </div>
      )}

      {phase === "error" && (
        <div className={styles.banner} role="alert">
          <span className={styles.bannerText}>
            Failed to load matches{errorMessage ? `: ${errorMessage}` : "."}
          </span>
          <button
            type="button"
            className={styles.bannerRetry}
            onClick={() => setRetryToken((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {phase === "ready" && (
        <>
          <p className={styles.lead}>
            The {matches.length} most recent uploaded matches across all players.
            Click a row for the match page — per-round scrubbing appears when that
            match was captured with a timeline.
          </p>

          {matches.length === 0 ? (
            <div className={styles.empty}>No matches uploaded yet.</div>
          ) : (
            <div className={styles.table} role="table">
              <div className={`${styles.row} ${styles.headerRow}`}>
                <div className={styles.cell}>#</div>
                <div className={`${styles.cell} ${styles.hideSm}`}>Date</div>
                <div className={styles.cell}>Winner</div>
                <div className={`${styles.cell} ${styles.hideSm}`}>Rounds</div>
                <div className={styles.cell}>Players</div>
              </div>
              {matches.map((m, i) => {
                const winner = m.players[0];
                const display = winnerDisplayName(winner);
                const initial = /^\d+$/.test(display)
                  ? "?"
                  : (display.charAt(0) || "?").toUpperCase();
                const matchHref = `/matches/${m.representativeGameId}`;
                return (
                  <div
                    key={`${m.matchId ?? m.representativeGameId}`}
                    className={styles.matchRow}
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
                    <div className={`${styles.cell} ${styles.cellMeta}`}>{i + 1}</div>
                    <div className={`${styles.cell} ${styles.cellMeta} ${styles.hideSm}`}>
                      {formatPlayedAt(m.playedAt)}
                    </div>
                    <div className={styles.cell}>
                      <div className={styles.winner}>
                        {winner?.avatarUrl ? (
                          <img
                            className={styles.avatar}
                            src={listAvatarUrl(winner.avatarUrl)}
                            alt=""
                            width={28}
                            height={28}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        ) : (
                          <span
                            className={`${styles.avatar} ${styles.avatarFallback}`}
                            aria-hidden="true"
                          >
                            {initial}
                          </span>
                        )}
                        <span className={styles.winnerName}>
                          {winner?.steamId ? (
                            <Link
                              href={playerProfilePath(winner.steamId, winner.customUrl)}
                              className={styles.playerLink}
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
                    <div className={`${styles.cell} ${styles.hideSm}`}>
                      {m.hasTimeline ? (
                        <span className={styles.roundsYes} title="Per-round scrubber available">
                          {m.roundCount}
                        </span>
                      ) : (
                        <span className={styles.roundsNo} title="Final board only — no timeline">
                          —
                        </span>
                      )}
                    </div>
                    <div className={`${styles.cell} ${styles.placement}`}>
                      {m.players.length}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </PageLayout>
  );
}
