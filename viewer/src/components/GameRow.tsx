import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "../types";
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
} from "../lib/game-utils";
import { Tooltip } from "./Tooltip";

interface GameRowProps {
  game: Game;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
}

export function GameRow({
  game,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
}: GameRowProps) {
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
    <div className="game-entry" style={{ background: placementBg(p) }}>
      <div className="game-row">
        <div className="cell">
          <div
            className="placement"
            style={{ color: pColor, borderColor: pColor }}
          >
            {game.placement}
          </div>
        </div>
        <div className="cell rank-cell">
          <span className="rank-tier">{tier}</span>{" "}
          <span className="rank-num">{rankNum}</span>
          {game.rank_change === "up" && (
            <span className="arrow-up">&#9650;</span>
          )}
          {game.rank_change === "down" && (
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
                <Tooltip
                  key={i}
                  type="relic"
                  name={r}
                  relicsData={relicsData}
                >
                  <img
                    className="relic-icon"
                    src={`icons://relics/${relicStem(r)}.png`}
                    alt={r}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </Tooltip>
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
        </div>
      </div>

      {(lineup.length > 0 || syns.length > 0 || relics.length > 0) && (
        <div className="detail-row">
          {lineup.length > 0 && (
            <div className="lineup">
              {lineup.map((u, i) => {
                const cost = unitCosts[u.name] || 1;
                return (
                  <Tooltip
                    key={i}
                    type="unit"
                    name={u.name}
                    stars={u.stars}
                    unitCosts={unitCosts}
                    unitsFull={unitsFull}
                  >
                    <div className="unit-icon-wrap">
                      <img
                        className="unit-icon"
                        src={`icons://units/${unitStem(u.name)}.png`}
                        alt={u.name}
                        loading="lazy"
                        style={{ borderColor: costBorderColor(cost) }}
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
                  </Tooltip>
                );
              })}
            </div>
          )}

          {(syns.length > 0 || relics.length > 0) && (
            <div className="detail-right">
              {syns.length > 0 && (
                <div className="synergies">
                  {syns.map((s, i) => (
                    <Tooltip
                      key={i}
                      type="synergy"
                      name={s.name}
                      count={s.count}
                      synergiesData={synergiesData}
                    >
                      <div className="syn-badge">
                        <img
                          className="syn-icon"
                          src={`icons://synergies/${synIconName(s.name)}.png`}
                          alt={s.name}
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                        <span className="syn-count">{s.count}</span>
                      </div>
                    </Tooltip>
                  ))}
                </div>
              )}

              {relics.length > 0 && (
                <div className="detail-relics">
                  {relics.map((r, i) => (
                    <Tooltip
                      key={i}
                      type="relic"
                      name={r}
                      relicsData={relicsData}
                    >
                      <img
                        className="detail-relic-icon"
                        src={`icons://relics/${relicStem(r)}.png`}
                        alt={r}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
