import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import unitsFullData from "@data/units_full.json";
import { UNIT_COSTS, computeSynergies } from "@/lib/units";
import synergiesData from "@data/synergies.json";
import relicsData from "@data/relics.json";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";
import {
  parseLineup,
  parseSynergies,
  parseRelics,
  placementColor,
  costBorderColor,
  unitStem,
  synIconName,
  relicStem,
  RANK_BRACKETS,
} from "@dac/shared/game-utils";

function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1 || level > RANK_BRACKETS.length) return "";
  return RANK_BRACKETS[level - 1].rank.replace("-", " ");
}
import { TooltipWrap, type TooltipData } from "@dac/shared/Tooltip";
import {
  fetchSteamProfile,
  playerProfilePath,
  steamProfileUrl,
  type SteamProfile,
} from "../../lib/steam";
import { SeoHead } from "@/lib/seo";
import { absoluteUrl, getRequestSiteUrl } from "@/lib/site";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import { resolveIconUrl } from "@/lib/icons";

const UNITS_FULL = unitsFullData as Record<string, UnitFullInfo>;
const SYNERGIES_DATA = synergiesData as Record<string, SynergyInfo>;
const RELICS_DATA = (relicsData as any).relics as Record<string, RelicInfo>;

const iconUrl = resolveIconUrl;

/** One entry in a player's relic-acquisition timeline. */
interface RelicTimelineEntry {
  round: number;
  /** Display name like "Magic Seed". */
  name: string;
}

/** Per-player state at a single round, captured by the live nettable
 *  ingest. Shape mirrors what nettable_capture._extract_players_state_from_rows
 *  writes into the local timeline JSON. */
interface TimelinePlayerSnap {
  hp?: number;
  level?: number;
  placement?: number;
  lineup?: string;
  lineup_value?: number;
  total_money?: number;
  win_round?: number;
  lose_round?: number;
  mmr_level?: number;
}

interface TimelineRound {
  round: number;
  captured_at?: string;
  players?: Record<string, TimelinePlayerSnap>;
}

interface MatchTimeline {
  match_id: string;
  played_at?: string;
  round_count: number;
  first_round: number;
  last_round: number;
  rounds: TimelineRound[];
}

interface GamePageProps {
  game: Game;
  steamProfile: SteamProfile;
  matchGames: Game[];
  matchProfiles: Record<string, SteamProfile>;
  /** Per-player relic acquisition timeline, keyed by steam_id (string). */
  relicTimelines: Record<string, RelicTimelineEntry[]>;
  /** Per-match round-by-round snapshots; null when no nettable timeline exists. */
  timeline: MatchTimeline | null;
  highlightUserId: string | null;
  highlightName: string | null;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  supabase: SupabaseClient | null;
}

function normalizeName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function originFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}


/** The "expanded" detail panel for a player row — bigger icons, full relic
 *  timeline. Lineup/synergies/relics are pre-parsed by MatchPlayerRow so
 *  the same snap-aware arrays power both the compact view and this panel. */
function PlayerDetail({
  lineup,
  synergies,
  relicsToShow,
  hasRelicTimeline,
  tooltipData,
  hp,
  gold,
}: {
  lineup: { name: string; stars: number }[];
  synergies: { name: string; count: number }[];
  relicsToShow: RelicTimelineEntry[];
  hasRelicTimeline: boolean;
  tooltipData: TooltipData;
  hp: number | null;
  gold: number | null;
}) {
  return (
    <div className="player-detail">
      {(hp != null || gold != null) && (
        <div className="pd-live-stats">
          {hp != null && <span className="mp-hp">HP {hp}</span>}
          {gold != null && <span className="mp-gold">Gold {gold}</span>}
        </div>
      )}
      {lineup.length > 0 && (
        <div className="pd-section">
          <div className="pd-label">Lineup</div>
          <div className="pd-lineup">
            {lineup.map((u, i) => (
              <TooltipWrap
                key={i}
                type="unit"
                name={u.name}
                stars={u.stars}
                data={tooltipData}
              >
                <div className="unit-icon-wrap pd-unit">
                  <img
                    className="unit-icon"
                    src={iconUrl("units", unitStem(u.name))}
                    alt={u.name}
                    loading="lazy"
                    style={{
                      borderColor: costBorderColor(UNIT_COSTS[u.name] || 1),
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  {u.stars > 1 && (
                    <span className={`unit-stars s${u.stars}`}>
                      {"★".repeat(u.stars)}
                    </span>
                  )}
                </div>
              </TooltipWrap>
            ))}
          </div>
        </div>
      )}

      {synergies.length > 0 && (
        <div className="pd-section">
          <div className="pd-label">Synergies</div>
          <div className="pd-synergies">
            {synergies.map((s, i) => (
              <TooltipWrap
                key={i}
                type="synergy"
                name={s.name}
                count={s.count}
                data={tooltipData}
              >
                <div className="syn-badge pd-syn-badge">
                  <img
                    className="syn-icon"
                    src={iconUrl("synergies", synIconName(s.name))}
                    alt={s.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <span className="syn-count">{s.count}</span>
                </div>
              </TooltipWrap>
            ))}
          </div>
        </div>
      )}

      {relicsToShow.length > 0 && (
        <div className="pd-section">
          <div className="pd-label">
            Relics
            {hasRelicTimeline && (
              <span className="pd-label-hint">{" "}· acquired round</span>
            )}
          </div>
          <div className="pd-relics">
            {relicsToShow.map((r, i) => (
              <div key={i} className="pd-relic">
                <TooltipWrap
                  type="relic"
                  name={r.name}
                  relicIndex={i}
                  data={tooltipData}
                >
                  <img
                    className="relic-icon pd-relic-icon"
                    src={iconUrl("relics", relicStem(r.name))}
                    alt={r.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </TooltipWrap>
                {r.round > 0 && (
                  <span className="pd-relic-round">R{r.round}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact row for a player in the match table — clickable to expand. */
function MatchPlayerRow({
  game,
  profile,
  highlighted,
  expanded,
  onToggle,
  relicTimeline,
  snap,
  prevSnap,
  snapRound,
  isLastRound,
  tooltipData,
}: {
  game: Game;
  profile: SteamProfile;
  highlighted: boolean;
  expanded: boolean;
  onToggle: () => void;
  relicTimeline: RelicTimelineEntry[] | undefined;
  snap: TimelinePlayerSnap | null;
  prevSnap: TimelinePlayerSnap | null;
  snapRound: number | null;
  isLastRound: boolean;
  tooltipData: TooltipData;
}) {
  const p = parseInt(game.placement) || 0;
  const pColor = placementColor(p);
  // OCR'd player name lives in `notes` when the Game Over uploader couldn't
  // link the row to a Steam account.
  const ocrName = game.notes && game.notes.trim() ? game.notes.trim() : null;
  const displayName =
    profile.name ||
    ocrName ||
    (game.user_id ? String(game.user_id) : `Player #${game.placement}`);
  const hasProfile = Boolean(game.user_id);
  const profileUrl = hasProfile
    ? steamProfileUrl(String(game.user_id), profile.customUrl)
    : null;

  // When the scrubber is active, prefer the snapshot's lineup. Falls back
  // to the static games.lineup for rows without a snapshot at this round.
  const lineupStr = snap?.lineup ?? game.lineup;
  const lineup = parseLineup(lineupStr, UNIT_COSTS);

  const isScrubbing = snapRound !== null && !isLastRound;
  const parsedSyn = !isScrubbing ? parseSynergies(game.synergies) : [];
  const synergies = parsedSyn.length > 0 ? parsedSyn : computeSynergies(lineup);

  // Compact-view relic list: prefer the full set from relic_history, fall
  // back to the single `relic` field for CV-captured rows. When scrubber
  // is at round N, hide relics acquired AFTER N.
  const hasRelicTimeline = !!(relicTimeline && relicTimeline.length > 0);
  const allRelics: RelicTimelineEntry[] = hasRelicTimeline
    ? relicTimeline!
    : parseRelics(game.relic).map((name) => ({ name, round: 0 }));
  const compactRelics =
    snapRound !== null
      ? allRelics.filter((r) => r.round === 0 || r.round <= snapRound)
      : allRelics;

  // Snapshot may override level + record while scrubbing.
  const displayGame: Game = snap
    ? {
        ...game,
        level: snap.level != null ? String(snap.level) : game.level,
        wins: snap.win_round ?? game.wins,
        losses: snap.lose_round ?? game.losses,
      }
    : game;

  // No lineup / synergies / relics → nothing to expand into. Render as a
  // static (non-clickable) row and skip the caret + detail panel.
  const hasContent =
    lineup.length > 0 || synergies.length > 0 || compactRelics.length > 0;
  const isOpen = expanded && hasContent;

  const rankLabel =
    displayGame.rank ||
    (snap?.mmr_level != null && snap.mmr_level > 0
      ? mmrLevelToRank(snap.mmr_level)
      : null);

  const roundResult =
    snap && prevSnap && snapRound !== null
      ? (() => {
          const eliminated = snap.hp === 0 && (prevSnap.hp ?? 0) > 0;
          const won = (snap.win_round ?? 0) > (prevSnap.win_round ?? 0);
          const lost = (snap.lose_round ?? 0) > (prevSnap.lose_round ?? 0);
          if (eliminated) return "out" as const;
          if (won) return "w" as const;
          if (lost) return "l" as const;
          return null;
        })()
      : null;

  const inner = (
    <>
      <div
        className="mp-placement"
        style={{ color: pColor, borderColor: pColor }}
      >
        {game.placement ?? "—"}
      </div>
        <div className="mp-info">
          <div className="mp-name-row">
            {profileUrl ? (
              <Link
                href={playerProfilePath(String(game.user_id), profile.customUrl)}
                className="mp-name"
                onClick={(e) => e.stopPropagation()}
              >
                {displayName}
              </Link>
            ) : (
              <span className="mp-name mp-name-unknown">{displayName}</span>
            )}
          </div>
          {rankLabel && <span className="mp-rank">{rankLabel}</span>}
        </div>
        <div className="mp-col-stats">
          {displayGame.level && (
            <span className="mp-stat">
              <span className="mp-stat-label">LVL</span>
              {displayGame.level}
            </span>
          )}
          {displayGame.wins != null && displayGame.losses != null && (
            <span className="mp-stat">
              <span className="wl-w">{displayGame.wins}</span>
              <span className="mp-wl-sep">{"–"}</span>
              <span className="wl-l">{displayGame.losses}</span>
            </span>
          )}
          {roundResult && (
            <span className={`mp-round-result mp-round-${roundResult}`}>
              {roundResult === "out"
                ? "Out"
                : roundResult === "w"
                  ? "Won"
                  : "Lost"}
            </span>
          )}
        </div>
        <div className="mp-col-lineup">
          {lineup.length > 0 && (
            <div className="mp-lineup">
              {lineup.map((u, i) => (
                <TooltipWrap
                  key={i}
                  type="unit"
                  name={u.name}
                  stars={u.stars}
                  data={tooltipData}
                >
                  <div className="unit-icon-wrap mp-unit">
                    <img
                      className="unit-icon"
                      src={iconUrl("units", unitStem(u.name))}
                      alt={u.name}
                      loading="lazy"
                      style={{
                        borderColor: costBorderColor(UNIT_COSTS[u.name] || 1),
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    {u.stars > 1 && (
                      <span className={`unit-stars s${u.stars}`}>
                        {"★".repeat(u.stars)}
                      </span>
                    )}
                  </div>
                </TooltipWrap>
              ))}
            </div>
          )}
        </div>
        {hasContent && (
          <div className="mp-caret" aria-hidden="true">
            {isOpen ? "−" : "+"}
          </div>
        )}
    </>
  );

  return (
    <div
      className={
        "match-player-row" +
        (highlighted ? " highlighted" : "") +
        (isOpen ? " expanded" : "") +
        (hasContent ? "" : " static")
      }
    >
      {hasContent ? (
        <button
          type="button"
          className="mp-toggle"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={
            isOpen ? "Collapse player details" : "Expand player details"
          }
        >
          {inner}
        </button>
      ) : (
        <div className="mp-toggle mp-toggle-static">{inner}</div>
      )}
      {isOpen && (
        <PlayerDetail
          lineup={lineup}
          synergies={synergies}
          relicsToShow={compactRelics}
          hasRelicTimeline={hasRelicTimeline}
          tooltipData={tooltipData}
          hp={snap?.hp ?? null}
          gold={snap?.total_money ?? null}
        />
      )}
    </div>
  );
}

export { type GamePageProps, type MatchTimeline, type RelicTimelineEntry };

export default function GamePage({
  game,
  steamProfile,
  matchGames,
  matchProfiles,
  relicTimelines,
  timeline,
  highlightUserId,
  highlightName,
  canonicalUrl,
  ogImageUrl,
}: GamePageProps) {
  const router = useRouter();
  const lineup = parseLineup(game.lineup, UNIT_COSTS);

  // Round scrubber state. Default to the last round (= end state), which
  // makes the page render identically to the no-timeline path on load.
  const hasTimeline = !!(timeline && timeline.rounds && timeline.rounds.length > 0);
  const [selectedRoundIdx, setSelectedRoundIdx] = useState<number>(
    hasTimeline ? timeline!.rounds.length - 1 : 0
  );
  const currentSnap: TimelineRound | null = hasTimeline
    ? timeline!.rounds[selectedRoundIdx] ?? null
    : null;
  const selectedRound = currentSnap?.round ?? null;
  const isLastRound = hasTimeline
    ? selectedRoundIdx === timeline!.rounds.length - 1
    : true;

  const displayName = steamProfile.name || game.user_id;
  const playerPath = playerProfilePath(String(game.user_id), steamProfile.customUrl);
  const playerCanonicalUrl =
    absoluteUrl(playerPath, originFromUrl(canonicalUrl)) ?? playerPath;
  const pageTitle = game.placement
    ? `#${game.placement} ${displayName} — DAC Match | Track Auto Chess`
    : `${displayName} — DAC Match | Track Auto Chess`;
  const description = game.placement
    ? `${displayName} finished #${game.placement} in a Dota Auto Chess match${game.rank ? ` at ${game.rank}` : ""}.`
    : `Dota Auto Chess match details for ${displayName}.`;

  const tooltipData: TooltipData = {
    unitCosts: UNIT_COSTS,
    unitsFull: UNITS_FULL,
    synergiesData: SYNERGIES_DATA,
    relicsData: RELICS_DATA,
    iconUrl,
  };

  // Highlight the viewed user_id (or a fallback by OCR'd player name).
  const effectiveHighlight = highlightUserId || String(game.user_id);
  const effectiveHighlightName = normalizeName(highlightName);
  const isHighlightedRow = (g: Game): boolean => {
    if (g.user_id && String(g.user_id) === effectiveHighlight) return true;
    if (effectiveHighlightName && normalizeName(g.notes) === effectiveHighlightName) {
      return true;
    }
    return false;
  };

  // Expand state. The viewed player's row starts open. If there's no
  // matchGames data, fall back to expanding the single game we have.
  const initiallyExpanded = (matchGames.length > 0 ? matchGames : [game])
    .filter(isHighlightedRow)
    .map((g) => g.id);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(
    () => new Set(initiallyExpanded.length ? initiallyExpanded : [game.id])
  );
  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // For a single-row match (no companions in `games` for the same match_id),
  // synthesize a one-element list so the same table renders for both cases.
  const playerRows: Game[] =
    matchGames.length > 0
      ? [...matchGames].sort(
          (a, b) => (parseInt(a.placement) || 99) - (parseInt(b.placement) || 99)
        )
      : [game];

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: pageTitle,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      about: { "@type": "Thing", name: "Dota Auto Chess match" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: displayName,
          item: playerCanonicalUrl,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Match",
          ...(canonicalUrl ? { item: canonicalUrl } : {}),
        },
      ],
    },
  ];

  useEffect(() => {
    trackEvent("Game Detail Viewed", {
      route: analyticsRoute(router.pathname),
      placement: game.placement ?? "unknown",
      has_screenshot: Boolean(game.screenshot),
      has_lineup: lineup.length > 0,
      player_bucket: bucketCount(playerRows.length || 1),
    });
  }, [
    game.id,
    game.placement,
    game.screenshot,
    lineup.length,
    playerRows.length,
    router.pathname,
  ]);

  const matchDate = game.played_at
    ? new Date(game.played_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const matchTime = game.played_at
    ? new Date(game.played_at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <>
      <SeoHead
        title={pageTitle}
        description={description}
        path={`/games/${game.id}`}
        localized={false}
        canonicalUrl={canonicalUrl}
        imageUrl={ogImageUrl}
        imageAlt={`${displayName} placed #${game.placement} in a Dota Auto Chess match`}
        structuredData={structuredData}
      />

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .container {
          max-width: 960px;
          margin: 0 auto;
          padding: 32px 24px 80px;
        }

        /* ── Match meta strip ──────────────────────────── */
        .match-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          letter-spacing: 0.4px;
          color: var(--text-muted);
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .match-meta strong {
          color: var(--text-secondary);
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          font-size: 11px;
        }
        .match-meta .sep {
          opacity: 0.5;
        }

        /* ── Screenshot banner ─────────────────────────── */
        .screenshot-banner {
          border: 1px solid var(--border);
          border-radius: var(--r-8);
          overflow: hidden;
          background: var(--bg-deep);
          margin-bottom: 24px;
        }
        .screenshot-banner img {
          display: block;
          width: 100%;
          height: auto;
        }

        /* ── Round scrubber ────────────────────────────── */
        .round-scrubber {
          border: 1px solid var(--border);
          border-radius: var(--r-8);
          background: var(--bg-surface);
          padding: 14px 20px 12px;
          margin-bottom: 16px;
        }
        .rs-header {
          display: flex;
          align-items: baseline;
          gap: 6px;
          font-size: 12px;
          color: var(--text-muted);
        }
        .rs-label {
          letter-spacing: 1.6px;
          text-transform: uppercase;
          font-weight: 600;
          color: var(--text-secondary);
          font-size: 10px;
        }
        .rs-value {
          font-family: var(--font-display);
          color: var(--text-primary);
          font-size: 18px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          margin-left: 4px;
        }
        .rs-meta {
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
        .rs-jump-end {
          margin-left: auto;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          font-size: 11px;
          letter-spacing: 0.6px;
          padding: 4px 10px;
          border-radius: var(--r-3);
          cursor: pointer;
          transition: color var(--t-base) var(--t-easing);
        }
        .rs-jump-end:hover {
          color: var(--text-primary);
        }
        .rs-range {
          width: 100%;
          margin: 10px 0 4px;
          accent-color: var(--accent);
        }
        .rs-ends {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.4px;
        }

        /* ── Players table ─────────────────────────────── */
        .match-section {
          border: 1px solid var(--border);
          border-radius: var(--r-8);
          background: var(--bg-surface);
          overflow: hidden;
        }
        .match-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(0, 0, 0, 0.12);
        }
        .match-section-header h3 {
          margin: 0;
          font-size: 12px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-secondary);
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .section-bar {
          display: inline-block;
          width: 3px;
          height: 12px;
          background: var(--accent);
          border-radius: 2px;
        }
        .match-section-count {
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 1px;
          text-transform: uppercase;
          font-variant-numeric: tabular-nums;
        }

        @media (max-width: 720px) {
          .container {
            padding: 20px 16px 60px;
          }
        }
      `}</style>

      {/*
        MatchPlayerRow and PlayerDetail live in sibling functions, so
        styled-jsx's per-component scoping wouldn't reach their JSX. Use a
        global block for the .match-player-row / .mp-* / .pd-* rules.
      */}
      <style jsx global>{`
        .match-player-row {
          border-bottom: 1px solid var(--border-subtle);
          transition: background var(--t-base) var(--t-easing);
          position: relative;
        }
        .match-player-row:last-child {
          border-bottom: none;
        }
        .match-player-row.highlighted::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: var(--accent);
        }
        .match-player-row.highlighted .mp-toggle {
          background: rgba(224, 64, 42, 0.06);
        }
        .mp-toggle {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 10px 24px;
          background: transparent;
          border: none;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
          transition: background var(--t-base) var(--t-easing);
        }
        .mp-toggle:hover {
          background: var(--bg-hover);
        }
        .match-player-row.expanded > .mp-toggle {
          background: var(--bg-hover);
        }
        .mp-toggle.mp-toggle-static {
          cursor: default;
        }
        .mp-toggle.mp-toggle-static:hover {
          background: transparent;
        }
        .mp-placement {
          font-size: 18px;
          font-weight: 700;
          font-family: var(--font-display);
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          border-radius: var(--r-3);
          flex-shrink: 0;
        }
        .mp-info {
          width: 150px;
          flex-shrink: 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .mp-name-row {
          display: flex;
          align-items: center;
          min-width: 0;
        }
        .mp-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          text-decoration: none;
          transition: color var(--t-base) var(--t-easing);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .mp-name:hover {
          color: #fff;
        }
        .mp-name-unknown {
          color: var(--text-muted);
          font-style: italic;
        }
        .mp-rank {
          align-self: flex-start;
          font-size: 10px;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-2);
          padding: 1px 6px;
          letter-spacing: 0.4px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .mp-col-stats {
          display: flex;
          gap: 10px;
          align-items: center;
          width: 112px;
          flex-shrink: 0;
        }
        .mp-stat {
          display: inline-flex;
          align-items: baseline;
          gap: 3px;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .mp-stat-label {
          font-size: 9px;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .mp-wl-sep {
          color: var(--text-muted);
          margin: 0 2px;
          opacity: 0.5;
        }
        .mp-hp {
          font-size: 11px;
          color: var(--text-secondary);
          letter-spacing: 0.4px;
          font-variant-numeric: tabular-nums;
        }
        .mp-gold {
          font-size: 11px;
          color: #c9a84c;
          letter-spacing: 0.4px;
          font-variant-numeric: tabular-nums;
        }
        .mp-round-result {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.6px;
        }
        .mp-round-w {
          color: var(--green-bright, #4ebf72);
        }
        .mp-round-l {
          color: var(--red-bright, #e35d5b);
        }
        .mp-round-out {
          color: var(--red-bright, #e35d5b);
          opacity: 0.65;
          font-size: 11px;
        }
        .wl-w {
          color: var(--green-bright);
        }
        .wl-l {
          color: var(--red-bright);
        }
        .mp-col-lineup {
          flex: 1;
          min-width: 0;
        }
        /* Single horizontal line of units — no wrapping. Synergies and relics
           now live in the expand panel so the lineup gets the full width and
           the icons can be larger. overflow:hidden guards against the rare
           over-full board pushing the caret off-row. */
        .mp-lineup {
          display: flex;
          gap: 4px;
          flex-wrap: nowrap;
          align-items: center;
          overflow: hidden;
        }
        /* Resize wrap + icon together; the global .unit-icon-wrap is 28x28, so
           growing only the icon would overflow the wrap and overlap neighbours. */
        .mp-unit.unit-icon-wrap {
          width: 36px;
          height: 36px;
        }
        .mp-unit .unit-icon {
          width: 36px;
          height: 36px;
        }
        .mp-caret {
          flex-shrink: 0;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          font-size: 16px;
          font-weight: 600;
          font-family: var(--font-display);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-2);
          background: var(--bg-elevated);
          transition: color var(--t-base) var(--t-easing);
        }
        .mp-toggle:hover .mp-caret {
          color: var(--text-secondary);
        }

        /* ── Expanded player detail ────────────────────── */
        .player-detail {
          padding: 18px 24px 24px 76px;
          background: rgba(0, 0, 0, 0.18);
          border-top: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .pd-live-stats {
          display: flex;
          gap: 16px;
          align-items: center;
        }
        .pd-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .pd-label {
          font-size: 10px;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: var(--text-secondary);
          font-weight: 600;
        }
        .pd-label-hint {
          color: var(--text-muted);
          font-weight: 500;
          letter-spacing: 0.8px;
          text-transform: none;
        }
        .pd-lineup {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        /* Resize both the wrap and the icon together — the global
           .unit-icon-wrap is fixed at 28x28, so growing only the icon
           would overflow the wrap and overlap neighbouring units. */
        .pd-unit.unit-icon-wrap {
          width: 40px;
          height: 40px;
        }
        .pd-unit .unit-icon {
          width: 40px;
          height: 40px;
        }
        .pd-synergies {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .pd-syn-badge .syn-icon {
          width: 16px;
          height: 16px;
        }
        .pd-relics {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: flex-start;
        }
        .pd-relic {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .pd-relic-icon {
          width: 36px !important;
          height: 36px !important;
        }
        .pd-relic-round {
          font-size: 10px;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-2);
          padding: 1px 6px;
          letter-spacing: 0.4px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }

        @media (max-width: 720px) {
          .mp-toggle {
            flex-wrap: wrap;
            padding: 10px 16px;
            gap: 8px;
          }
          .mp-info {
            width: auto;
            flex: 1;
          }
          .mp-col-stats {
            width: auto;
          }
          .mp-col-lineup {
            flex-basis: 100%;
            order: 10;
          }
          /* Phones are too narrow for a full board on one line — let it wrap
             here so no units get clipped. */
          .mp-lineup {
            flex-wrap: wrap;
            overflow: visible;
          }
          .mp-caret {
            margin-left: auto;
          }
          .player-detail {
            padding: 16px 20px 20px 20px;
          }
        }
      `}</style>

      <div className="page">
        <div className="container">
          {/* Slim match-meta strip */}
          <div className="match-meta">
            <strong>Match</strong>
            {matchDate && (
              <>
                <span className="sep">{"·"}</span>
                <span>
                  {matchDate}
                  {matchTime ? `, ${matchTime}` : ""}
                </span>
              </>
            )}
            <span className="sep">{"·"}</span>
            <span>
              {playerRows.length} {playerRows.length === 1 ? "player" : "players"}
            </span>
          </div>

          {/* Screenshot banner (only on the viewed player's row's game) */}
          {game.screenshot && (
            <div className="screenshot-banner">
              <img src={game.screenshot} alt="Game screenshot" loading="lazy" />
            </div>
          )}

          {/* Round scrubber — only rendered when nettable timeline exists. */}
          {hasTimeline && (
            <div className="round-scrubber">
              <div className="rs-header">
                <span className="rs-label">Round</span>
                <strong className="rs-value">{selectedRound}</strong>
                <span className="rs-meta">
                  {" "}
                  / {timeline!.last_round}
                  {isLastRound ? " (final)" : ""}
                </span>
                {!isLastRound && (
                  <button
                    type="button"
                    className="rs-jump-end"
                    onClick={() =>
                      setSelectedRoundIdx(timeline!.rounds.length - 1)
                    }
                  >
                    Jump to end
                  </button>
                )}
              </div>
              <input
                className="rs-range"
                type="range"
                min={0}
                max={timeline!.rounds.length - 1}
                value={selectedRoundIdx}
                onChange={(e) => setSelectedRoundIdx(Number(e.target.value))}
                aria-label="Scrub through match rounds"
              />
              <div className="rs-ends">
                <span>R{timeline!.first_round}</span>
                <span>R{timeline!.last_round}</span>
              </div>
            </div>
          )}

          {/* Players table — viewed row pre-expanded */}
          <div className="match-section">
            <div className="match-section-header">
              <h3>
                <span className="section-bar" />
                Players
              </h3>
              <span className="match-section-count">
                {playerRows.length}{" "}
                {playerRows.length === 1 ? "player" : "players"}
              </span>
            </div>
            {playerRows.map((g) => {
              const prevRound: TimelineRound | null = hasTimeline && selectedRoundIdx > 0
                ? timeline!.rounds[selectedRoundIdx - 1] ?? null
                : null;
              return (
                <MatchPlayerRow
                  key={g.id}
                  game={g}
                  profile={
                    matchProfiles[String(g.user_id)] ||
                    (g.id === game.id
                      ? steamProfile
                      : { name: null, customUrl: null })
                  }
                  highlighted={isHighlightedRow(g)}
                  expanded={expandedIds.has(g.id)}
                  onToggle={() => toggleExpand(g.id)}
                  relicTimeline={relicTimelines[String(g.user_id)]}
                  snap={
                    currentSnap?.players?.[String(g.user_id)] ?? null
                  }
                  prevSnap={prevRound?.players?.[String(g.user_id)] ?? null}
                  snapRound={selectedRound}
                  isLastRound={isLastRound}
                  tooltipData={tooltipData}
                />
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/** Convert the raw match_players.relic_history jsonb into a sorted timeline.
 *  Input shape (dict): {"1": {relic: "item_x", round: 11}, "2": {...}, …}
 *  Or array: [{relic, round}, …]. Maps internal item_* ids → display names. */
export function parseRelicHistory(
  raw: unknown,
  relicsData: Record<string, RelicInfo>
): RelicTimelineEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const entries: { relic?: unknown; round?: unknown }[] = Array.isArray(raw)
    ? (raw as { relic?: unknown; round?: unknown }[])
    : Object.values(raw as Record<string, { relic?: unknown; round?: unknown }>);
  const out: RelicTimelineEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const rawId = typeof e.relic === "string" ? e.relic : "";
    if (!rawId) continue;
    const round = typeof e.round === "number" ? e.round : parseInt(String(e.round)) || 0;
    const display = relicsData[rawId]?.name || rawId;
    out.push({ round, name: display });
  }
  out.sort((a, b) => a.round - b.round);
  return out;
}

/** Map a raw match_players row into a Game with legacy aliases populated. */
function mpRowToGame(
  mp: Record<string, unknown>,
  playedAtFallback?: string
): Game {
  const steamId = String(mp.steam_id ?? "");
  const played = (mp.played_at as string) || playedAtFallback || "";
  const mmrLevel = (mp.mmr_level as number) ?? null;
  const heroLevel = (mp.hero_level as number) ?? null;
  const winRound = (mp.win_round as number) ?? null;
  const loseRound = (mp.lose_round as number) ?? null;
  return {
    id: mp.id as number,
    match_id: (mp.match_id as string) ?? "",
    user_id: steamId,
    placement: mp.placement != null ? String(mp.placement) : "",
    lineup: (mp.chess_lineup as string) ?? null,
    synergies: (mp.synergies as string) ?? null,
    talents: (mp.talents as string) ?? null,
    relic: (mp.relic as string) ?? null,
    level: heroLevel != null ? String(heroLevel) : null,
    rank: mmrLevel ? mmrLevelToRank(mmrLevel) : null,
    rank_change: null,
    wins: winRound,
    losses: loseRound,
    wl: null,
    screenshot: (mp.screenshot as string) ?? null,
    notes: (mp.notes as string) ?? null,
    replay: (mp.replay as string) ?? null,
    played_at: played,
    created_at: (mp.created_at as string) ?? "",
  };
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const rawId = context.params?.id;
  if (typeof rawId !== "string") return { notFound: true };
  const id = rawId;
  const highlightUserId = (context.query.player as string) || null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const baseUrl = getRequestSiteUrl(context.req.headers);

  if (!url || !key) return { notFound: true };

  const supabase = createClient(url, key);
  const { data } = await supabase
    .from("match_players")
    .select("*, steam_id::text")
    .eq("id", id)
    .single();

  if (!data) return { notFound: true };

  // Kick off the owner Steam profile fetch and the match players query in
  // parallel — both only depend on the single row already in hand.
  const ownerProfilePromise: Promise<SteamProfile> = data.steam_id
    ? fetchSteamProfile(String(data.steam_id), supabase)
    : Promise.resolve({ name: null, customUrl: null });

  const matchPlayersPromise: Promise<Record<string, unknown>[]> = data.match_id
    ? Promise.resolve(
        supabase
          .from("match_players")
          .select("*, steam_id::text")
          .eq("match_id", data.match_id)
          .order("placement", { ascending: true })
      ).then(({ data: matchData }) => (matchData as Record<string, unknown>[] | null) || [])
    : Promise.resolve([]);

  // Per-match round-by-round snapshots. Only nettable-captured matches
  // have a row here; CV-captured matches return null and the scrubber
  // is hidden client-side.
  const timelinePromise: Promise<MatchTimeline | null> = data.match_id
    ? Promise.resolve(
        supabase
          .from("match_timelines")
          .select("timeline")
          .eq("match_id", data.match_id)
          .maybeSingle()
      ).then(
        ({ data: row }) =>
          ((row as { timeline: MatchTimeline } | null)?.timeline) ?? null
      )
    : Promise.resolve(null);

  // played_at may be null on match_players; fall back to matches.played_at.
  const matchPlayedAtPromise: Promise<string> = data.match_id
    ? Promise.resolve(
        supabase
          .from("matches")
          .select("played_at")
          .eq("match_id", data.match_id)
          .maybeSingle()
      ).then(
        ({ data: row }) =>
          ((row as { played_at: string } | null)?.played_at) ?? ""
      )
    : Promise.resolve("");

  const [steamProfile, allPlayerRows, timeline, matchPlayedAt] = await Promise.all([
    ownerProfilePromise,
    matchPlayersPromise,
    timelinePromise,
    matchPlayedAtPromise,
  ]);

  // Build the played_at fallback: prefer the row's own value, then the
  // matches table value.
  const playedAtFallback = (data.played_at as string) || matchPlayedAt;

  const matchGames = allPlayerRows.map((row) => mpRowToGame(row, matchPlayedAt));
  const game = mpRowToGame(data, matchPlayedAt);

  // Build relic timelines directly from the match_players data we already have.
  const relicsMap = (relicsData as any).relics as Record<string, RelicInfo>;
  const relicTimelines: Record<string, RelicTimelineEntry[]> = {};
  for (const row of allPlayerRows) {
    const sid = String(row.steam_id);
    const tl = parseRelicHistory(row.relic_history, relicsMap);
    if (tl.length > 0) relicTimelines[sid] = tl;
  }

  const matchProfiles: Record<string, SteamProfile> = {};
  if (matchGames.length > 0) {
    const userIds = [
      ...new Set(matchGames.map((g) => g.user_id).filter(Boolean).map(String)),
    ];

    await Promise.all(
      userIds.map(async (uid) => {
        matchProfiles[uid] = await fetchSteamProfile(uid, supabase);
      })
    );
  }

  // Look up the highlighted user's Steam name. Game Over uploads often
  // can't link rows to a Steam account, so we also need to match by the
  // OCR'd player name stored in `notes`.
  let highlightName: string | null = null;
  if (highlightUserId) {
    if (matchProfiles[highlightUserId]?.name) {
      highlightName = matchProfiles[highlightUserId].name;
    } else {
      try {
        const profile = await fetchSteamProfile(highlightUserId, supabase, {
          persist: false,
        });
        highlightName = profile.name || null;
      } catch {
        highlightName = null;
      }
    }
  }

  return {
    props: {
      game,
      steamProfile,
      matchGames,
      matchProfiles,
      relicTimelines,
      timeline,
      highlightUserId,
      highlightName,
      canonicalUrl: absoluteUrl(`/games/${id}`, baseUrl),
      ogImageUrl: absoluteUrl(`/api/og/game/${id}`, baseUrl),
    },
  };
};
