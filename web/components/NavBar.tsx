import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { SITE_NAME } from "@/lib/site";

interface NavBarProps {
  supabase?: SupabaseClient | null;
}

export function NavBar({ supabase }: NavBarProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

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
      <style jsx>{`
        nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 40px;
          height: var(--nav-height);
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(8, 9, 11, 0.9);
          backdrop-filter: blur(8px);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .nav-left {
          display: flex;
          align-items: center;
          min-width: 0;
        }
        .nav-logo {
          font-family: "Cinzel", serif;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          flex-shrink: 0;
          line-height: 1;
        }
        .nav-logo img {
          width: 28px;
          height: 28px;
          display: block;
        }
        .nav-links {
          display: flex;
          align-items: center;
          gap: 22px;
          margin-left: 28px;
          flex-shrink: 0;
        }
        .nav-link {
          font-family: var(--font-mono);
          font-size: 12px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          text-decoration: none;
          transition: color 0.15s;
        }
        .nav-link:hover {
          color: var(--text-primary);
        }
        .nav-right {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 20px;
          flex-shrink: 0;
          min-width: 220px;
        }
        .nav-user {
          display: block;
          max-width: 152px;
          font-size: 14px;
          color: var(--text-secondary);
          text-decoration: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: right;
          transition: color 0.15s;
        }
        .nav-user:hover {
          color: var(--text-primary);
        }
        .nav-auth-placeholder {
          display: flex;
          align-items: center;
          gap: 20px;
          visibility: hidden;
          pointer-events: none;
        }
        .nav-btn {
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          color: var(--text-muted);
          background: none;
          border: 1px solid var(--border);
          border-radius: var(--r-4);
          padding: 7px 18px;
          cursor: pointer;
          letter-spacing: var(--tr-body);
          transition: color var(--t-base) var(--t-easing), border-color var(--t-base) var(--t-easing), background var(--t-base) var(--t-easing);
        }
        .nav-btn:hover {
          color: var(--text-secondary);
          border-color: var(--text-muted);
        }
        .nav-signin {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--text-secondary);
          letter-spacing: 0.5px;
          text-decoration: none;
          transition: color 0.15s;
        }
        .nav-signin:hover {
          color: var(--text-primary);
        }
        @media (max-width: 760px) {
          nav {
            padding: 0 18px;
          }
          .nav-links {
            gap: 14px;
            margin-left: 18px;
          }
          .nav-right {
            min-width: 0;
            gap: 12px;
          }
          .nav-link,
          .nav-signin,
          .nav-btn {
            font-size: 11px;
          }
        }
      `}</style>
      <nav>
        <div className="nav-left">
          <Link href="/" className="nav-logo" aria-label={`${SITE_NAME} home`}>
            <img src="/logo.svg" alt={SITE_NAME} />
          </Link>
          <div className="nav-links">
            <Link href="/items" className="nav-link">
              Items
            </Link>
            <Link href="/relics" className="nav-link">
              Relics
            </Link>
            <Link href="/patch-notes" className="nav-link">
              Patch Notes
            </Link>
          </div>
        </div>
        <div className="nav-right">
          {ready ? (
            user ? (
              <>
                <Link href="/dashboard" className="nav-user">
                  {displayName}
                </Link>
                <button className="nav-btn" onClick={handleLogout}>
                  Sign out
                </button>
              </>
            ) : (
              <a href="/api/auth/steam" className="nav-signin">
                Sign in with Steam
              </a>
            )
          ) : supabase ? (
            <div className="nav-auth-placeholder" aria-hidden="true">
              <span className="nav-user">Steam Player Name</span>
              <span className="nav-btn">Sign out</span>
            </div>
          ) : null}
        </div>
      </nav>
    </>
  );
}
