import Head from "next/head";
import Link from "next/link";
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
  steamProfileUrl,
  type SteamProfile,
} from "../../lib/steam";

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

const iconUrl = (type: string, stem: string) => `/icons/${type}/${stem}.png`;

interface GamePageProps {
  game: Game;
  steamProfile: SteamProfile;
  matchGames: Game[];
  matchProfiles: Record<string, SteamProfile>;
  highlightUserId: string | null;
  supabase: SupabaseClient | null;
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
  const displayName = profile.name || (game.user_id ? String(game.user_id) : `Player #${game.placement}`);
  const profileUrl = game.user_id
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
              href={`/players/${game.user_id}`}
              className="mp-name"
            >
              {displayName}
            </Link>
          ) : (
            <span className="mp-name mp-name-unknown">{displayName}</span>
          )}
          {game.rank && (
            <span className="mp-rank">{game.rank}</span>
          )}
        </div>
        <div className="mp-stats">
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
        {synergies.length > 0 && (
          <div className="mp-synergies">
            {synergies.map((s, i) => (
              <TooltipWrap key={i} type="synergy" name={s.name} count={s.count} data={tooltipData}>
                <div className="syn-badge" style={{ transform: "scale(0.85)" }}>
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
                  className="relic-icon"
                  src={iconUrl("relics", relicStem(r))}
                  alt={r}
                  loading="lazy"
                  style={{ width: 20, height: 20 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </TooltipWrap>
            ))}
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
}: GamePageProps) {
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

  const tooltipData: TooltipData = {
    unitCosts: UNIT_COSTS,
    unitsFull: UNITS_FULL,
    synergiesData: SYNERGIES_DATA,
    relicsData: RELICS_DATA,
    iconUrl,
  };

  // Other players in the match (excluding the main game)
  const otherPlayers = matchGames
    .filter((g) => g.id !== game.id)
    .sort((a, b) => (parseInt(a.placement) || 99) - (parseInt(b.placement) || 99));

  // Determine which user_id to highlight
  const effectiveHighlight = highlightUserId || String(game.user_id);

  return (
    <>
      <Head>
        <title>
          {game.placement ? `#${game.placement} — ` : ""}
          {displayName} — DAC Tools
        </title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .container {
          max-width: 900px;
          margin: 40px auto;
          padding: 0 32px 80px;
        }
        .match-card {
          border: 1px solid var(--border);
          background: var(--bg-surface);
        }
        .match-header {
          display: flex;
          align-items: flex-start;
          gap: 20px;
          padding: 24px;
          background: ${placementBg(p)};
          border-bottom: 1px solid var(--border-subtle);
        }
        .placement {
          font-size: 32px;
          font-weight: 700;
          font-family: "Cinzel", serif;
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          flex-shrink: 0;
        }
        .header-info {
          flex: 1;
          min-width: 0;
        }
        .player-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 4px;
        }
        .player-name {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
          transition: color 0.15s;
        }
        .player-name:hover {
          color: #fff;
        }
        .rank {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          color: var(--text-secondary);
        }
        .arrow-up {
          color: var(--green-bright);
          font-size: 12px;
        }
        .arrow-down {
          color: var(--red-bright);
          font-size: 12px;
        }
        .meta-row {
          font-size: 13px;
          color: var(--text-muted);
          letter-spacing: 0.3px;
        }
        .meta-row a {
          color: var(--text-muted);
          transition: color 0.15s;
        }
        .meta-row a:hover {
          color: var(--text-secondary);
        }
        .stats-row {
          display: flex;
          gap: 16px;
          margin-top: 8px;
          font-size: 14px;
        }
        .stat {
          color: var(--text-secondary);
        }
        .stat-label {
          color: var(--text-muted);
          font-size: 12px;
          margin-right: 4px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .wl-w {
          color: var(--green-bright);
        }
        .wl-l {
          color: var(--red-bright);
        }
        .screenshot-section {
          border-bottom: 1px solid var(--border-subtle);
        }
        .screenshot-section img {
          display: block;
          width: 100%;
          height: auto;
        }
        .section {
          padding: 20px 24px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .section:last-child {
          border-bottom: none;
        }
        .section-label {
          font-size: 11px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 12px;
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

        /* Match Players section */
        .match-section {
          margin-top: 24px;
          border: 1px solid var(--border);
          background: var(--bg-surface);
        }
        .match-section-header {
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .match-section-header h3 {
          margin: 0;
          font-size: 13px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 500;
        }
        .match-player-row {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 12px 24px;
          border-bottom: 1px solid var(--border-subtle);
          transition: background 0.1s;
        }
        .match-player-row:last-child {
          border-bottom: none;
        }
        .match-player-row.highlighted {
          background: rgba(255, 255, 255, 0.04);
          border-left: 3px solid var(--text-secondary);
          padding-left: 21px;
        }
        .mp-placement {
          font-size: 18px;
          font-weight: 700;
          font-family: "Cinzel", serif;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          flex-shrink: 0;
        }
        .mp-info {
          min-width: 120px;
          flex-shrink: 0;
        }
        .mp-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .mp-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          text-decoration: none;
          transition: color 0.15s;
        }
        .mp-name:hover {
          color: #fff;
        }
        .mp-name-unknown {
          color: var(--text-muted);
          font-style: italic;
        }
        .mp-rank {
          font-size: 12px;
          color: var(--text-muted);
        }
        .mp-stats {
          display: flex;
          gap: 10px;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .mp-stat-label {
          font-size: 10px;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-right: 2px;
        }
        .mp-wl-sep {
          color: var(--text-muted);
          margin: 0 1px;
        }
        .mp-build {
          flex: 1;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          min-width: 0;
        }
        .mp-lineup {
          display: flex;
          gap: 3px;
          flex-wrap: wrap;
          align-items: center;
        }
        .mp-unit :global(.unit-icon) {
          width: 24px;
          height: 24px;
        }
        .mp-synergies {
          display: flex;
          gap: 2px;
          flex-wrap: wrap;
          align-items: center;
        }
        .mp-relics {
          display: flex;
          gap: 3px;
          align-items: center;
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
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="player-name"
                  >
                    {displayName}
                  </a>
                  {game.rank && (
                    <span className="rank">
                      {tier}
                      {rankNum ? `-${rankNum}` : ""}
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
                      {" \u00B7 "}
                      {new Date(game.played_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      {new Date(game.played_at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </>
                  )}
                </div>
                <div className="stats-row">
                  {game.level && (
                    <span className="stat">
                      <span className="stat-label">Lv</span>
                      {game.level}
                    </span>
                  )}
                  {game.wins != null && game.losses != null && (
                    <span className="stat">
                      <span className="wl-w">{game.wins}</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {" \u2013 "}
                      </span>
                      <span className="wl-l">{game.losses}</span>
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
                <div className="section-label">Lineup</div>
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
                <div className="section-label">Synergies</div>
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
                <div className="section-label">Relics</div>
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
                <h3>Match Players</h3>
              </div>
              {matchGames
                .sort((a, b) => (parseInt(a.placement) || 99) - (parseInt(b.placement) || 99))
                .map((g) => (
                  <MatchPlayerRow
                    key={g.id}
                    game={g}
                    profile={matchProfiles[String(g.user_id)] || { name: null, customUrl: null }}
                    highlighted={String(g.user_id) === effectiveHighlight}
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
  const { id } = context.params!;
  const highlightUserId = (context.query.player as string) || null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return { notFound: true };

  const supabase = createClient(url, key);
  const { data } = await supabase
    .from("games")
    .select("*")
    .eq("id", id)
    .single();

  if (!data) return { notFound: true };

  const steamProfile = data.user_id
    ? await fetchSteamProfile(String(data.user_id), supabase)
    : { name: null, customUrl: null };

  // Fetch all games in the same match
  let matchGames: Game[] = [];
  const matchProfiles: Record<string, SteamProfile> = {};

  if (data.match_id) {
    const { data: matchData } = await supabase
      .from("games")
      .select("*")
      .eq("match_id", data.match_id)
      .order("placement", { ascending: true });

    matchGames = matchData || [];

    // Fetch profiles for all unique user_ids in the match
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

  return {
    props: {
      game: data,
      steamProfile,
      matchGames,
      matchProfiles,
      highlightUserId,
    },
  };
};
