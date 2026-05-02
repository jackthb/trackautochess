import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { SITE_NAME } from "@/lib/site";
import styles from "./NavBar.module.css";

interface NavBarProps {
  supabase?: SupabaseClient | null;
}

export function NavBar({ supabase }: NavBarProps) {
  const router = useRouter();
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
    "Player";

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.navLeft}>
          <Link href="/" className={styles.navLogo} aria-label={`${SITE_NAME} home`}>
            <img src="/logo.svg" alt={SITE_NAME} />
          </Link>
          <div className={styles.navLinks}>
            <Link href="/items" className={styles.navLink}>
              Items
            </Link>
            <Link href="/units" className={styles.navLink}>
              Units
            </Link>
            <Link href="/classes" className={styles.navLink}>
              Classes
            </Link>
            <Link href="/species" className={styles.navLink}>
              Species
            </Link>
            <Link href="/relics" className={styles.navLink}>
              Relics
            </Link>
            <Link href="/talents" className={styles.navLink}>
              Talents
            </Link>
            <Link href="/patch-notes" className={styles.navLink}>
              Patch Notes
            </Link>
          </div>
        </div>
        <div className={styles.navRight}>
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
                  Sign out
                </button>
              </>
            ) : (
              <a href="/api/auth/steam" className={styles.navSignin}>
                Sign in with Steam
              </a>
            )
          ) : supabase ? (
            <div className={styles.navAuthPlaceholder} aria-hidden="true">
              <span className={styles.navUser}>Steam Player Name</span>
              <span className={styles.navBtn}>Sign out</span>
            </div>
          ) : null}
        </div>
      </nav>
    </>
  );
}
