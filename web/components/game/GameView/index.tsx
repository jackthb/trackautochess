"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UNIT_COSTS, computeSynergies } from "@/lib/units";
import {
  itemsFullData,
  relicsData,
  synergiesData,
  unitsFullData,
} from "@/generated/content-data";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";
import type { ChessBoardPiece, ItemFullInfo } from "@dac/shared/types";
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
import { ChessBoard } from "@dac/shared/ChessBoard";
import {
  playerProfilePath,
  steamProfileUrl,
  type SteamProfile,
} from "@/lib/steam";
import { absoluteUrl } from "@/lib/site";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import { resolveIconUrl } from "@/lib/icons";
import styles from "./GameView.module.css";

const UNITS_FULL = unitsFullData as Record<string, UnitFullInfo>;
const SYNERGIES_DATA = synergiesData as Record<string, SynergyInfo>;
const RELICS_DATA = (relicsData as any).relics as Record<string, RelicInfo>;
const ITEMS_FULL = itemsFullData as Record<string, ItemFullInfo>;

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
  board?: ChessBoardPiece[];
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
  /** Analytics route pattern, e.g. "/games/[id]" or "/matches/[id]". */
  route: string;
}

function normalizeName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
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
  board,
  lineupStr,
}: {
  lineup: { name: string; stars: number }[];
  lineupStr: string | null;
  synergies: { name: string; count: number }[];
  relicsToShow: RelicTimelineEntry[];
  hasRelicTimeline: boolean;
  tooltipData: TooltipData;
  hp: number | null;
  gold: number | null;
  board?: ChessBoardPiece[];
}) {
  return (
    <div className={styles.playerDetail}>
      {(hp != null || gold != null) && (
        <div className={styles.pdLiveStats}>
          {hp != null && <span className={styles.mpHp}>HP {hp}</span>}
          {gold != null && <span className={styles.mpGold}>Gold {gold}</span>}
        </div>
      )}
      {(board?.length || lineup.length > 0) && (
        <div className={styles.pdSection}>
          <div className={styles.pdLabel}>Board</div>
          <div className={styles.pdBoard}>
            <ChessBoard
              board={board}
              lineup={lineupStr}
              unitCosts={UNIT_COSTS}
              iconUrl={iconUrl}
              itemsFull={ITEMS_FULL}
            />
          </div>
        </div>
      )}
      {lineup.length > 0 && (
        <div className={styles.pdSection}>
          <div className={styles.pdLabel}>Lineup</div>
          <div className={styles.pdLineup}>
            {lineup.map((u, i) => (
              <TooltipWrap
                key={i}
                type="unit"
                name={u.name}
                stars={u.stars}
                data={tooltipData}
              >
                <div className={`unit-icon-wrap ${styles.pdUnit}`}>
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
        <div className={styles.pdSection}>
          <div className={styles.pdLabel}>Synergies</div>
          <div className={styles.pdSynergies}>
            {synergies.map((s, i) => (
              <TooltipWrap
                key={i}
                type="synergy"
                name={s.name}
                count={s.count}
                data={tooltipData}
              >
                <div className={`syn-badge ${styles.pdSynBadge}`}>
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
        <div className={styles.pdSection}>
          <div className={styles.pdLabel}>
            Relics
            {hasRelicTimeline && (
              <span className={styles.pdLabelHint}>{" "}· acquired round</span>
            )}
          </div>
          <div className={styles.pdRelics}>
            {relicsToShow.map((r, i) => (
              <div key={i} className={styles.pdRelic}>
                <TooltipWrap
                  type="relic"
                  name={r.name}
                  relicIndex={i}
                  data={tooltipData}
                >
                  <img
                    className={`relic-icon ${styles.pdRelicIcon}`}
                    src={iconUrl("relics", relicStem(r.name))}
                    alt={r.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </TooltipWrap>
                {r.round > 0 && (
                  <span className={styles.pdRelicRound}>R{r.round}</span>
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
  displayPosition,
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
  displayPosition: number | null;
  tooltipData: TooltipData;
}) {
  const p = displayPosition ?? (parseInt(game.placement) || 0);
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
        className={styles.mpPlacement}
        style={{ color: pColor, borderColor: pColor }}
      >
        {displayPosition ?? game.placement ?? "—"}
      </div>
        <div className={styles.mpInfo}>
          <div className={styles.mpNameRow}>
            {profileUrl ? (
              <Link
                href={playerProfilePath(String(game.user_id), profile.customUrl)}
                className={styles.mpName}
                onClick={(e) => e.stopPropagation()}
              >
                {displayName}
              </Link>
            ) : (
              <span className={`${styles.mpName} ${styles.mpNameUnknown}`}>{displayName}</span>
            )}
          </div>
          {rankLabel && <span className={styles.mpRank}>{rankLabel}</span>}
        </div>
        <div className={styles.mpColStats}>
          {displayGame.level && (
            <span className={styles.mpStat}>
              <span className={styles.mpStatLabel}>LVL</span>
              {displayGame.level}
            </span>
          )}
          {displayGame.wins != null && displayGame.losses != null && (
            <span className={styles.mpStat}>
              <span className={styles.wlW}>{displayGame.wins}</span>
              <span className={styles.mpWlSep}>{"–"}</span>
              <span className={styles.wlL}>{displayGame.losses}</span>
            </span>
          )}
          {roundResult && (
            <span
              className={
                styles.mpRoundResult +
                " " +
                (roundResult === "out"
                  ? styles.mpRoundOut
                  : roundResult === "w"
                    ? styles.mpRoundW
                    : styles.mpRoundL)
              }
            >
              {roundResult === "out"
                ? "Out"
                : roundResult === "w"
                  ? "Won"
                  : "Lost"}
            </span>
          )}
        </div>
        <div className={styles.mpColLineup}>
          {lineup.length > 0 && (
            <div className={styles.mpLineup}>
              {lineup.map((u, i) => (
                <TooltipWrap
                  key={i}
                  type="unit"
                  name={u.name}
                  stars={u.stars}
                  data={tooltipData}
                >
                  <div className={`unit-icon-wrap ${styles.mpUnit}`}>
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
          <div className={styles.mpCaret} aria-hidden="true">
            {isOpen ? "−" : "+"}
          </div>
        )}
    </>
  );

  return (
    <div
      className={
        styles.matchPlayerRow +
        (highlighted ? " " + styles.highlighted : "") +
        (isOpen ? " " + styles.expanded : "") +
        (hasContent ? "" : " static")
      }
    >
      {hasContent ? (
        <button
          type="button"
          className={styles.mpToggle}
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={
            isOpen ? "Collapse player details" : "Expand player details"
          }
        >
          {inner}
        </button>
      ) : (
        <div className={`${styles.mpToggle} ${styles.mpToggleStatic}`}>{inner}</div>
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
          board={snap?.board}
          lineupStr={lineupStr}
        />
      )}
    </div>
  );
}

export { type GamePageProps, type MatchTimeline, type RelicTimelineEntry };

/** SEO derivation extracted from the old GamePage body. The App Router server
 *  pages call this to feed Next `Metadata` (generateMetadata) and to render the
 *  JSON-LD <script>. Mirrors the previous pageTitle/description/structuredData
 *  computations verbatim. */
export default function GameView({
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
  route,
}: GamePageProps) {
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
  const basePlayerRows = matchGames.length > 0 ? matchGames : [game];
  const playerRows: Game[] = [...basePlayerRows].sort((a, b) => {
    const finalPlacementDelta =
      (parseInt(a.placement) || 99) - (parseInt(b.placement) || 99);
    if (!hasTimeline || isLastRound || !currentSnap?.players) {
      return finalPlacementDelta;
    }

    const aSnap = currentSnap.players[String(a.user_id)];
    const bSnap = currentSnap.players[String(b.user_id)];
    const aHp = aSnap?.hp;
    const bHp = bSnap?.hp;
    const aHasHp = typeof aHp === "number";
    const bHasHp = typeof bHp === "number";
    if (aHasHp !== bHasHp) return aHasHp ? -1 : 1;
    if (aHasHp && bHasHp && aHp !== bHp) return bHp - aHp;

    const aProfile = matchProfiles[String(a.user_id)];
    const bProfile = matchProfiles[String(b.user_id)];
    const aName = aProfile?.name || a.notes || String(a.user_id || a.id);
    const bName = bProfile?.name || b.notes || String(b.user_id || b.id);
    const nameDelta = aName.localeCompare(bName, undefined, { sensitivity: "base" });
    return nameDelta || finalPlacementDelta;
  });

  useEffect(() => {
    trackEvent("Game Detail Viewed", {
      route: analyticsRoute(route),
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
    route,
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
      <div className={styles.page}>
        <div className={styles.container}>
          {/* Slim match-meta strip */}
          <div className={styles.matchMeta}>
            <strong>Match</strong>
            {matchDate && (
              <>
                <span className={styles.sep}>{"·"}</span>
                <span>
                  {matchDate}
                  {matchTime ? `, ${matchTime}` : ""}
                </span>
              </>
            )}
            <span className={styles.sep}>{"·"}</span>
            <span>
              {playerRows.length} {playerRows.length === 1 ? "player" : "players"}
            </span>
          </div>

          {/* Screenshot banner (only on the viewed player's row's game) */}
          {game.screenshot && (
            <div className={styles.screenshotBanner}>
              <img src={game.screenshot} alt="Game screenshot" loading="lazy" />
            </div>
          )}

          {/* Round scrubber — only rendered when nettable timeline exists. */}
          {hasTimeline && (
            <div className={styles.roundScrubber}>
              <div className={styles.rsHeader}>
                <span className={styles.rsLabel}>Round</span>
                <strong className={styles.rsValue}>{selectedRound}</strong>
                <span className={styles.rsMeta}>
                  {" "}
                  / {timeline!.last_round}
                  {isLastRound ? " (final)" : ""}
                </span>
                {!isLastRound && (
                  <button
                    type="button"
                    className={styles.rsJumpEnd}
                    onClick={() =>
                      setSelectedRoundIdx(timeline!.rounds.length - 1)
                    }
                  >
                    Jump to end
                  </button>
                )}
              </div>
              <input
                className={styles.rsRange}
                type="range"
                min={0}
                max={timeline!.rounds.length - 1}
                value={selectedRoundIdx}
                onChange={(e) => setSelectedRoundIdx(Number(e.target.value))}
                aria-label="Scrub through match rounds"
              />
              <div className={styles.rsEnds}>
                <span>R{timeline!.first_round}</span>
                <span>R{timeline!.last_round}</span>
              </div>
            </div>
          )}

          {/* Players table — viewed row pre-expanded */}
          <div className={styles.matchSection}>
            <div className={styles.matchSectionHeader}>
              <h3>
                <span className={styles.sectionBar} />
                Players
              </h3>
              <span className={styles.matchSectionCount}>
                {playerRows.length}{" "}
                {playerRows.length === 1 ? "player" : "players"}
              </span>
            </div>
            {playerRows.map((g, rowIdx) => {
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
                  displayPosition={
                    hasTimeline && !isLastRound ? rowIdx + 1 : parseInt(g.placement) || null
                  }
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
