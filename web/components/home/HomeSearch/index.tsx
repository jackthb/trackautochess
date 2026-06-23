"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ProfileSearch } from "@/components/ProfileSearch";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import type { CustomGameMetrics } from "@/lib/customGameStats";
import { createSupabaseClient } from "@/lib/supabase";
import { playerProfilePath } from "@/lib/steam";
import styles from "./HomeSearch.module.css";

const t = {
  description:
    "Look up Dota Auto Chess player MMR, season history, and tracked match stats by Steam vanity URL or SteamID64.",
  tagline: "MMR, rank & season history for any Dota Auto Chess player.",
  placeholder: "Steam profile URL or SteamID64",
  signinDivider: "or",
  viewProfile: "View your profile",
};

function formatMetric(value: number): string {
  return value.toLocaleString("en-US");
}

export default function HomeSearch({
  metrics,
}: {
  metrics: CustomGameMetrics | null;
}) {
  // Mirror the nav's auth check (AppNavBar): once we know the visitor is signed
  // in, the hero's "Sign in through Steam" CTA is wrong — swap it for a link to
  // their own profile. Gate on `authReady` so logged-in users never flash the
  // sign-in button first.
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseClient();
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthReady(true);
      setUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const userSteamId =
    typeof user?.user_metadata?.steam_id === "string"
      ? user.user_metadata.steam_id
      : null;
  const userCustomUrl =
    typeof user?.user_metadata?.custom_url === "string"
      ? user.user_metadata.custom_url
      : null;
  const profileHref = userSteamId
    ? playerProfilePath(userSteamId, userCustomUrl)
    : "/dashboard";

  return (
    <div className={styles.page}>
      {Date.now() < new Date("2026-06-15").getTime() && (
        <Link
          href="/patch-notes/2026-05-24-kobold-cheers-poof-appears"
          className={styles.banner}
        >
          <span className={styles.bannerTag}>NEW PATCH</span>
          <span className={styles.bannerText}>
            Kobold rework, Monk &amp; Mech (6), new Kobold Cup — read patch
            notes
          </span>
          <span className={styles.bannerArrow}>&rarr;</span>
        </Link>
      )}
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
