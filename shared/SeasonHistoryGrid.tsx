export interface SeasonSnapshot {
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
}

export function SeasonHistoryGrid({ seasons }: { seasons: SeasonSnapshot[] }) {
  if (seasons.length <= 1) return null;
  return (
    <>
      <div className="section-title">Season History</div>
      <div className="seasons-grid">
        {[...seasons].reverse().map((season) => (
          <div key={season.season} className="season-card">
            <div className="season-label">{season.season.toUpperCase()}</div>
            {season.mmr != null ? (
              <div className="season-mmr">{season.mmr}</div>
            ) : (
              <div className="season-mmr dim">-</div>
            )}
            {season.max_mmr != null && (
              <div className="season-meta">
                Peak <span className="season-peak">{season.max_mmr}</span>
              </div>
            )}
            {season.games_played != null && (
              <div className="season-meta">{season.games_played} games</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
