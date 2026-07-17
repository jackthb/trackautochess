"use client";

import Link from "next/link";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE_NAME } from "@/lib/site";
import { trackEvent } from "@/lib/analytics";
import { isAdminSteamId } from "@/lib/admin";
import { useBetaFeaturesEnabled } from "@/lib/betaFeatures";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { EntityIcon } from "@/components/EntityIcon";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import { playerProfilePath } from "@/lib/steam";
import styles from "./AppNavBar.module.css";

const t = {
  entities: "Entities",
  synergies: "Synergies",
  items: "Items",
  units: "Units",
  classes: "Classes",
  species: "Species",
  relics: "Relics",
  talents: "Talents",
  queens: "Queens",
  builds: "Builds",
  matches: "Matches",
  creators: "Creators",
  patchNotes: "Patch Notes",
  cms: "Admin CMS",
  signOut: "Sign out",
  home: (n: string) => `${n} home`,
  fallbackPlayer: "Player",
  openMenu: "Open menu",
  closeMenu: "Close menu",
};

interface MenuLink {
  href: string;
  label: string;
  key: string;
  /** Representative entity icon (we have entity icons but no category icons). */
  icon: string;
}

/** Pieces, items, and relics — the "things" in the game. */
const ENTITY_LINKS: MenuLink[] = [
  { href: "/units", label: t.units, key: "units", icon: "/icons/units/tidehunter.png" },
  { href: "/items", label: t.items, key: "items", icon: "/icons/items/radiance.png" },
  { href: "/relics", label: t.relics, key: "relics", icon: "/icons/relics/malefic_rapture.png" },
];

/** Class and species bonuses. */
const SYNERGY_LINKS: MenuLink[] = [
  { href: "/classes", label: t.classes, key: "classes", icon: "/icons/synergies/mage.png" },
  { href: "/species", label: t.species, key: "species", icon: "/icons/synergies/dragon.png" },
];

function CaretDownIcon() {
  return (
    <svg viewBox="0 0 10 6" fill="none" aria-hidden="true" width="10" height="6">
      <path
        d="M1 1l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppNavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    supabase,
    user,
    ready,
    steamId: sessionSteamId,
    customUrl: sessionCustomUrl,
  } = useSupabaseSession();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // App Router has no router.events; close the mobile menu when the path changes.
  // (The Base UI navigation menu manages its own open state and escape handling.)
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
    if (!user) {
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
  }, [user]);

  const handleLogout = async () => {
    if (!supabase) return;
    trackEvent("Steam Sign Out Clicked", { source: "nav" });
    await supabase.auth.signOut();
    router.replace("/");
  };

  const displayName =
    user?.user_metadata?.steam_name ||
    user?.user_metadata?.full_name ||
    t.fallbackPlayer;

  const profileHref = sessionSteamId
    ? playerProfilePath(sessionSteamId, sessionCustomUrl)
    : "/dashboard";
  const canSeeBetaFeatures = useBetaFeaturesEnabled(sessionSteamId);
  const isAdmin = isAdminSteamId(sessionSteamId);
  const trackNavClick = (destination: string) => {
    trackEvent("Navigation Link Clicked", { source: "nav", destination });
  };
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  const groupActive = (links: MenuLink[]) => links.some((l) => isActive(l.href));

  // Standalone links (no dropdown), shared between desktop and mobile.
  const standaloneLinks: { href: string; label: string; key: string }[] = [
    { href: "/talents", label: t.talents, key: "talents" },
    { href: "/queens", label: t.queens, key: "queens" },
    { href: "/builds", label: t.builds, key: "builds" },
    { href: "/creators", label: t.creators, key: "creators" },
    ...(canSeeBetaFeatures
      ? [{ href: "/matches", label: t.matches, key: "matches" }]
      : []),
    { href: "/patch-notes", label: t.patchNotes, key: "patch_notes" },
  ];

  const renderMenuGroup = (label: string, links: MenuLink[]) => (
    <NavigationMenu.Item>
      <NavigationMenu.Trigger
        className={styles.navTrigger}
        data-active={groupActive(links) || undefined}
      >
        {label}
        <NavigationMenu.Icon className={styles.navTriggerIcon}>
          <CaretDownIcon />
        </NavigationMenu.Icon>
      </NavigationMenu.Trigger>
      <NavigationMenu.Content className={styles.navContent}>
        <ul className={styles.navMenuGrid}>
          {links.map((link) => (
            <li key={link.key}>
              <NavigationMenu.Link
                className={styles.navMenuCard}
                closeOnClick
                onClick={() => trackNavClick(link.key)}
                render={<Link href={link.href} prefetch={false} />}
              >
                <EntityIcon src={link.icon} alt="" size="sm" />
                <span className={styles.navMenuCardName}>{link.label}</span>
              </NavigationMenu.Link>
            </li>
          ))}
        </ul>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  );

  const desktopNav = (
    <NavigationMenu.Root className={styles.navMenu} delay={100} closeDelay={120}>
      <NavigationMenu.List className={styles.navMenuList}>
        {renderMenuGroup(t.entities, ENTITY_LINKS)}
        {renderMenuGroup(t.synergies, SYNERGY_LINKS)}
        {standaloneLinks.map((link) => (
          <NavigationMenu.Item key={link.key}>
            <NavigationMenu.Link
              className={styles.navTrigger}
              active={isActive(link.href)}
              onClick={() => trackNavClick(link.key)}
              render={<Link href={link.href} prefetch={false} />}
            >
              {link.label}
            </NavigationMenu.Link>
          </NavigationMenu.Item>
        ))}
      </NavigationMenu.List>

      <NavigationMenu.Portal>
        <NavigationMenu.Positioner
          className={styles.navPositioner}
          sideOffset={12}
          align="start"
          collisionPadding={{ top: 5, bottom: 5, left: 12, right: 12 }}
        >
          <NavigationMenu.Popup className={styles.navPopup}>
            <NavigationMenu.Viewport className={styles.navViewport} />
          </NavigationMenu.Popup>
        </NavigationMenu.Positioner>
      </NavigationMenu.Portal>
    </NavigationMenu.Root>
  );

  const mobileNav = (
    <>
      <span className={styles.mobileGroupLabel}>{t.entities}</span>
      {ENTITY_LINKS.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          className={styles.navLink}
          prefetch={false}
          onClick={() => trackNavClick(link.key)}
        >
          {link.label}
        </Link>
      ))}
      <span className={styles.mobileGroupLabel}>{t.synergies}</span>
      {SYNERGY_LINKS.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          className={styles.navLink}
          prefetch={false}
          onClick={() => trackNavClick(link.key)}
        >
          {link.label}
        </Link>
      ))}
      {standaloneLinks.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          className={styles.navLink}
          prefetch={false}
          onClick={() => trackNavClick(link.key)}
        >
          {link.label}
        </Link>
      ))}
    </>
  );

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.navLeft}>
          <Link href="/" className={styles.navLogo} aria-label={t.home(SITE_NAME)} prefetch={false}>
            <img src="/logo.svg" alt={SITE_NAME} />
          </Link>
          <div className={styles.navLinks}>{desktopNav}</div>
        </div>
        <div className={styles.navRight}>
          {ready ? (
            user ? (
              <>
                <Link href={profileHref} className={styles.navUserLink} prefetch={false} onClick={() => trackNavClick("player_profile")}>
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
        <div className={styles.mobileLinks}>{mobileNav}</div>
      </div>
    </>
  );
}
