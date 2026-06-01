"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseSteamInput, playerProfilePath } from "../lib/steam";
import {
  mergeSearchResults,
  sortSearchResults,
  type SearchResult,
} from "@/lib/playerSearch";
import { bucketCount, trackEvent } from "@/lib/analytics";
import styles from "./ProfileSearch.module.css";

const MAX_VISIBLE_RESULTS = 5;

interface ProfileSearchProps {
  autoFocus?: boolean;
  className?: string;
  initialResults?: SearchResult[];
  analyticsSource?: string;
  placeholder?: string;
}

export function ProfileSearch({
  autoFocus = false,
  className = "",
  initialResults = [],
  analyticsSource = "profile_search",
  placeholder = "Steam vanity URL, profile URL, or Steam ID",
}: ProfileSearchProps) {
  const router = useRouter();
  const [searchValue, setSearchValue] = useState("");
  const [searching, setSearching] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [showLookupBar, setShowLookupBar] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [defaultResults, setDefaultResults] =
    useState<SearchResult[]>(initialResults);
  const [results, setResults] = useState<SearchResult[]>(initialResults);
  const [searchedValue, setSearchedValue] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchReqRef = useRef(0);
  const defaultReqRef = useRef(0);
  const lookupReqRef = useRef(0);
  const lookupBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearLookupBarTimer = () => {
    if (lookupBarTimerRef.current) {
      clearTimeout(lookupBarTimerRef.current);
      lookupBarTimerRef.current = null;
    }
  };

  const localMatches = (value: string): SearchResult[] => {
    const lower = value.toLowerCase();
    if (!lower) return defaultResults;
    return sortSearchResults(
      defaultResults.filter((row) => {
        return (
          row.steam_id.includes(lower) ||
          row.name?.toLowerCase().includes(lower) ||
          row.custom_url?.toLowerCase().includes(lower)
        );
      }),
      value
    );
  };

  useEffect(() => {
    if (defaultResults.length > 0) return;

    const reqId = ++defaultReqRef.current;
    fetch("/api/players/search")
      .then(async (resp) => (resp.ok ? resp.json() : []))
      .then((data) => {
        if (reqId !== defaultReqRef.current) return;
        const rows = Array.isArray(data) ? (data as SearchResult[]) : [];
        setDefaultResults(rows);
        if (!searchValue.trim()) {
          setResults(rows);
          setHighlightedIndex(-1);
        }
      })
      .catch(() => {});
  }, [defaultResults.length, searchValue]);

  useEffect(() => {
    const val = searchValue.trim();
    if (!val) {
      searchReqRef.current += 1;
      setResults(defaultResults);
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

    const localRows = localMatches(safe);
    setResults(localRows);
    setSearchedValue(val);
    setDropdownOpen(true);
    setHighlightedIndex(localRows.length > 0 ? 0 : -1);

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

      const mergedRows = sortSearchResults(
        mergeSearchResults([...rows, ...localRows]),
        val
      );
      setResults(mergedRows);
      setSearchedValue(val);
      setDropdownOpen(true);
      setHighlightedIndex(mergedRows.length > 0 ? 0 : -1);
      setSearching(false);
    }, 80);

    return () => clearTimeout(timeout);
  }, [defaultResults, searchValue]);

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
    trackEvent("Profile Steam Lookup Started", {
      source: analyticsSource,
    });
    clearLookupBarTimer();
    setLookupError(null);
    setLookupLoading(true);
    setShowLookupBar(false);
    setDropdownOpen(false);
    setHighlightedIndex(-1);

    lookupBarTimerRef.current = setTimeout(() => {
      if (reqId === lookupReqRef.current) setShowLookupBar(true);
    }, 600);

    try {
      const resp = await fetch(
        `/api/players/search?q=${encodeURIComponent(lookupValue)}&steam=1`
      );
      if (reqId !== lookupReqRef.current) return;

      if (resp.ok) {
        const data = (await resp.json()) as SearchResult[];
        const first = data[0];
        if (first?.steam_id) {
          trackEvent("Profile Steam Lookup Resolved", {
            source: analyticsSource,
            result_bucket: bucketCount(data.length),
          });
          await navigateToPlayer(first);
          return;
        }
      }

      trackEvent("Profile Steam Lookup Failed", {
        source: analyticsSource,
        reason: "not_found",
      });
      setLookupError("Unable to resolve that Steam profile.");
    } catch {
      if (reqId !== lookupReqRef.current) return;
      trackEvent("Profile Steam Lookup Failed", {
        source: analyticsSource,
        reason: "network",
      });
      setLookupError("Lookup failed. Try again.");
    } finally {
      if (reqId === lookupReqRef.current) {
        clearLookupBarTimer();
        setShowLookupBar(false);
        setLookupLoading(false);
      }
    }
  };

  const selectResult = (result: SearchResult, index: number | null = null) => {
    trackEvent("Profile Search Result Selected", {
      source: analyticsSource,
      position: index == null ? "default" : index + 1,
      result_bucket: bucketCount(results.length),
    });
    void navigateToPlayer(result);
  };

  const visibleResults = results.slice(0, MAX_VISIBLE_RESULTS);
  const canSearchSteam = Boolean(parseSteamInput(searchValue));
  const steamActionIndex = visibleResults.length;
  const showSteamAction =
    dropdownOpen &&
    canSearchSteam &&
    !searching &&
    searchedValue === searchValue.trim();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const val = searchValue.trim();
    if (!val) return;

    trackEvent("Profile Search Submitted", {
      source: analyticsSource,
      can_external_lookup: canSearchSteam,
      has_cached_results: results.length > 0,
      result_bucket: bucketCount(results.length),
    });

    if (
      dropdownOpen &&
      highlightedIndex >= 0 &&
      visibleResults[highlightedIndex]
    ) {
      selectResult(visibleResults[highlightedIndex], highlightedIndex);
      return;
    }

    if (highlightedIndex === steamActionIndex && canSearchSteam) {
      void resolveSteamAndNavigate(val);
      return;
    }

    if (results.length > 0) {
      selectResult(results[0], 0);
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
    const itemCount = visibleResults.length + (showSteamAction ? 1 : 0);
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
    <div className={`${styles.profileSearch} ${className}`} ref={containerRef}>
        <form className={styles.searchForm} onSubmit={handleSearch}>
          <input
            ref={inputRef}
            className={`${styles.searchInput}${lookupLoading ? " " + styles.loading : ""}${
              lookupError ? " " + styles.error : ""
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
              if (searchValue.trim() && results.length > 0) {
                setDropdownOpen(true);
              }
              if (lookupError) setLookupError(null);
            }}
            autoComplete="off"
            autoFocus={autoFocus}
            aria-busy={lookupLoading || searching}
            aria-invalid={Boolean(lookupError)}
          />
          {showLookupBar && (
            <div className={styles.searchProgress} aria-hidden="true">
              <div className={styles.searchProgressBar} />
            </div>
          )}
        </form>
        <div className={styles.searchHelp}>
          <span>Paste your Steam profile URL, vanity URL, or SteamID64.</span>
          <a href="https://steamcommunity.com/my/" target="_blank" rel="noreferrer">
            Open your Steam profile
          </a>
        </div>
        {lookupError && <div className={styles.searchStatus}>{lookupError}</div>}
        {dropdownOpen && (
          <div className={styles.searchDropdown}>
            {results.length === 0 &&
            searchValue.trim() &&
            !searching &&
            searchedValue === searchValue.trim() ? (
              <div className={styles.searchEmpty}>
                We didn't find any users in Track Auto Chess.
              </div>
            ) : null}
            {visibleResults.length > 0
              ? (
                visibleResults.map((r, i) => (
                  <div
                    key={r.steam_id}
                    className={
                      styles.searchResult +
                      (i === highlightedIndex ? " " + styles.highlighted : "")
                    }
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectResult(r, i);
                    }}
                  >
                    <span>{r.name || r.custom_url || r.steam_id}</span>
                    {r.custom_url && (
                      <span className={styles.resultMeta}>/{r.custom_url}</span>
                    )}
                  </div>
                ))
                )
              : null}
            {showSteamAction && visibleResults.length > 0 && (
              <div className={styles.searchDivider}>Not the right player?</div>
            )}
            {showSteamAction && (
              <div
                className={
                  styles.searchResult + " " + styles.searchSteam +
                  (highlightedIndex === steamActionIndex ? " " + styles.highlighted : "")
                }
                onMouseEnter={() => setHighlightedIndex(steamActionIndex)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void resolveSteamAndNavigate(searchValue.trim());
                }}
              >
                <span>Search with Steam</span>
                <span className={styles.resultMeta}>{searchValue.trim()}</span>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
