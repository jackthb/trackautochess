"use client";

import { useEffect, useRef, useState } from "react";
import { UNIT_COSTS, computeSynergies } from "@/lib/units";
import type { SynergyCountPiece } from "@dac/shared/game-structure";
import {
  itemsFullData,
  synergiesData,
  unitsFullData,
} from "@/generated/content-data";
import type { Game, UnitFullInfo, SynergyInfo } from "@dac/shared/types";
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
  mmrLevelToRank,
  type RelicTimelineEntry,
} from "@dac/shared/game-utils";
import { getRelicsMap } from "@/lib/relics";
import { TooltipWrap, type TooltipData } from "@dac/shared/Tooltip";
import { ChessBoard } from "@dac/shared/ChessBoard";
import { type SteamProfile } from "@/lib/steam";
import { absoluteUrl } from "@/lib/site";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import { resolveIconUrl } from "@/lib/icons";
import styles from "./GameView.module.css";

const UNITS_FULL = unitsFullData as Record<string, UnitFullInfo>;
const SYNERGIES_DATA = synergiesData as Record<string, SynergyInfo>;
const RELICS_DATA = getRelicsMap();
const ITEMS_FULL = itemsFullData as Record<string, ItemFullInfo>;

const iconUrl = resolveIconUrl;

// Synergy display-name → ascending tier thresholds (e.g. Beast → [2, 4, 6]).
const SYNERGY_TIERS_BY_NAME: Record<string, number[]> = (() => {
  const map: Record<string, number[]> = {};
  for (const info of Object.values(SYNERGIES_DATA)) {
    if (info?.name && Array.isArray(info.tiers) && info.tiers.length > 0) {
      map[info.name] = info.tiers;
    }
  }
  return map;
})();

/** The active synergy tier for a fielded count — the highest tier threshold
 *  the count satisfies. Three Beasts (tiers 2/4/6) shows "2", not "3": the
 *  badge reflects the synergy bonus in play, not the raw unit count. */
function activeSynergyTier(name: string, count: number): number {
  const tiers = SYNERGY_TIERS_BY_NAME[name];
  if (!tiers) return count;
  let active = tiers[0];
  for (const t of tiers) {
    if (count >= t) active = t;
  }
  return active;
}

const MATCH_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const MATCH_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

interface PandarenDropEntry {
  round: number;
  name: string;
  unit?: string;
  raw?: string;
}

/** Per-player state at a single round, captured by the live nettable
 *  ingest. Shape mirrors what nettable_capture._extract_players_state_from_rows
 *  writes into the local timeline JSON. */
interface TimelinePlayerSnap {
  hp?: number;
  level?: number;
  placement?: number;
  lineup?: string;
  hand?: string;
  lineup_value?: number;
  total_money?: number;
  win_round?: number;
  lose_round?: number;
  mmr_level?: number;
  board?: ChessBoardPiece[];
  pandaren_drops?: PandarenDropEntry[];
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
  return String(value || "")
    .trim()
    .toLowerCase();
}

function formatMatchDateTime(value: string | null | undefined): {
  date: string | null;
  time: string | null;
} {
  if (!value) return { date: null, time: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: null, time: null };
  return {
    date: MATCH_DATE_FORMATTER.format(date),
    time: `${MATCH_TIME_FORMATTER.format(date)} UTC`,
  };
}

/** The "expanded" detail panel for a player row — bigger icons, full relic
 *  timeline. Lineup/synergies/relics are pre-parsed by MatchPlayerRow so
 *  the same snap-aware arrays power both the compact view and this panel. */
function PlayerDetail({
  lineup,
  relicsToShow,
  hasRelicTimeline,
  tooltipData,
  hp,
  gold,
  board,
  lineupStr,
  hand,
  pandarenDrops,
}: {
  lineup: { name: string; stars: number }[];
  lineupStr: string | null;
  hand: { name: string; stars: number }[];
  relicsToShow: RelicTimelineEntry[];
  hasRelicTimeline: boolean;
  pandarenDrops: PandarenDropEntry[];
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
      {(board?.length || lineup.length > 0 || hand.length > 0) && (
        <div className={styles.pdSection}>
          <div className={styles.pdLabel}>BOARD</div>
          <div className={styles.pdBoard}>
            {/* No tooltipData here: hovering a board piece shows only its
                items, not the unit stat card (which collides with the item
                popover). */}
            <ChessBoard
              board={board}
              lineup={lineupStr}
              hand={hand
                .map((u) => `${u.name}${u.stars > 1 ? `(${u.stars})` : ""}`)
                .join("|")}
              unitCosts={UNIT_COSTS}
              iconUrl={iconUrl}
              itemsFull={ITEMS_FULL}
            />
          </div>
        </div>
      )}
      {/* Lineup + synergies intentionally omitted here: the board above
          already shows every fielded unit (with items), and the compact row
          shows the active synergies. Repeating them below was redundant. */}

      {relicsToShow.length > 0 && (
        <div className={styles.pdSection}>
          <div className={styles.pdLabel}>
            Relics
            {hasRelicTimeline && (
              <span className={styles.pdLabelHint}> · acquired round</span>
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

      {pandarenDrops.length > 0 && (
        <div className={styles.pdSection}>
          <div className={styles.pdLabel}>Pandaren drops</div>
          <div className={styles.pdDrops}>
            {pandarenDrops.map((drop, i) => (
              <div key={`${drop.raw || drop.name}-${i}`} className={styles.pdDrop}>
                <TooltipWrap
                  type="unit"
                  name={drop.name}
                  data={tooltipData}
                >
                  <img
                    className={styles.pdDropIcon}
                    src={iconUrl("units", unitStem(drop.name))}
                    alt={drop.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </TooltipWrap>
                <span className={styles.pdDropName}>{drop.name}</span>
                {drop.round > 0 && (
                  <span className={styles.pdRelicRound}>R{drop.round}</span>
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
  snapRound,
  isLastRound,
  displayPosition,
  deathRound,
  tooltipData,
}: {
  game: Game;
  profile: SteamProfile;
  highlighted: boolean;
  expanded: boolean;
  onToggle: () => void;
  relicTimeline: RelicTimelineEntry[] | undefined;
  snap: TimelinePlayerSnap | null;
  snapRound: number | null;
  isLastRound: boolean;
  displayPosition: number | null;
  deathRound: number | null;
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
  // When the scrubber is active, prefer the snapshot's lineup. Falls back
  // to the static games.lineup for rows without a snapshot at this round.
  const lineupStr = snap?.lineup ?? game.lineup;
  const lineup = parseLineup(lineupStr, UNIT_COSTS);
  const hand = parseLineup(snap?.hand ?? "", UNIT_COSTS);

  const isScrubbing = snapRound !== null && !isLastRound;
  // Synergies always derive from the pieces actually shown. The round
  // snapshot board carries per-piece items, so counts-as items (Spider Leg →
  // Aqir) are exact there; lineup-only rows fall back to the stored in-game
  // count for item-linkable synergies. The raw stored string is never shown
  // as-is — it's the game's `buff` capture and routinely disagrees with the
  // final board.
  const boardPieces = snap?.board;
  const synergyPieces: SynergyCountPiece[] = boardPieces?.length
    ? boardPieces.map((piece) => ({
        name: piece.name ?? "",
        items: piece.items?.length ? piece.items : piece.last_items,
      }))
    : lineup;
  const synergies = computeSynergies(
    synergyPieces,
    !isScrubbing && !boardPieces?.length
      ? parseSynergies(game.synergies)
      : undefined,
  );

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
  const pandarenDrops =
    snap?.pandaren_drops?.filter((drop) => {
      if (snapRound === null || !drop.round) return true;
      return drop.round <= snapRound;
    }) ?? [];

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
    lineup.length > 0 ||
    hand.length > 0 ||
    synergies.length > 0 ||
    compactRelics.length > 0 ||
    Boolean(boardPieces?.length) ||
    pandarenDrops.length > 0;
  const isOpen = expanded && hasContent;

  const rankLabel =
    displayGame.rank ||
    (snap?.mmr_level != null && snap.mmr_level > 0
      ? mmrLevelToRank(snap.mmr_level)
      : null);

  const visibleDeathRound =
    deathRound != null &&
    (isLastRound || snapRound == null || snapRound >= deathRound)
      ? deathRound
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
          <span
            className={
              profile.name || ocrName
                ? styles.mpName
                : `${styles.mpName} ${styles.mpNameUnknown}`
            }
          >
            {displayName}
          </span>
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
        {synergies.length > 0 && (
          <div className={styles.mpSynergies}>
            {synergies.map((s, i) => (
              <TooltipWrap
                key={i}
                type="synergy"
                name={s.name}
                count={s.count}
                data={tooltipData}
              >
                <div className={`syn-badge ${styles.mpSynBadge}`}>
                  <img
                    className="syn-icon"
                    src={iconUrl("synergies", synIconName(s.name))}
                    alt={s.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <span className="syn-count">
                    {activeSynergyTier(s.name, s.count)}
                  </span>
                </div>
              </TooltipWrap>
            ))}
          </div>
        )}
      </div>
      {/* Per-round win/loss/draw label removed: the game's win/lose_round
          capture is unreliable and routinely disagreed with reality. Death
          (derived from the HP timeline) is accurate, so it stays. */}
      {visibleDeathRound != null && (
        <span className={`${styles.mpRoundResult} ${styles.mpDeathRound}`}>
          Died R{visibleDeathRound}
        </span>
      )}
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
        <div className={`${styles.mpToggle} ${styles.mpToggleStatic}`}>
          {inner}
        </div>
      )}
      {isOpen && (
        <PlayerDetail
          lineup={lineup}
          relicsToShow={compactRelics}
          hasRelicTimeline={hasRelicTimeline}
          tooltipData={tooltipData}
          hp={snap?.hp ?? null}
          gold={snap?.total_money ?? null}
          board={snap?.board}
          lineupStr={lineupStr}
          hand={hand}
          pandarenDrops={pandarenDrops}
        />
      )}
    </div>
  );
}

export { type GamePageProps, type MatchTimeline, type RelicTimelineEntry };

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
  const hasTimeline = !!(
    timeline &&
    timeline.rounds &&
    timeline.rounds.length > 0
  );
  const [selectedRoundIdx, setSelectedRoundIdx] = useState<number>(
    hasTimeline ? timeline!.rounds.length - 1 : 0,
  );
  const currentSnap: TimelineRound | null = hasTimeline
    ? (timeline!.rounds[selectedRoundIdx] ?? null)
    : null;
  const selectedRound = currentSnap?.round ?? null;
  const isLastRound = hasTimeline
    ? selectedRoundIdx === timeline!.rounds.length - 1
    : true;
  const canSelectRounds = hasTimeline && timeline!.rounds.length > 1;
  const roundButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const roundWheelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wheel = roundWheelRef.current;
    const button = roundButtonRefs.current[selectedRoundIdx];
    if (!wheel || !button) return;
    const buttonTop = button.offsetTop;
    const buttonBottom = buttonTop + button.offsetHeight;
    const visibleTop = wheel.scrollTop;
    const visibleBottom = visibleTop + wheel.clientHeight;
    if (buttonTop < visibleTop) {
      wheel.scrollTop = buttonTop;
    } else if (buttonBottom > visibleBottom) {
      wheel.scrollTop = buttonBottom - wheel.clientHeight;
    }
  }, [selectedRoundIdx]);

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
    if (
      effectiveHighlightName &&
      normalizeName(g.notes) === effectiveHighlightName
    ) {
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
    () => new Set(initiallyExpanded.length ? initiallyExpanded : [game.id]),
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
  const deathRounds = new Map<string, number>();
  for (const g of basePlayerRows) {
    const placement = parseInt(g.placement) || 0;
    if (placement <= 1 || typeof g.final_round !== "number") continue;
    deathRounds.set(String(g.user_id), g.final_round);
  }
  const playerRows: Game[] = [...basePlayerRows].sort((a, b) => {
    const finalPlacementDelta =
      (parseInt(a.placement) || 99) - (parseInt(b.placement) || 99);
    const aProfile = matchProfiles[String(a.user_id)];
    const bProfile = matchProfiles[String(b.user_id)];
    const aName = aProfile?.name || a.notes || String(a.user_id || a.id);
    const bName = bProfile?.name || b.notes || String(b.user_id || b.id);
    const nameDelta = aName.localeCompare(bName, undefined, {
      sensitivity: "base",
    });
    return finalPlacementDelta || nameDelta;
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

  const { date: matchDate, time: matchTime } = formatMatchDateTime(
    game.played_at,
  );

  return (
    <>
      <div className={styles.page}>
        <div className={styles.container}>
          {/* Slim match-meta strip */}
          <div className={styles.matchMeta}>
            <strong>Match</strong>
            {matchDate && (
              <>
                <span className={styles.sep}>{"-"}</span>
                <span>
                  {matchDate}
                  {matchTime ? `, ${matchTime}` : ""}
                </span>
              </>
            )}
            <span className={styles.sep}>{"-"}</span>
            <span>
              {playerRows.length}{" "}
              {playerRows.length === 1 ? "player" : "players"}
            </span>
          </div>

          {/* Screenshot banner (only on the viewed player's row's game) */}
          {game.screenshot && (
            <div className={styles.screenshotBanner}>
              <img src={game.screenshot} alt="Game screenshot" loading="lazy" />
            </div>
          )}

          {/* Players table, viewed row pre-expanded */}
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
            <div
              className={
                canSelectRounds
                  ? styles.matchSectionBody
                  : styles.matchSectionBodyNoRail
              }
            >
              {canSelectRounds && (
                <div className={styles.roundScrubber}>
                  <div className={styles.rsHeader}>
                    <div>
                      <span className={styles.rsLabel}>Round</span>
                      <div className={styles.rsCurrent}>
                        <strong className={styles.rsValue}>
                          {selectedRound}
                        </strong>
                        <span className={styles.rsMeta}>
                          / {timeline!.last_round}
                          {isLastRound ? " final" : ""}
                        </span>
                      </div>
                    </div>
                    {!isLastRound && (
                      <button
                        type="button"
                        className={styles.rsJumpEnd}
                        onClick={() =>
                          setSelectedRoundIdx(timeline!.rounds.length - 1)
                        }
                      >
                        End
                      </button>
                    )}
                  </div>
                  <div className={styles.rsBody}>
                    <div
                      className={styles.rsWheel}
                      ref={roundWheelRef}
                      role="listbox"
                      aria-label="Select match round"
                      aria-activedescendant={`round-option-${selectedRoundIdx}`}
                    >
                      {timeline!.rounds.map((round, index) => {
                        const roundNumber = round.round ?? index + 1;
                        const selected = index === selectedRoundIdx;
                        return (
                          <button
                            key={`${roundNumber}-${index}`}
                            id={`round-option-${index}`}
                            ref={(node) => {
                              roundButtonRefs.current[index] = node;
                            }}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={
                              styles.rsRoundButton +
                              (selected
                                ? ` ${styles.rsRoundButtonSelected}`
                                : "")
                            }
                            onClick={() => setSelectedRoundIdx(index)}
                          >
                            R{roundNumber}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              <div className={styles.playersList}>
                {playerRows.map((g) => {
                  const deathRound =
                    deathRounds.get(String(g.user_id)) ?? null;
                  const finalPosition = parseInt(g.placement) || null;
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
                      snap={currentSnap?.players?.[String(g.user_id)] ?? null}
                      snapRound={selectedRound}
                      isLastRound={isLastRound}
                      displayPosition={finalPosition}
                      deathRound={deathRound}
                      tooltipData={tooltipData}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
