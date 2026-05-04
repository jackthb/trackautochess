import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { SITE_NAME } from "@/lib/site";
import { isAdminSteamId } from "@/lib/admin";
import { normalizeLocale } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import styles from "./NavBar.module.css";

interface NavBarProps {
  supabase?: SupabaseClient | null;
}

const T = {
  en: {
    items: "Items",
    units: "Units",
    classes: "Classes",
    species: "Species",
    relics: "Relics",
    talents: "Talents",
    ranks: "Ranks",
    leaderboard: "Leaderboard",
    patchNotes: "Patch Notes",
    signOut: "Sign out",
    signIn: "Sign in with Steam",
    placeholderName: "Steam Player Name",
    home: (n: string) => `${n} home`,
    fallbackPlayer: "Player",
  },
  ru: {
    items: "Предметы",
    units: "Фигуры",
    classes: "Классы",
    species: "Расы",
    relics: "Реликвии",
    talents: "Таланты",
    ranks: "Ранги",
    leaderboard: "Таблица лидеров",
    patchNotes: "Патчноуты",
    signOut: "Выйти",
    signIn: "Войти через Steam",
    placeholderName: "Имя игрока Steam",
    home: (n: string) => `Главная ${n}`,
    fallbackPlayer: "Игрок",
  },
} as const;

export function NavBar({ supabase }: NavBarProps) {
  const router = useRouter();
  const locale = normalizeLocale(router.locale ?? router.defaultLocale ?? undefined);
  const t = T[locale];
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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
  const isAdmin = isAdminSteamId(sessionSteamId);

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.navLeft}>
          <Link href="/" className={styles.navLogo} aria-label={t.home(SITE_NAME)}>
            <img src="/logo.svg" alt={SITE_NAME} />
          </Link>
          <div className={styles.navLinks}>
            <Link href="/items" className={styles.navLink}>
              {t.items}
            </Link>
            <Link href="/units" className={styles.navLink}>
              {t.units}
            </Link>
            <Link href="/classes" className={styles.navLink}>
              {t.classes}
            </Link>
            <Link href="/species" className={styles.navLink}>
              {t.species}
            </Link>
            <Link href="/relics" className={styles.navLink}>
              {t.relics}
            </Link>
            <Link href="/talents" className={styles.navLink}>
              {t.talents}
            </Link>
            <Link href="/ranks" className={styles.navLink}>
              {t.ranks}
            </Link>
            {isAdmin && (
              <Link href="/leaderboard" className={styles.navLink}>
                {t.leaderboard}
              </Link>
            )}
            <Link href="/patch-notes" className={styles.navLink} locale={false}>
              {t.patchNotes}
            </Link>
          </div>
        </div>
        <div className={styles.navRight}>
          <LanguageSwitcher />
          {ready ? (
            user ? (
              <>
                <Link href="/dashboard" className={styles.navUserLink}>
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
                <button className={styles.navBtn} onClick={handleLogout}>
                  {t.signOut}
                </button>
              </>
            ) : (
              <a href="/api/auth/steam" className={styles.navSignin}>
                {t.signIn}
              </a>
            )
          ) : supabase ? (
            <div className={styles.navAuthPlaceholder} aria-hidden="true">
              <span className={styles.navUser}>{t.placeholderName}</span>
              <span className={styles.navBtn}>{t.signOut}</span>
            </div>
          ) : null}
        </div>
      </nav>
    </>
  );
}
