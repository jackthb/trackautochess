"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import BetaSignup from "@/components/home/BetaSignup";
import { ProfileSearch } from "@/components/ProfileSearch";
import type { CustomGameMetrics } from "@/lib/customGameStats";
import type { FeaturedMatch } from "@/lib/featuredMatch";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { playerProfilePath } from "@/lib/steam";
import styles from "./HomeSearch.module.css";

const t = {
  description:
    "Look up any Dota Auto Chess player's rank by Steam vanity URL or SteamID64.",
  tagline: "Rank and tracked match history for any Dota Auto Chess player.",
  placeholder: "Steam profile URL or SteamID64",
  lookupDivider: "or look up a player",
  viewProfile: "View your profile",
};

function formatMetric(value: number): string {
  return value.toLocaleString("en-US");
}

export default function HomeSearch({
  metrics,
  featuredMatch,
  children,
}: {
  metrics: CustomGameMetrics | null;
  featuredMatch?: FeaturedMatch | null;
  children?: ReactNode;
}) {
  // The hero no longer carries its own "Sign in through Steam" button — the nav
  // shows one on every page, and a second copy was one of three competing CTAs
  // in a single centred column. Signed-in visitors still get a direct link to
  // their profile; gate on `authReady` so it never flashes for logged-out users.
  const {
    user,
    ready: authReady,
    steamId: userSteamId,
    customUrl: userCustomUrl,
  } = useSupabaseSession();
  const profileHref = userSteamId
    ? playerProfilePath(userSteamId, userCustomUrl)
    : "/dashboard";

  return (
    <div className={styles.page}>
      {children}
      <div className={styles.hero}>
        <div className={styles.grid} />
        <div className={styles.glow} />

        <main className={styles.content}>
          <h1 className={styles.title}>
            <span className={styles.titleTrack}>Track</span>
            <span className={styles.titleAutochess}>Auto Chess</span>
          </h1>

          <div className={styles.rule} />

          <p className={styles.tagline}>{t.tagline}</p>

          {authReady && user && (
            <div className={styles.primaryCta}>
              <Link href={profileHref} className={styles.profileCta}>
                {t.viewProfile}
              </Link>
            </div>
          )}

          {/* Signup leads — it's the action we actually want — and player
              search follows below the divider as the secondary path. */}
          <div className={styles.betaWrap}>
            <BetaSignup
              source="home_hero"
              exampleHref={
                featuredMatch ? `/matches/${featuredMatch.matchPlayerId}` : null
              }
            />
          </div>

          <div className={styles.signinDivider}>
            <span>{t.lookupDivider}</span>
          </div>

          <div className={styles.searchWrap}>
            <ProfileSearch
              analyticsSource="home_hero"
              placeholder={t.placeholder}
            />
          </div>

          {metrics && (
            <a
              className={styles.liveStats}
              href={`https://www.customgamestats.com/games/${metrics.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>
                <strong>{formatMetric(metrics.playerCount)}</strong>
                active players
              </span>
              <span>
                <strong>{formatMetric(metrics.dailyPeak)}</strong>
                today peak
              </span>
            </a>
          )}
        </main>
      </div>
    </div>
  );
}
