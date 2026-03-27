import type { ReactNode, CSSProperties, MouseEventHandler } from "react";
import type { Game } from "./types";
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

export interface GameRowDisplayProps {
  game: Game;
  unitCosts: Record<string, number>;
  /** Resolve an icon URL. type = "units" | "synergies" | "relics" */
  iconUrl: (type: string, stem: string) => string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  /** Extra content appended inside the date cell (e.g. replay button) */
  dateExtra?: ReactNode;
}

export function GameRowDisplay({
  game,
  unitCosts,
  iconUrl,
  onClick,
  style,
  dateExtra,
}: GameRowDisplayProps) {
  const p = parseInt(game.placement) || 0;
  const wl = parseWL(game.wl);
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
          {game.placement}
        </div>
      </div>

      <div className="cell units-cell">
        {lineup.length > 0 && (
          <div className="lineup">
            {lineup.map((u, i) => (
              <div
                key={i}
                className="unit-icon-wrap"
                title={`${u.name}${u.stars > 1 ? ` ${"★".repeat(u.stars)}` : ""}`}
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
            ))}
          </div>
        )}
        {syns.length > 0 && (
          <div className="synergies">
            {syns.map((s, i) => (
              <div key={i} className="syn-badge" title={`${s.name}: ${s.count}`}>
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
            ))}
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
            {relics.map((r, i) => (
              <img
                key={i}
                className="relic-icon"
                src={iconUrl("relics", relicStem(r))}
                alt={r}
                title={r}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ))}
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
        {dateExtra}
      </div>
    </div>
  );
}
