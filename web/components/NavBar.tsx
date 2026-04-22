import { useRouter } from "next/router";
import { useState, useEffect, useRef } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

interface SearchResult {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
}

interface NavBarProps {
  supabase?: SupabaseClient | null;
}

export function NavBar({ supabase }: NavBarProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [queriedValue, setQueriedValue] = useState("");
  const searchReqRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Debounced lookup: queries as the user types, caps at 8 matches.
  useEffect(() => {
    const val = searchValue.trim();
    // Skip text lookup for numeric IDs and full Steam URLs — those are handled
    // on submit.
    const looksLikeUrl = /steamcommunity\.com\//i.test(val);
    if (!val || /^\d+$/.test(val) || looksLikeUrl || !supabase) {
      setResults([]);
      setDropdownOpen(false);
      setHighlightedIndex(-1);
      setSearching(false);
      return;
    }

    // PostgREST .or() uses commas/parens as separators; strip conflicting chars.
    const safe = val.replace(/[,()%*]/g, "");
    if (!safe) return;

    const reqId = ++searchReqRef.current;
    setSearching(true);
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from("users")
        .select("steam_id, name, custom_url")
        .or(`name.ilike.*${safe}*,custom_url.ilike.*${safe}*`)
        .limit(8);

      if (reqId !== searchReqRef.current) return; // stale response

      const rows = (data ?? []) as SearchResult[];
      const lower = val.toLowerCase();
      rows.sort((a, b) => {
        const aExact =
          a.custom_url === val || a.name?.toLowerCase() === lower ? 0 : 1;
        const bExact =
          b.custom_url === val || b.name?.toLowerCase() === lower ? 0 : 1;
        return aExact - bExact;
      });

      setResults(rows);
      setQueriedValue(val);
      setDropdownOpen(true);
      setHighlightedIndex(rows.length > 0 ? 0 : -1);
      setSearching(false);
    }, 200);

    return () => clearTimeout(timeout);
  }, [searchValue, supabase]);

  // Click outside closes the dropdown.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectResult = (steamId: string) => {
    router.push(`/players/${steamId}`);
    setSearchValue("");
    setResults([]);
    setDropdownOpen(false);
    setHighlightedIndex(-1);
  };

  // Pull an ID or a custom URL slug out of anything a user might paste:
  //   https://steamcommunity.com/id/agit142/
  //   https://steamcommunity.com/profiles/76561198000000000
  //   agit142
  //   76561198000000000
  const parseSteamInput = (
    raw: string
  ): { kind: "id" | "slug"; value: string } | null => {
    const val = raw.trim();
    if (!val) return null;
    const profileMatch = val.match(
      /steamcommunity\.com\/profiles\/(\d{17})/i
    );
    if (profileMatch) return { kind: "id", value: profileMatch[1] };
    const idMatch = val.match(
      /steamcommunity\.com\/id\/([A-Za-z0-9_-]+)/i
    );
    if (idMatch) return { kind: "slug", value: idMatch[1] };
    if (/^\d{17}$/.test(val)) return { kind: "id", value: val };
    return null;
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const val = searchValue.trim();
    if (!val) return;

    if (dropdownOpen && highlightedIndex >= 0 && results[highlightedIndex]) {
      selectResult(results[highlightedIndex].steam_id);
      return;
    }

    const parsed = parseSteamInput(val);
    if (parsed) {
      // /players/[steamId] resolves slugs against Steam's XML API on the server.
      selectResult(parsed.value);
      return;
    }

    if (results.length > 0) {
      selectResult(results[0].steam_id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setDropdownOpen(false);
      return;
    }
    if (!dropdownOpen || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(
        (i) => (i - 1 + results.length) % results.length
      );
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
          line-height: 1;
        }
        .nav-logo b {
          color: var(--accent-dim);
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
        .nav-center {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          max-width: 360px;
          margin: 0 32px;
          position: relative;
        }
        .search-form {
          display: flex;
          width: 100%;
        }
        .search-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          margin-top: 2px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          max-height: 320px;
          overflow-y: auto;
          z-index: 20;
        }
        .search-result {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 8px 14px;
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--text-primary);
          cursor: pointer;
          border-bottom: 1px solid var(--border-subtle);
        }
        .search-result:last-child {
          border-bottom: none;
        }
        .search-result.highlighted {
          background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
        }
        .result-name {
          color: var(--text-primary);
        }
        .result-meta {
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .search-empty {
          padding: 10px 14px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .search-input {
          width: 100%;
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--r-3);
          padding: 7px 14px;
          letter-spacing: var(--tr-body);
          transition: border-color var(--t-base) var(--t-easing);
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
          justify-content: flex-end;
          gap: 20px;
          flex-shrink: 0;
          min-width: 272px;
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
      `}</style>
      <nav>
        <a href="/" className="nav-logo" style={{ display: "flex", alignItems: "center" }}>
          <img src="/logo.svg" alt="DAC Tools" />
        </a>
        <div className="nav-links">
          <a href="/items" className="nav-link">Items</a>
          <a href="/relics" className="nav-link">Relics</a>
          <a href="/patch-notes" className="nav-link">Patch Notes</a>
        </div>
        <div className="nav-center" ref={containerRef}>
          <form className="search-form" onSubmit={handleSearch}>
            <input
              className="search-input"
              type="text"
              placeholder="Look up Steam ID or name..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (results.length > 0) setDropdownOpen(true);
              }}
              autoComplete="off"
            />
          </form>
          {dropdownOpen && (
            <div className="search-dropdown">
              {results.length > 0 ? (
                results.map((r, i) => (
                  <div
                    key={r.steam_id}
                    className={
                      "search-result" +
                      (i === highlightedIndex ? " highlighted" : "")
                    }
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectResult(r.steam_id);
                    }}
                  >
                    <span className="result-name">
                      {r.name || r.custom_url || r.steam_id}
                    </span>
                    {r.custom_url && r.name && (
                      <span className="result-meta">/{r.custom_url}</span>
                    )}
                  </div>
                ))
              ) : !searching && queriedValue ? (
                <div className="search-empty">
                  No players matching &ldquo;{queriedValue}&rdquo;
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="nav-right">
          {ready ? (
            user ? (
              <>
                <a href="/dashboard" className="nav-user">
                  {displayName}
                </a>
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
