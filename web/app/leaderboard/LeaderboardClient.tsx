"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { levelToRankName, mmrToLevel } from "@/lib/ranks";
import { playerProfilePath } from "@/lib/steam";
import { createSupabaseClient } from "@/lib/supabase";
import { isAdminSteamId } from "@/lib/admin";
import { PageLayout } from "@/components/PageLayout";
import styles from "./leaderboard.module.css";

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

export function LeaderboardClient() {
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

  const seasonLabel = data?.currentSeason ? data.currentSeason.toUpperCase() : "current season";
  const rows = data?.rows ?? [];

  return (
    <PageLayout title="Leaderboard">
      {phase === "loading" && <div className={styles.gate}>Loading…</div>}

      {phase === "forbidden" && (
        <div className={styles.gate}>
          This page is restricted. Sign in with the admin Steam account to view it.
        </div>
      )}

      {phase === "error" && (
        <div className={styles.gate}>
          Failed to load leaderboard{errorMessage ? `: ${errorMessage}` : "."}
        </div>
      )}

      {phase === "ready" && (
        <>
          <p className={styles.lead}>
            Every tracked Auto Chess player ranked by current{" "}
            <strong>{seasonLabel}</strong> MMR. Players appear here once their
            profile has been pulled from Drodo. Unranked players (fewer than 5
            placement games) sit at the bottom.
          </p>

          {rows.length === 0 ? (
            <div className={styles.empty}>No players tracked yet.</div>
          ) : (
            <div className={styles.table} role="table">
              <div className={`${styles.row} ${styles["header-row"]}`}>
                <div className={`${styles.cell} ${styles["cell-rank"]}`}>Rank</div>
                <div className={styles.cell} aria-hidden="true" />
                <div className={styles.cell}>Player</div>
                <div className={styles.cell}>MMR</div>
                <div className={styles.cell}>Lvl</div>
                <div className={styles.cell}>Tier</div>
                <div className={`${styles.cell} ${styles["hide-sm"]}`}>Games</div>
                <div className={`${styles.cell} ${styles["hide-sm"]}`}>Wins</div>
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
                    ? styles.gold
                    : rank === 2
                      ? styles.silver
                      : rank === 3
                        ? styles.bronze
                        : "";
                return (
                  <div key={row.steam_id} className={styles.row}>
                    <div
                      className={`${styles.cell} ${styles["cell-rank"]} ${rank <= 3 ? `${styles["top-rank"]} ${rankClass}` : ""}`}
                    >
                      {ranked ? `#${rank}` : "—"}
                    </div>
                    <div className={`${styles.cell} ${styles["cell-avatar"]}`}>
                      {row.avatar_url ? (
                        <img
                          className={styles.avatar}
                          src={row.avatar_url}
                          alt=""
                          width={32}
                          height={32}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                        />
                      ) : (
                        <span
                          className={`${styles.avatar} ${styles["avatar-fallback"]}`}
                          aria-hidden="true"
                        >
                          {initial}
                        </span>
                      )}
                    </div>
                    <div className={styles.cell}>
                      <Link
                        href={playerProfilePath(row.steam_id, row.custom_url)}
                        className={styles["player-link"]}
                      >
                        {display}
                      </Link>
                      {row.custom_url && row.name && row.custom_url !== row.name && (
                        <span className={styles["player-vanity"]}>/{row.custom_url}</span>
                      )}
                    </div>
                    <div className={`${styles.cell} ${styles["cell-mmr"]} ${ranked ? "" : styles.dim}`}>
                      {ranked ? row.drodo_mmr : "—"}
                    </div>
                    <div className={`${styles.cell} ${styles["cell-meta"]} ${ranked ? "" : styles.dim}`}>
                      {ranked ? level : "—"}
                    </div>
                    <div className={`${styles.cell} ${styles["cell-meta"]} ${ranked ? "" : styles.dim}`}>
                      {tier}
                    </div>
                    <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
                      {row.drodo_season_games ?? "—"}
                    </div>
                    <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
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
  );
}
