"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseSteamInput, playerProfilePath } from "@/lib/steam";
import { type SearchResult } from "@/lib/playerSearch";
import {
  addRecentPlayer,
  getRecentPlayers,
  type RecentPlayer,
} from "@/lib/recentPlayers";
import { bucketCount, trackEvent } from "@/lib/analytics";
import styles from "./ProfileSearch.module.css";

interface ProfileSearchProps {
  autoFocus?: boolean;
  className?: string;
  analyticsSource?: string;
  placeholder?: string;
  /** Optional example input shown beneath the box (e.g. a Steam profile URL). */
  exampleUrl?: string;
}

export function ProfileSearch({
  autoFocus = false,
  className = "",
  analyticsSource = "profile_search",
  placeholder = "Steam vanity URL, profile URL, or Steam ID",
  exampleUrl,
}: ProfileSearchProps) {
  const router = useRouter();
  const [searchValue, setSearchValue] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentPlayer[]>([]);
  const lookupReqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load recents from localStorage on the client (after mount, to avoid a
  // server/client hydration mismatch).
  useEffect(() => setRecents(getRecentPlayers()), []);

  const navigateToPlayer = async (
    result: Pick<SearchResult, "steam_id" | "custom_url" | "name">,
  ) => {
    setRecents(
      addRecentPlayer({
        steam_id: result.steam_id,
        name: result.name ?? null,
        custom_url: result.custom_url ?? null,
      }),
    );
    setLookupError(null);
    await router.push(playerProfilePath(result.steam_id, result.custom_url));
  };

  // Resolve the input to a real profile, then navigate. Never navigate to an
  // unverified guess: if the Steam ID/vanity doesn't resolve to anything, show
  // an inline error and stay put.
  const resolveAndNavigate = async (lookupValue: string) => {
    const reqId = ++lookupReqRef.current;
    trackEvent("Profile Steam Lookup Started", { source: analyticsSource });
    setLookupError(null);
    setLookupLoading(true);

    try {
      const resp = await fetch(
        `/api/players/search?q=${encodeURIComponent(lookupValue)}&steam=1`,
      );
      if (reqId !== lookupReqRef.current) return;

      if (resp.ok) {
        const data = (await resp.json()) as SearchResult[];
        const first = data[0];
        if (first?.steam_id) {
          // Resolved a Steam profile, but it has no Auto Chess data — don't
          // open an empty profile; surface it as an error in place.
          if (!first.has_autochess_profile && !first.has_games) {
            trackEvent("Profile Steam Lookup Failed", {
              source: analyticsSource,
              reason: "no_autochess",
            });
            setLookupError(
              "No public Auto Chess stats found for this Steam profile.",
            );
            return;
          }
          trackEvent("Profile Steam Lookup Resolved", {
            source: analyticsSource,
            result_bucket: bucketCount(data.length),
          });
          setLookupDone(true);
          await navigateToPlayer(first);
          return;
        }
      }

      trackEvent("Profile Steam Lookup Failed", {
        source: analyticsSource,
        reason: "not_found",
      });
      setLookupError("We couldn't find that Steam profile. Check the ID or URL.");
    } catch {
      if (reqId !== lookupReqRef.current) return;
      trackEvent("Profile Steam Lookup Failed", {
        source: analyticsSource,
        reason: "network",
      });
      setLookupError("Lookup failed. Try again.");
    } finally {
      if (reqId === lookupReqRef.current) setLookupLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const val = searchValue.trim();
    if (!val || lookupLoading || lookupDone) return;

    if (!parseSteamInput(val)) {
      setLookupError("Enter a Steam ID, vanity name, or profile URL.");
      return;
    }

    trackEvent("Profile Search Submitted", {
      source: analyticsSource,
      can_external_lookup: true,
    });
    void resolveAndNavigate(val);
  };

  const buttonLabel = lookupDone
    ? "Opening…"
    : lookupLoading
      ? "Searching…"
      : "Search";
  // Drop the scheme for display so the whole help line fits on one row.
  const exampleDisplay = exampleUrl ? exampleUrl.replace(/^https?:\/\//, "") : "";

  return (
    <div className={`${styles.profileSearch} ${className}`}>
      <div className={styles.searchHelp}>
        <a
          href="https://steamcommunity.com/my/"
          target="_blank"
          rel="noreferrer"
        >
          Find your Steam profile URL
        </a>
        {exampleUrl && (
          <>
            <span className={styles.searchHelpArrow} aria-hidden="true">
              &rarr;
            </span>
            <span className={styles.searchExampleUrl}>{exampleDisplay}</span>
          </>
        )}
      </div>
      <form className={styles.searchForm} onSubmit={handleSearch}>
        <div className={styles.inputWrap}>
          <svg
            className={styles.searchIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
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
            autoComplete="off"
            autoFocus={autoFocus}
            aria-busy={lookupLoading}
            aria-invalid={Boolean(lookupError)}
          />
        </div>
        <button
          type="submit"
          className={styles.searchButton}
          disabled={lookupLoading || lookupDone}
        >
          {buttonLabel}
        </button>
      </form>
      {lookupError && <div className={styles.searchStatus}>{lookupError}</div>}
      {!searchValue.trim() && recents.length > 0 && (
        <div className={styles.recents}>
          <span className={styles.recentsLabel}>Recent</span>
          <div className={styles.recentChips}>
            {recents.map((r) => (
              <button
                type="button"
                key={r.steam_id}
                className={styles.recentChip}
                onClick={() => void navigateToPlayer(r)}
              >
                {r.name || (r.custom_url ? `/${r.custom_url}` : r.steam_id)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
