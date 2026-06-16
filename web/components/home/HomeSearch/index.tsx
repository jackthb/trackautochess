"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ProfileSearch } from "@/components/ProfileSearch";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import { createSupabaseClient } from "@/lib/supabase";
import styles from "./HomeSearch.module.css";

const t = {
  description:
    "Look up Dota Auto Chess player MMR, season history, and tracked match stats by Steam vanity URL or SteamID64.",
  tagline: "MMR, rank & season history for any Dota Auto Chess player.",
  placeholder: "Steam profile URL or SteamID64",
  signinDivider: "or",
  viewProfile: "View your profile",
};

export default function HomeSearch() {
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
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

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
                <Link href="/dashboard" className={styles.profileCta}>
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
        </main>
      </div>
    </div>
  );
}
