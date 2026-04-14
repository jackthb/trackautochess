import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

interface NavBarProps {
  supabase?: SupabaseClient | null;
}

export function NavBar({ supabase }: NavBarProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [searchValue, setSearchValue] = useState("");

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const val = searchValue.trim();
    if (val && /^\d+$/.test(val)) {
      router.push(`/players/${val}`);
      setSearchValue("");
    }
  };

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
          height: 56px;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(8, 9, 11, 0.9);
          backdrop-filter: blur(8px);
          position: sticky;
          top: 0;
          z-index: 10;
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
        }
        .nav-logo b {
          color: var(--accent-dim);
        }
        .nav-logo img {
          width: 28px;
          height: 28px;
        }
        .nav-center {
          flex: 1;
          display: flex;
          justify-content: center;
          max-width: 360px;
          margin: 0 32px;
        }
        .search-form {
          display: flex;
          width: 100%;
        }
        .search-input {
          width: 100%;
          font-family: "IBM Plex Mono", monospace;
          font-size: 13px;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border);
          padding: 7px 14px;
          letter-spacing: 0.5px;
          transition: border-color 0.15s;
        }
        .search-input::placeholder {
          color: var(--text-muted);
        }
        .search-input:focus {
          outline: none;
          border-color: var(--accent-dim);
        }
        .nav-right {
          display: flex;
          align-items: center;
          gap: 20px;
          flex-shrink: 0;
        }
        .nav-user {
          font-size: 14px;
          color: var(--text-secondary);
          text-decoration: none;
          transition: color 0.15s;
        }
        .nav-user:hover {
          color: var(--text-primary);
        }
        .nav-btn {
          font-family: "IBM Plex Mono", monospace;
          font-size: 13px;
          color: var(--text-muted);
          background: none;
          border: 1px solid var(--border);
          padding: 6px 16px;
          cursor: pointer;
          letter-spacing: 0.5px;
          transition: all 0.15s;
        }
        .nav-btn:hover {
          color: var(--text-secondary);
          border-color: var(--text-muted);
        }
        .nav-signin {
          font-family: "IBM Plex Mono", monospace;
          font-size: 13px;
          color: var(--text-secondary);
          letter-spacing: 0.5px;
          text-decoration: none;
          transition: color 0.15s;
        }
        .nav-signin:hover {
          color: var(--text-primary);
        }
      `}</style>
      <nav>
        <Link href="/" className="nav-logo">
          <img src="/logo.svg" alt="" />
          <b>DAC</b> Tools
        </Link>
        <div className="nav-center">
          <form className="search-form" onSubmit={handleSearch}>
            <input
              className="search-input"
              type="text"
              placeholder="Look up Steam ID..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </form>
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
          ) : null}
        </div>
      </nav>
    </>
  );
}
