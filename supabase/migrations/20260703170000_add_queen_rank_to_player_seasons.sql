ALTER TABLE player_seasons
    ADD COLUMN IF NOT EXISTS queen_rank int,
    ADD COLUMN IF NOT EXISTS peak_queen_rank int;

-- Recompute per-season Queen ladder ranks from captured snapshots.
CREATE OR REPLACE FUNCTION sync_player_season_queen_ranks(p_steam_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    WITH ranked AS (
        SELECT
            season,
            queen_rank,
            MIN(queen_rank) OVER (PARTITION BY season) AS peak_queen_rank,
            ROW_NUMBER() OVER (
                PARTITION BY season
                ORDER BY snapshotted_at DESC, id DESC
            ) AS rn
        FROM mmr_snapshots
        WHERE steam_id = p_steam_id
          AND queen_rank IS NOT NULL
          AND season IS NOT NULL
    ),
    agg AS (
        SELECT season, peak_queen_rank, queen_rank AS final_queen_rank
        FROM ranked
        WHERE rn = 1
    )
    UPDATE player_seasons ps
    SET
        queen_rank = agg.final_queen_rank,
        peak_queen_rank = agg.peak_queen_rank
    FROM agg
    WHERE ps.steam_id = p_steam_id
      AND ps.season = agg.season;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_player_season_queen_ranks(bigint) TO anon, authenticated, service_role;

-- Backfill existing season rows from historical snapshots.
DO $$
DECLARE
    rec record;
BEGIN
    FOR rec IN
        SELECT DISTINCT steam_id
        FROM mmr_snapshots
        WHERE queen_rank IS NOT NULL
          AND season IS NOT NULL
    LOOP
        PERFORM sync_player_season_queen_ranks(rec.steam_id);
    END LOOP;
END;
$$;
