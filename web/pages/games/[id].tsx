import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/router";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import unitsData from "@data/units.json";
import unitsFullData from "@data/units_full.json";
import synergiesData from "@data/synergies.json";
import relicsData from "@data/relics.json";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";
import {
  parseLineup,
  parseSynergies,
  parseRelics,
  placementColor,
  placementBg,
  costBorderColor,
  unitStem,
  synIconName,
  relicStem,
} from "@dac/shared/game-utils";
import { TooltipWrap, type TooltipData } from "@dac/shared/Tooltip";
import {
  fetchSteamProfile,
  playerProfilePath,
  steamProfileUrl,
  type SteamProfile,
} from "../../lib/steam";
import { SeoHead } from "@/lib/seo";
import { absoluteUrl, getRequestSiteUrl, SITE_TITLE } from "@/lib/site";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import { resolveIconUrl } from "@/lib/icons";

const UNIT_COSTS: Record<string, number> = {};
for (const [name, info] of Object.entries(unitsData.units)) {
  UNIT_COSTS[name] = (info as { cost: number }).cost;
}
for (const [alias, canonical] of Object.entries(
  (unitsData as { aliases?: Record<string, string> }).aliases ?? {}
)) {
  if (UNIT_COSTS[canonical] !== undefined) {
    UNIT_COSTS[alias] = UNIT_COSTS[canonical];
  }
}
const UNITS_FULL = unitsFullData as Record<string, UnitFullInfo>;
const SYNERGIES_DATA = synergiesData as Record<string, SynergyInfo>;
const RELICS_DATA = (relicsData as any).relics as Record<string, RelicInfo>;

const iconUrl = resolveIconUrl;

interface GamePageProps {
  game: Game;
  steamProfile: SteamProfile;
  matchGames: Game[];
  matchProfiles: Record<string, SteamProfile>;
  highlightUserId: string | null;
  highlightName: string | null;
  canonicalUrl: string | null;
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

/** Compact row for a player in the match table */
function MatchPlayerRow({
  game,
  profile,
  highlighted,
  tooltipData,
}: {
  game: Game;
  profile: SteamProfile;
  highlighted: boolean;
  tooltipData: TooltipData;
}) {
  const p = parseInt(game.placement) || 0;
  const pColor = placementColor(p);
  // When the upload couldn't link the row to a Steam account, the Game Over
  // backend stores the OCR'd player name in `notes`. Use that as a fallback
  // so the row isn't anonymous.
  const ocrName = game.notes && game.notes.trim() ? game.notes.trim() : null;
  const displayName =
    profile.name ||
    ocrName ||
    (game.user_id ? String(game.user_id) : `Player #${game.placement}`);
  const hasProfile = Boolean(game.user_id);
  const profileUrl = hasProfile
    ? steamProfileUrl(String(game.user_id), profile.customUrl)
    : null;
  const synergies = parseSynergies(game.synergies);
  const relics = parseRelics(game.relic);
  const lineup = parseLineup(game.lineup, UNIT_COSTS);

  return (
    <div className={`match-player-row${highlighted ? " highlighted" : ""}`}>
      <div className="mp-placement" style={{ color: pColor, borderColor: pColor }}>
        {game.placement ?? "\u2014"}
      </div>
      <div className="mp-info">
        <div className="mp-name-row">
          {profileUrl ? (
            <Link
              href={playerProfilePath(String(game.user_id), profile.customUrl)}
              className="mp-name"
            >
              {displayName}
            </Link>
          ) : (
            <span className="mp-name mp-name-unknown">{displayName}</span>
          )}
        </div>
        <div className="mp-stats">
          {game.rank && (
            <span className="mp-rank">{game.rank}</span>
          )}
          {game.level && (
            <span className="mp-stat">
              <span className="mp-stat-label">Lv</span>{game.level}
            </span>
          )}
          {game.wins != null && game.losses != null && (
            <span className="mp-stat">
              <span className="wl-w">{game.wins}</span>
              <span className="mp-wl-sep">{"\u2013"}</span>
              <span className="wl-l">{game.losses}</span>
            </span>
          )}
        </div>
      </div>
      <div className="mp-build">
        {lineup.length > 0 && (
          <div className="mp-lineup">
            {lineup.map((u, i) => (
              <TooltipWrap key={i} type="unit" name={u.name} stars={u.stars} data={tooltipData}>
                <div className="unit-icon-wrap mp-unit">
                  <img
                    className="unit-icon"
                    src={iconUrl("units", unitStem(u.name))}
                    alt={u.name}
                    loading="lazy"
                    style={{ borderColor: costBorderColor(UNIT_COSTS[u.name] || 1) }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  {u.stars > 1 && (
                    <span className={`unit-stars s${u.stars}`}>{"★".repeat(u.stars)}</span>
                  )}
                </div>
              </TooltipWrap>
            ))}
          </div>
        )}
        {(synergies.length > 0 || relics.length > 0) && (
          <div className="mp-syn-relics">
            {synergies.length > 0 && (
              <div className="mp-synergies">
                {synergies.map((s, i) => (
                  <TooltipWrap key={i} type="synergy" name={s.name} count={s.count} data={tooltipData}>
                    <div className="syn-badge mp-syn-badge">
                      <img
                        className="syn-icon"
                        src={iconUrl("synergies", synIconName(s.name))}
                        alt={s.name}
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <span className="syn-count">{s.count}</span>
                    </div>
                  </TooltipWrap>
                ))}
              </div>
            )}
            {relics.length > 0 && (
              <div className="mp-relics">
                {relics.map((r, i) => (
                  <TooltipWrap key={i} type="relic" name={r} relicIndex={i} data={tooltipData}>
                    <img
                      className="relic-icon mp-relic-icon"
                      src={iconUrl("relics", relicStem(r))}
                      alt={r}
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </TooltipWrap>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GamePage({
  game,
  steamProfile,
  matchGames,
  matchProfiles,
  highlightUserId,
  highlightName,
  canonicalUrl,
}: GamePageProps) {
  const router = useRouter();
  const p = parseInt(game.placement) || 0;
  const pColor = placementColor(p);
  const lineup = parseLineup(game.lineup, UNIT_COSTS);
  const synergies = parseSynergies(game.synergies);
  const relics = parseRelics(game.relic);

  const rankParts = game.rank ? game.rank.split("-") : [];
  const tier = rankParts[0] || "";
  const rankNum = rankParts[1] || "";

  const displayName = steamProfile.name || game.user_id;
  const profileUrl = steamProfileUrl(String(game.user_id), steamProfile.customUrl);
  const playerPath = playerProfilePath(String(game.user_id), steamProfile.customUrl);
  const playerCanonicalUrl =
    absoluteUrl(playerPath, originFromUrl(canonicalUrl)) ?? playerPath;
  const pageTitle = `${game.placement ? `#${game.placement} | ` : ""}${displayName} | ${SITE_TITLE}`;
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

  // Determine which user_id to highlight, plus a name fallback for cases
  // where the Game Over import couldn't link rows to a Steam account.
  const effectiveHighlight = highlightUserId || String(game.user_id);
  const effectiveHighlightName = normalizeName(highlightName);
  const isHighlightedRow = (g: Game): boolean => {
    if (g.user_id && String(g.user_id) === effectiveHighlight) return true;
    if (effectiveHighlightName && normalizeName(g.notes) === effectiveHighlightName) {
      return true;
    }
    return false;
  };

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
      player_bucket: bucketCount(matchGames.length || 1),
    });
  }, [
    game.id,
    game.placement,
    game.screenshot,
    lineup.length,
    matchGames.length,
    router.pathname,
  ]);

  return (
    <>
      <SeoHead
        title={pageTitle}
        description={description}
        path={`/games/${game.id}`}
        localized={false}
        canonicalUrl={canonicalUrl}
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

        /* ── Main match card ───────────────────────────── */
        .match-card {
          border: 1px solid var(--border);
          border-radius: var(--r-8);
          background: var(--bg-surface);
          overflow: hidden;
        }
        .match-header {
          display: flex;
          align-items: center;
          gap: 24px;
          padding: 28px 28px 24px;
          background:
            linear-gradient(135deg, ${placementBg(p)} 0%, transparent 65%),
            var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
        }
        .placement {
          font-size: 36px;
          font-weight: 700;
          font-family: var(--font-display);
          width: 72px;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          border-radius: var(--r-4);
          flex-shrink: 0;
          background: rgba(0, 0, 0, 0.22);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
        }
        .header-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .player-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .player-name {
          font-family: var(--font-display);
          font-size: 26px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0.5px;
          transition: color var(--t-base) var(--t-easing);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .player-name:hover {
          color: #fff;
        }
        .rank-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-3);
          letter-spacing: 0.5px;
        }
        .rank-text {
          color: var(--text-primary);
        }
        .arrow-up {
          color: var(--green-bright);
          font-size: 10px;
          line-height: 1;
        }
        .arrow-down {
          color: var(--red-bright);
          font-size: 10px;
          line-height: 1;
        }
        .meta-row {
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.4px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        .meta-row a {
          color: var(--text-muted);
          transition: color var(--t-base) var(--t-easing);
        }
        .meta-row a:hover {
          color: var(--text-secondary);
        }
        .meta-sep {
          color: var(--text-muted);
          opacity: 0.5;
        }
        .meta-date {
          color: var(--text-muted);
        }
        .stats-row {
          display: flex;
          gap: 8px;
          margin-top: 4px;
          flex-wrap: wrap;
        }
        .stat-chip {
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          padding: 6px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-3);
          font-size: 14px;
        }
        .stat-label {
          color: var(--text-muted);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          font-weight: 500;
        }
        .stat-value {
          color: var(--text-primary);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .wl-w {
          color: var(--green-bright);
        }
        .wl-l {
          color: var(--red-bright);
        }
        .wl-sep {
          color: var(--text-muted);
          margin: 0 3px;
          opacity: 0.6;
        }

        /* ── Screenshot ────────────────────────────────── */
        .screenshot-section {
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-deep);
        }
        .screenshot-section img {
          display: block;
          width: 100%;
          height: auto;
        }

        /* ── Build sections ────────────────────────────── */
        .section {
          padding: 20px 28px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .section:last-child {
          border-bottom: none;
        }
        .section-label {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 11px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-secondary);
          margin-bottom: 14px;
          font-weight: 600;
        }
        .section-bar {
          display: inline-block;
          width: 3px;
          height: 12px;
          background: var(--accent);
          border-radius: 2px;
        }
        .detail-lineup {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .detail-synergies {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .detail-relics {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        /* ── Match Players section ─────────────────────── */
        .match-section {
          margin-top: 24px;
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
        .match-section-count {
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 1px;
          text-transform: uppercase;
          font-variant-numeric: tabular-nums;
        }

        /* ── Responsive ────────────────────────────────── */
        @media (max-width: 720px) {
          .container {
            padding: 20px 16px 60px;
          }
          .match-header {
            padding: 20px;
            gap: 16px;
          }
          .placement {
            width: 56px;
            height: 56px;
            font-size: 28px;
          }
          .player-name {
            font-size: 22px;
          }
          .section {
            padding: 16px 20px;
          }
          .match-section-header {
            padding: 14px 20px;
          }
        }
      `}</style>

      {/*
        MatchPlayerRow lives in a sibling function, so styled-jsx's
        per-component scoping wouldn't reach its JSX. Use a global
        block for the .match-player-row / .mp-* rules.
      */}
      <style jsx global>{`
        .match-player-row {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 14px 24px;
          border-bottom: 1px solid var(--border-subtle);
          transition: background var(--t-base) var(--t-easing);
          position: relative;
        }
        .match-player-row:last-child {
          border-bottom: none;
        }
        .match-player-row:hover {
          background: var(--bg-hover);
        }
        .match-player-row.highlighted {
          background: rgba(224, 64, 42, 0.06);
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
          width: 160px;
          flex-shrink: 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .mp-name-row {
          display: flex;
          align-items: center;
          min-width: 0;
        }
        .mp-name {
          font-size: 14px;
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
          font-size: 10px;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-2);
          padding: 1px 5px;
          letter-spacing: 0.4px;
          font-weight: 600;
        }
        .mp-stats {
          display: flex;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
          align-items: center;
          flex-wrap: wrap;
        }
        .mp-stat {
          display: inline-flex;
          align-items: baseline;
          gap: 3px;
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
        .mp-build {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .mp-lineup {
          display: flex;
          gap: 3px;
          flex-wrap: wrap;
          align-items: center;
        }
        .mp-unit .unit-icon {
          width: 26px;
          height: 26px;
        }
        .mp-syn-relics {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
        }
        .mp-synergies {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
          align-items: center;
        }
        .mp-syn-badge {
          padding: 2px 5px 2px 3px;
        }
        .mp-syn-badge .syn-icon {
          width: 14px;
          height: 14px;
        }
        .mp-syn-badge .syn-count {
          font-size: 10px;
        }
        .mp-relics {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
          align-items: center;
        }
        .mp-relic-icon {
          width: 22px !important;
          height: 22px !important;
        }
        @media (max-width: 720px) {
          .match-player-row {
            flex-wrap: wrap;
            padding: 14px 20px;
          }
          .mp-info {
            width: auto;
            flex: 1;
          }
          .mp-build {
            flex-basis: 100%;
            margin-left: 52px;
          }
        }
      `}</style>

      <div className="page">
        <div className="container">
          <div className="match-card">
            {/* Header: placement + player info */}
            <div className="match-header">
              <div
                className="placement"
                style={{ color: pColor, borderColor: pColor }}
              >
                {game.placement ?? "\u2014"}
              </div>
              <div className="header-info">
                <div className="player-row">
                  <Link
                    href={playerPath}
                    className="player-name"
                  >
                    {displayName}
                  </Link>
                  {game.rank && (
                    <span className="rank-chip">
                      <span className="rank-text">
                        {tier}
                        {rankNum ? `-${rankNum}` : ""}
                      </span>
                      {game.rank_change === "up" && (
                        <span className="arrow-up">&#9650;</span>
                      )}
                      {game.rank_change === "down" && (
                        <span className="arrow-down">&#9660;</span>
                      )}
                    </span>
                  )}
                </div>
                <div className="meta-row">
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {steamProfile.customUrl
                      ? `steamcommunity.com/id/${steamProfile.customUrl}`
                      : game.user_id}
                  </a>
                  {game.played_at && (
                    <>
                      <span className="meta-sep">{"\u00B7"}</span>
                      <span className="meta-date">
                        {new Date(game.played_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                        {", "}
                        {new Date(game.played_at).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </>
                  )}
                </div>
                <div className="stats-row">
                  {game.level && (
                    <span className="stat-chip">
                      <span className="stat-label">Level</span>
                      <span className="stat-value">{game.level}</span>
                    </span>
                  )}
                  {game.wins != null && game.losses != null && (
                    <span className="stat-chip">
                      <span className="stat-label">Record</span>
                      <span className="stat-value">
                        <span className="wl-w">{game.wins}</span>
                        <span className="wl-sep">{"\u2013"}</span>
                        <span className="wl-l">{game.losses}</span>
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Screenshot */}
            {game.screenshot && (
              <div className="screenshot-section">
                <img
                  src={game.screenshot}
                  alt="Game screenshot"
                  loading="lazy"
                />
              </div>
            )}

            {/* Lineup */}
            {lineup.length > 0 && (
              <div className="section">
                <div className="section-label"><span className="section-bar" />Lineup</div>
                <div className="detail-lineup">
                  {lineup.map((u, i) => (
                    <TooltipWrap
                      key={i}
                      type="unit"
                      name={u.name}
                      stars={u.stars}
                      data={tooltipData}
                    >
                      <div className="unit-icon-wrap">
                        <img
                          className="unit-icon"
                          src={iconUrl("units", unitStem(u.name))}
                          alt={u.name}
                          loading="lazy"
                          style={{
                            borderColor: costBorderColor(
                              UNIT_COSTS[u.name] || 1
                            ),
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
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

            {/* Synergies */}
            {synergies.length > 0 && (
              <div className="section">
                <div className="section-label"><span className="section-bar" />Synergies</div>
                <div className="detail-synergies">
                  {synergies.map((s, i) => (
                    <TooltipWrap
                      key={i}
                      type="synergy"
                      name={s.name}
                      count={s.count}
                      data={tooltipData}
                    >
                      <div className="syn-badge">
                        <img
                          className="syn-icon"
                          src={iconUrl("synergies", synIconName(s.name))}
                          alt={s.name}
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                        <span className="syn-count">{s.count}</span>
                      </div>
                    </TooltipWrap>
                  ))}
                </div>
              </div>
            )}

            {/* Relics */}
            {relics.length > 0 && (
              <div className="section">
                <div className="section-label"><span className="section-bar" />Relics</div>
                <div className="detail-relics">
                  {relics.map((r, i) => (
                    <TooltipWrap
                      key={i}
                      type="relic"
                      name={r}
                      relicIndex={i}
                      data={tooltipData}
                    >
                      <img
                        className="relic-icon"
                        src={iconUrl("relics", relicStem(r))}
                        alt={r}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </TooltipWrap>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Match Players — all players in this match */}
          {matchGames.length > 1 && (
            <div className="match-section">
              <div className="match-section-header">
                <h3>
                  <span className="section-bar" />Match Players
                </h3>
                <span className="match-section-count">
                  {matchGames.length} {matchGames.length === 1 ? "player" : "players"}
                </span>
              </div>
              {matchGames
                .sort((a, b) => (parseInt(a.placement) || 99) - (parseInt(b.placement) || 99))
                .map((g) => (
                  <MatchPlayerRow
                    key={g.id}
                    game={g}
                    profile={matchProfiles[String(g.user_id)] || { name: null, customUrl: null }}
                    highlighted={isHighlightedRow(g)}
                    tooltipData={tooltipData}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
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
    .from("games")
    .select("*, user_id::text")
    .eq("id", id)
    .single();

  if (!data) return { notFound: true };

  // Kick off the row-owner Steam profile fetch and the match games query in
  // parallel — both only depend on the single-game row already in hand.
  const ownerProfilePromise: Promise<SteamProfile> = data.user_id
    ? fetchSteamProfile(String(data.user_id), supabase)
    : Promise.resolve({ name: null, customUrl: null });

  const matchGamesPromise: Promise<Game[]> = data.match_id
    ? Promise.resolve(
        supabase
          .from("games")
          .select("*, user_id::text")
          .eq("match_id", data.match_id)
          .order("placement", { ascending: true })
      ).then(({ data: matchData }) => (matchData as Game[] | null) || [])
    : Promise.resolve([]);

  const [steamProfile, matchGames] = await Promise.all([
    ownerProfilePromise,
    matchGamesPromise,
  ]);

  const matchProfiles: Record<string, SteamProfile> = {};
  if (matchGames.length > 0) {
    const userIds = [...new Set(
      matchGames
        .map((g) => g.user_id)
        .filter(Boolean)
        .map(String)
    )];

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
      game: data,
      steamProfile,
      matchGames,
      matchProfiles,
      highlightUserId,
      highlightName,
      canonicalUrl: absoluteUrl(`/games/${id}`, baseUrl),
    },
  };
};
