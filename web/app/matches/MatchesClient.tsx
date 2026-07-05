"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { listAvatarUrl, playerProfilePath } from "@/lib/steam";
import { useBetaFeaturesAccess } from "@/lib/betaFeatures";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { PageLayout } from "@/components/PageLayout";
import type { MatchSummary } from "@/app/api/matches/route";
import styles from "./matches.module.css";

// Client island for /matches: owns beta gating (PostHog feature flag +
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

export function MatchesClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const { ready: authReady, steamId, accessToken } = useSupabaseSession();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const betaAccess = useBetaFeaturesAccess(steamId);

  useEffect(() => {
    if (!authReady) {
      setPhase("loading");
      return;
    }
    if (!accessToken || !steamId) {
      setPhase("forbidden");
      return;
    }
    if (betaAccess === "loading") {
      setPhase("loading");
      return;
    }
    if (betaAccess !== "enabled") {
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
  }, [authReady, accessToken, steamId, betaAccess]);

  return (
    <PageLayout title="Matches">
      {phase === "loading" && <div className={styles.gate}>Loading…</div>}

      {phase === "forbidden" && (
        <div className={styles.gate}>
          This page is restricted. Sign in with a beta-enabled Steam account to view it.
        </div>
      )}

      {phase === "error" && (
        <div className={styles.gate}>
          Failed to load matches{errorMessage ? `: ${errorMessage}` : "."}
        </div>
      )}

      {phase === "ready" && (
        <>
          <p className={styles.lead}>
            The {matches.length} most recent uploaded matches across all players.
          </p>

          {matches.length === 0 ? (
            <div className={styles.empty}>No matches uploaded yet.</div>
          ) : (
            <div className={styles.table} role="table">
              <div className={`${styles.row} ${styles.headerRow}`}>
                <div className={styles.cell}>#</div>
                <div className={`${styles.cell} ${styles.hideSm}`}>Date</div>
                <div className={styles.cell}>Winner</div>
                <div className={styles.cell}>Players</div>
              </div>
              {matches.map((m, i) => {
                const winner = m.players[0];
                const display =
                  winner?.name || winner?.customUrl || winner?.steamId || "Unknown";
                const initial = (display.charAt(0) || "?").toUpperCase();
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
