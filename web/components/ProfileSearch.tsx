import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { parseSteamInput, playerProfilePath } from "../lib/steam";

interface SearchResult {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  has_autochess_profile?: boolean;
  has_games?: boolean;
}

interface ProfileSearchProps {
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

export function ProfileSearch({
  autoFocus = false,
  className = "",
  placeholder = "Steam vanity URL, profile URL, or Steam ID",
}: ProfileSearchProps) {
  const router = useRouter();
  const [searchValue, setSearchValue] = useState("");
  const [searching, setSearching] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [showLookupBar, setShowLookupBar] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchedValue, setSearchedValue] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchReqRef = useRef(0);
  const lookupReqRef = useRef(0);
  const lookupBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clearLookupBarTimer = () => {
    if (lookupBarTimerRef.current) {
      clearTimeout(lookupBarTimerRef.current);
      lookupBarTimerRef.current = null;
    }
  };

  useEffect(() => {
    const val = searchValue.trim();
    if (!val) {
      setResults([]);
      setSearchedValue("");
      setDropdownOpen(false);
      setHighlightedIndex(-1);
      setSearching(false);
      return;
    }

    const safe = val.replace(/[,()%*]/g, "");
    if (!safe) {
      setResults([]);
      setSearchedValue(val);
      setDropdownOpen(true);
      setHighlightedIndex(-1);
      setSearching(false);
      return;
    }

    const reqId = ++searchReqRef.current;
    setSearching(true);
    const timeout = setTimeout(async () => {
      let rows: SearchResult[] = [];
      try {
        const resp = await fetch(
          `/api/players/search?q=${encodeURIComponent(safe)}`
        );
        if (resp.ok) {
          const data = await resp.json();
          rows = Array.isArray(data) ? (data as SearchResult[]) : [];
        }
      } catch {}

      if (reqId !== searchReqRef.current) return;

      const lower = val.toLowerCase();
      const resultRank = (row: SearchResult) => {
        if (row.has_autochess_profile) return 0;
        if (row.has_games) return 1;
        return 2;
      };
      const exactRank = (row: SearchResult) => {
        if (row.custom_url?.toLowerCase() === lower) return 0;
        if (row.name?.toLowerCase() === lower) return 1;
        return 2;
      };
      rows.sort((a, b) => {
        return resultRank(a) - resultRank(b) || exactRank(a) - exactRank(b);
      });

      setResults(rows);
      setSearchedValue(val);
      setDropdownOpen(true);
      setHighlightedIndex(rows.length > 0 ? 0 : -1);
      setSearching(false);
    }, 200);

    return () => clearTimeout(timeout);
  }, [searchValue]);

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

  useEffect(() => clearLookupBarTimer, []);

  const navigateToPlayer = async (
    result: Pick<SearchResult, "steam_id" | "custom_url">
  ) => {
    setSearchValue("");
    setResults([]);
    setSearchedValue("");
    setDropdownOpen(false);
    setHighlightedIndex(-1);
    setLookupError(null);
    await router.push(playerProfilePath(result.steam_id, result.custom_url));
  };

  const resolveSteamAndNavigate = async (lookupValue: string) => {
    const reqId = ++lookupReqRef.current;
    clearLookupBarTimer();
    setLookupError(null);
    setLookupLoading(true);
    setShowLookupBar(false);
    setDropdownOpen(false);
    setHighlightedIndex(-1);

    lookupBarTimerRef.current = setTimeout(() => {
      if (reqId === lookupReqRef.current) setShowLookupBar(true);
    }, 160);

    try {
      const resp = await fetch(
        `/api/players/search?q=${encodeURIComponent(lookupValue)}&steam=1`
      );
      if (reqId !== lookupReqRef.current) return;

      if (resp.ok) {
        const data = (await resp.json()) as SearchResult[];
        const first = data[0];
        if (first?.steam_id) {
          await navigateToPlayer(first);
          return;
        }
      }

      setLookupError("Unable to resolve that Steam profile.");
    } catch {
      if (reqId !== lookupReqRef.current) return;
      setLookupError("Lookup failed. Try again.");
    } finally {
      if (reqId === lookupReqRef.current) {
        clearLookupBarTimer();
        setShowLookupBar(false);
        setLookupLoading(false);
      }
    }
  };

  const selectResult = (result: SearchResult) => {
    void navigateToPlayer(result);
  };

  const canSearchSteam = Boolean(parseSteamInput(searchValue));
  const steamActionIndex = results.length;
  const showSteamAction =
    dropdownOpen &&
    canSearchSteam &&
    !searching &&
    searchedValue === searchValue.trim();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const val = searchValue.trim();
    if (!val) return;

    if (dropdownOpen && highlightedIndex >= 0 && results[highlightedIndex]) {
      selectResult(results[highlightedIndex]);
      return;
    }

    if (highlightedIndex === steamActionIndex && canSearchSteam) {
      void resolveSteamAndNavigate(val);
      return;
    }

    if (results.length > 0) {
      selectResult(results[0]);
      return;
    }

    if (canSearchSteam) {
      setDropdownOpen(true);
      setHighlightedIndex(steamActionIndex);
      return;
    }

    setLookupError("Enter a Steam profile URL, vanity name, or Steam ID.");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setDropdownOpen(false);
      return;
    }
    if (!dropdownOpen) return;
    const itemCount = results.length + (showSteamAction ? 1 : 0);
    if (itemCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % itemCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i - 1 + itemCount) % itemCount);
    }
  };

  return (
    <>
      <style jsx>{`
        .profile-search {
          position: relative;
          z-index: 40;
          width: 100%;
        }
        .search-form {
          display: flex;
          width: 100%;
        }
        .search-input {
          width: 100%;
          height: 46px;
          font-family: var(--font-mono);
          font-size: var(--fs-14);
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--r-3);
          padding: 0 16px;
          letter-spacing: var(--tr-body);
          transition: border-color var(--t-base) var(--t-easing), background var(--t-base) var(--t-easing);
        }
        .search-input.loading {
          border-color: var(--accent-dim);
        }
        .search-input.error {
          border-color: var(--accent);
        }
        .search-input::placeholder {
          color: var(--text-muted);
        }
        .search-input:focus {
          outline: none;
          border-color: var(--accent-dim);
          background: rgba(18, 20, 24, 0.96);
        }
        .search-progress {
          position: absolute;
          top: calc(100% + 3px);
          left: 10px;
          right: 10px;
          height: 2px;
          overflow: hidden;
          pointer-events: none;
        }
        .search-progress-bar {
          width: 34%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            var(--accent-dim),
            var(--accent),
            transparent
          );
          animation: lookupBar 1s ease-in-out infinite;
        }
        .search-status,
        .search-dropdown {
          position: absolute;
          top: calc(100% + 10px);
          left: 0;
          right: 0;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--r-3);
          z-index: 50;
        }
        .search-status {
          padding: 9px 12px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.4px;
        }
        .search-dropdown {
          max-height: 320px;
          overflow: hidden auto;
        }
        .search-empty {
          padding: 9px 14px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.4px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .search-result {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 9px 14px;
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
        .search-steam {
          justify-content: space-between;
        }
        .result-meta {
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .search-divider {
          padding: 8px 14px;
          border-top: 1px solid var(--border-subtle);
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.4px;
        }
        @keyframes lookupBar {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(320%);
          }
        }
      `}</style>
      <div className={`profile-search ${className}`} ref={containerRef}>
        <form className="search-form" onSubmit={handleSearch}>
          <input
            className={`search-input${lookupLoading ? " loading" : ""}${
              lookupError ? " error" : ""
            }`}
            type="text"
            placeholder={placeholder}
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
              if (lookupError) setLookupError(null);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (results.length > 0) setDropdownOpen(true);
              if (lookupError) setLookupError(null);
            }}
            autoComplete="off"
            autoFocus={autoFocus}
            aria-busy={lookupLoading || searching}
            aria-invalid={Boolean(lookupError)}
          />
        </form>
        {showLookupBar && (
          <div className="search-progress" aria-hidden="true">
            <div className="search-progress-bar" />
          </div>
        )}
        {lookupError && <div className="search-status">{lookupError}</div>}
        {dropdownOpen && (
          <div className="search-dropdown">
            {results.length === 0 &&
            !searching &&
            searchedValue === searchValue.trim() ? (
              <div className="search-empty">
                We didn't find any users in Track Auto Chess.
              </div>
            ) : null}
            {results.length > 0
              ? (
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
                    selectResult(r);
                  }}
                >
                  <span>{r.name || r.custom_url || r.steam_id}</span>
                  {r.custom_url && (
                    <span className="result-meta">/{r.custom_url}</span>
                  )}
                </div>
              ))
                )
              : null}
            {showSteamAction && results.length > 0 && (
              <div className="search-divider">Not the right player?</div>
            )}
            {showSteamAction && (
              <div
                className={
                  "search-result search-steam" +
                  (highlightedIndex === steamActionIndex ? " highlighted" : "")
                }
                onMouseEnter={() => setHighlightedIndex(steamActionIndex)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void resolveSteamAndNavigate(searchValue.trim());
                }}
              >
                <span>Search Steam?</span>
                <span className="result-meta">{searchValue.trim()}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
