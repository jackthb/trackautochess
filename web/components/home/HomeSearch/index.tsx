"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ProfileSearch } from "@/components/ProfileSearch";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import type { CustomGameMetrics } from "@/lib/customGameStats";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { playerProfilePath } from "@/lib/steam";
import { DRODO_OUTAGE_NOTICE } from "@/lib/drodoLive";
import styles from "./HomeSearch.module.css";

const t = {
  description:
    "Look up Dota Auto Chess player rank and tracked match stats by Steam vanity URL or SteamID64.",
  tagline: "Rank & season history for any Dota Auto Chess player.",
  notice: DRODO_OUTAGE_NOTICE,
  placeholder: "Steam profile URL or SteamID64",
  signinDivider: "or",
  viewProfile: "View your profile",
};

function formatMetric(value: number): string {
  return value.toLocaleString("en-US");
}

export default function HomeSearch({
  metrics,
  children,
}: {
  metrics: CustomGameMetrics | null;
  children?: ReactNode;
}) {
  // Mirror the nav's auth check (AppNavBar): once we know the visitor is signed
  // in, the hero's "Sign in through Steam" CTA is wrong — swap it for a link to
  // their own profile. Gate on `authReady` so logged-in users never flash the
  // sign-in button first.
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
          <p className={styles.outageNotice} role="status">
            {t.notice}
          </p>

          {/* Sign-in is the fastest path (and unlocks daily auto-tracking), so
              it leads. Search is the no-login fallback below the divider. */}
          {authReady && (
            <div className={styles.primaryCta}>
              {user ? (
                <Link href={profileHref} className={styles.profileCta}>
                  {t.viewProfile}
                </Link>
              ) : (
                <SteamSignInButton source="home_hero" size="md" />
              )}
            </div>
          )}

          {authReady && (
            <div className={styles.signinDivider}>
              <span>{t.signinDivider}</span>
            </div>
          )}

          <div className={styles.searchWrap}>
            <ProfileSearch
              analyticsSource="home_hero"
              placeholder={t.placeholder}
              exampleUrl="https://steamcommunity.com/profiles/76561198022169086"
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
