import { mmrToRank } from "./game-utils";

export interface SeasonSnapshot {
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
  chicken_count?: number | null;
  queen_rank?: number | null;
  peak_queen_rank?: number | null;
}

export function SeasonHistoryGrid({
  seasons,
  showTitle = true,
}: {
  seasons: SeasonSnapshot[];
  showTitle?: boolean;
}) {
  if (seasons.length <= 1) return null;
  return (
    <>
      {showTitle && <div className="section-title">Season History</div>}
      <div className="seasons-grid">
        {[...seasons].reverse().map((season) => {
          const showPeakQueen =
            season.peak_queen_rank != null &&
            season.peak_queen_rank !== season.queen_rank;
          const showPeakMmr =
            season.max_mmr != null && season.max_mmr !== season.mmr;
          const peakParts: string[] = [];
          if (showPeakQueen) peakParts.push(`Queen #${season.peak_queen_rank}`);
          if (showPeakMmr) peakParts.push(String(season.max_mmr));

          return (
          <div key={season.season} className="season-card">
            <div className="season-label">{season.season.toUpperCase()}</div>
            {season.mmr != null ? (
              <>
                <div className="season-mmr">{season.mmr}</div>
                <div className="season-meta season-rank">
                  {season.queen_rank != null
                    ? `Queen #${season.queen_rank}`
                    : mmrToRank(season.mmr) || "Unranked"}
                </div>
              </>
            ) : season.queen_rank != null ? (
              <>
                <div className="season-mmr">Queen #{season.queen_rank}</div>
                <div className="season-meta season-rank">Final rank</div>
              </>
            ) : (
              <div className="season-mmr dim">-</div>
            )}
            {peakParts.length > 0 && (
              <div className="season-meta">
                Peak{" "}
                {peakParts.map((part, index) => (
                  <span key={part}>
                    {index > 0 && " · "}
                    <span className="season-peak">{part}</span>
                  </span>
                ))}
              </div>
            )}
            {season.games_played != null && (
              <div className="season-meta">{season.games_played} games</div>
            )}
            {season.chicken_count != null && season.chicken_count > 0 && (
              <div className="season-meta">{season.chicken_count} wins</div>
            )}
          </div>
          );
        })}
      </div>
    </>
  );
}
