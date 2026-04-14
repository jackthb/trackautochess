import type { ReactNode, CSSProperties, MouseEventHandler } from "react";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "./types";
import {
  placementColor,
  placementBg,
  costBorderColor,
  unitStem,
  relicStem,
  synIconName,
  parseLineup,
  parseSynergies,
  parseRelics,
  parseWL,
} from "./game-utils";
import { TooltipWrap, type TooltipData } from "./Tooltip";

export interface GameRowDisplayProps {
  game: Game;
  unitCosts: Record<string, number>;
  /** Resolve an icon URL. type = "units" | "synergies" | "relics" */
  iconUrl: (type: string, stem: string) => string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  /** Extra content appended inside the date cell (e.g. replay button) */
  dateExtra?: ReactNode;
  /** URL to open when the share button is clicked */
  shareUrl?: string;
  /** Pass these to enable rich tooltips on hover */
  unitsFull?: Record<string, UnitFullInfo>;
  synergiesData?: Record<string, SynergyInfo>;
  relicsData?: Record<string, RelicInfo>;
}

export function GameRowDisplay({
  game,
  unitCosts,
  iconUrl,
  onClick,
  style,
  dateExtra,
  shareUrl,
  unitsFull,
  synergiesData,
  relicsData,
}: GameRowDisplayProps) {
  const tooltipData: TooltipData | null =
    unitsFull || synergiesData || relicsData
      ? { unitCosts, unitsFull, synergiesData, relicsData, iconUrl }
      : null;
  const p = parseInt(game.placement) || 0;
  const wl = game.wins != null && game.losses != null
    ? { w: game.wins, l: game.losses }
    : parseWL(game.wl);
  const rankParts = game.rank ? game.rank.split("-") : [];
  const tier = rankParts[0] || "";
  const rankNum = rankParts[1] || "";
  const lineup = parseLineup(game.lineup, unitCosts);
  const syns = parseSynergies(game.synergies);
  const relics = parseRelics(game.relic);
  const pColor = placementColor(p);

  return (
    <div
      className="game-row"
      onClick={onClick}
      style={{ background: placementBg(p), ...style }}
    >
      <div className="cell">
        <div className="placement" style={{ color: pColor, borderColor: pColor }}>
          {game.placement ?? "\u2014"}
        </div>
      </div>

      <div className="cell units-cell">
        {lineup.length > 0 && (
          <div className="lineup">
            {lineup.map((u, i) => {
              const icon = (
                <div
                  key={i}
                  className="unit-icon-wrap"
                  title={tooltipData ? undefined : `${u.name}${u.stars > 1 ? ` ${"★".repeat(u.stars)}` : ""}`}
                >
                  <img
                    className="unit-icon"
                    src={iconUrl("units", unitStem(u.name))}
                    alt={u.name}
                    loading="lazy"
                    style={{ borderColor: costBorderColor(unitCosts[u.name] || 1) }}
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
              );
              return tooltipData ? (
                <TooltipWrap key={i} type="unit" name={u.name} stars={u.stars} data={tooltipData}>
                  {icon}
                </TooltipWrap>
              ) : icon;
            })}
          </div>
        )}
        {syns.length > 0 && (
          <div className="synergies">
            {syns.map((s, i) => {
              const badge = (
                <div key={i} className="syn-badge" title={tooltipData ? undefined : `${s.name}: ${s.count}`}>
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
              );
              return tooltipData ? (
                <TooltipWrap key={i} type="synergy" name={s.name} count={s.count} data={tooltipData}>
                  {badge}
                </TooltipWrap>
              ) : badge;
            })}
          </div>
        )}
      </div>

      <div className="cell rank-cell">
        <span className="rank-tier">{tier}</span>
        <span className="rank-num">{rankNum}</span>
        {game.rank && game.rank_change === "up" && (
          <span className="arrow-up">&#9650;</span>
        )}
        {game.rank && game.rank_change === "down" && (
          <span className="arrow-down">&#9660;</span>
        )}
      </div>

      <div className="cell wl">
        {wl ? (
          <>
            <span className="wl-w">{wl.w}</span>
            <span className="wl-sep"> &ndash; </span>
            <span className="wl-l">{wl.l}</span>
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>&mdash;</span>
        )}
      </div>

      <div className="cell level-cell">{game.level || "\u2014"}</div>

      <div className="cell relics-cell">
        {relics.length > 0 ? (
          <div className="relics">
            {relics.map((r, i) => {
              const icon = (
                <img
                  key={i}
                  className="relic-icon"
                  src={iconUrl("relics", relicStem(r))}
                  alt={r}
                  title={tooltipData ? undefined : r}
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              );
              return tooltipData ? (
                <TooltipWrap key={i} type="relic" name={r} relicIndex={i} data={tooltipData}>
                  {icon}
                </TooltipWrap>
              ) : icon;
            })}
          </div>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>&mdash;</span>
        )}
      </div>

      <div className="cell date-cell">
        {game.played_at ? (
          <>
            <div>
              {new Date(game.played_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </div>
            <div>
              {new Date(game.played_at).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </>
        ) : (
          "\u2014"
        )}
        {shareUrl && (
          <a
            className="btn-share"
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open share page"
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
        {dateExtra}
      </div>
    </div>
  );
}
