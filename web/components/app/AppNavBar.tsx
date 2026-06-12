"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { SITE_NAME } from "@/lib/site";
import { trackEvent } from "@/lib/analytics";
import { isAdminSteamId } from "@/lib/admin";
import { useBetaFeaturesEnabled } from "@/lib/betaFeatures";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import styles from "./AppNavBar.module.css";

const t = {
  items: "Items",
  units: "Units",
  classes: "Classes",
  species: "Species",
  relics: "Relics",
  talents: "Talents",
  queens: "Queens",
  matches: "Matches",
  creators: "Creators",
  patchNotes: "Patch Notes",
  cms: "Admin CMS",
  signOut: "Sign out",
  placeholderName: "Steam Player Name",
  home: (n: string) => `${n} home`,
  fallbackPlayer: "Player",
  openMenu: "Open menu",
  closeMenu: "Close menu",
};

interface AppNavBarProps {
  supabase?: SupabaseClient | null;
}

export function AppNavBar({ supabase }: AppNavBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  // App Router has no router.events; close the mobile menu when the path changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!supabase || !user) {
      setAvatarUrl(null);
      return;
    }

    const metadataAvatar =
      typeof user.user_metadata?.avatar_url === "string"
        ? user.user_metadata.avatar_url
        : typeof user.user_metadata?.picture === "string"
          ? user.user_metadata.picture
          : null;
    setAvatarUrl(metadataAvatar);

    if (metadataAvatar) return;

    const steamId = user.user_metadata?.steam_id;
    if (!steamId) return;

    let cancelled = false;
    supabase
      .from("users")
      .select("avatar_url")
      .eq("steam_id", steamId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (typeof data?.avatar_url === "string" && data.avatar_url) {
          setAvatarUrl(data.avatar_url);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [supabase, user]);

  const handleLogout = async () => {
    if (!supabase) return;
    trackEvent("Steam Sign Out Clicked", { source: "nav" });
    await supabase.auth.signOut();
    setUser(null);
    router.replace("/");
  };

  const displayName =
    user?.user_metadata?.steam_name ||
    user?.user_metadata?.full_name ||
    t.fallbackPlayer;

  const sessionSteamId =
    typeof user?.user_metadata?.steam_id === "string"
      ? user.user_metadata.steam_id
      : null;
  const canSeeBetaFeatures = useBetaFeaturesEnabled(sessionSteamId);
  const isAdmin = isAdminSteamId(sessionSteamId);
  const trackNavClick = (destination: string) => {
    trackEvent("Navigation Link Clicked", { source: "nav", destination });
  };

  const navLinks = (
    <>
      <Link href="/items" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("items")}>
        {t.items}
      </Link>
      <Link href="/units" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("units")}>
        {t.units}
      </Link>
      <Link href="/classes" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("classes")}>
        {t.classes}
      </Link>
      <Link href="/species" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("species")}>
        {t.species}
      </Link>
      <Link href="/relics" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("relics")}>
        {t.relics}
      </Link>
      <Link href="/talents" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("talents")}>
        {t.talents}
      </Link>
      <Link href="/queens" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("queens")}>
        {t.queens}
      </Link>
      {canSeeBetaFeatures && (
        <Link href="/matches" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("matches")}>
          {t.matches}
        </Link>
      )}
      {isAdmin && (
        <Link href="/creators" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("creators")}>
          {t.creators}
        </Link>
      )}
      <Link href="/patch-notes" className={styles.navLink} prefetch={false} onClick={() => trackNavClick("patch_notes")}>
        {t.patchNotes}
      </Link>
    </>
  );

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.navLeft}>
          <Link href="/" className={styles.navLogo} aria-label={t.home(SITE_NAME)} prefetch={false}>
            <img src="/logo.svg" alt={SITE_NAME} />
          </Link>
          <div className={styles.navLinks}>{navLinks}</div>
        </div>
        <div className={styles.navRight}>
          {ready ? (
            user ? (
              <>
                <Link href="/dashboard" className={styles.navUserLink} prefetch={false} onClick={() => trackNavClick("dashboard")}>
                  {avatarUrl ? (
                    <img
                      className={styles.navAvatar}
                      src={avatarUrl}
                      alt=""
                      width={26}
                      height={26}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarUrl(null)}
                    />
                  ) : (
                    <span
                      className={`${styles.navAvatar} ${styles.navAvatarFallback}`}
                      aria-hidden="true"
                    >
                      {displayName.charAt(0) || "?"}
                    </span>
                  )}
                  <span className={styles.navUser}>{displayName}</span>
                </Link>
                {isAdmin && (
                  <Link href="/keystatic" className={styles.navBtn} prefetch={false} onClick={() => trackNavClick("keystatic")}>
                    {t.cms}
                  </Link>
                )}
                <button className={styles.navBtn} onClick={handleLogout}>
                  {t.signOut}
                </button>
              </>
            ) : (
              <SteamSignInButton source="nav" size="sm" />
            )
          ) : supabase ? (
            <div className={styles.navAuthPlaceholder} aria-hidden="true">
              <span className={styles.navUser}>{t.placeholderName}</span>
              <span className={styles.navBtn}>{t.signOut}</span>
            </div>
          ) : null}
          <button
            type="button"
            className={styles.navHamburger}
            aria-label={menuOpen ? t.closeMenu : t.openMenu}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span
              className={`${styles.hamburgerIcon} ${menuOpen ? styles.hamburgerOpen : ""}`}
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </nav>
      {menuOpen && (
        <div
          className={styles.mobileBackdrop}
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div
        id="mobile-nav-menu"
        className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ""}`}
        role="dialog"
        aria-label={t.openMenu}
        aria-hidden={!menuOpen}
      >
        <div className={styles.mobileLinks}>{navLinks}</div>
      </div>
    </>
  );
}
