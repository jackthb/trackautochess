-- Desktop capture authenticates as PostgREST `authenticated`. Earlier grant
-- migrations were never applied on the linked project; this idempotent repair
-- unblocks match uploads without depending on later chatbot migrations.

BEGIN;

ALTER TABLE public.player_seasons
    ADD COLUMN IF NOT EXISTS queen_rank int,
    ADD COLUMN IF NOT EXISTS peak_queen_rank int;

CREATE OR REPLACE FUNCTION public.sync_player_season_queen_ranks(p_steam_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.sync_player_season_queen_ranks(bigint)
    TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.player_seasons TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.matches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.match_players TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.match_timelines TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lineup_snapshots TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

DROP POLICY IF EXISTS users_authenticated_insert ON public.users;
CREATE POLICY users_authenticated_insert ON public.users
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS users_authenticated_update ON public.users;
CREATE POLICY users_authenticated_update ON public.users
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS player_seasons_authenticated_insert ON public.player_seasons;
CREATE POLICY player_seasons_authenticated_insert ON public.player_seasons
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS player_seasons_authenticated_update ON public.player_seasons;
CREATE POLICY player_seasons_authenticated_update ON public.player_seasons
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS matches_authenticated_insert ON public.matches;
CREATE POLICY matches_authenticated_insert ON public.matches
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS matches_authenticated_update ON public.matches;
CREATE POLICY matches_authenticated_update ON public.matches
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS match_players_authenticated_insert ON public.match_players;
CREATE POLICY match_players_authenticated_insert ON public.match_players
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS match_players_authenticated_update ON public.match_players;
CREATE POLICY match_players_authenticated_update ON public.match_players
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS match_timelines_authenticated_insert ON public.match_timelines;
CREATE POLICY match_timelines_authenticated_insert ON public.match_timelines
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS match_timelines_authenticated_update ON public.match_timelines;
CREATE POLICY match_timelines_authenticated_update ON public.match_timelines
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS lineup_snapshots_authenticated_insert ON public.lineup_snapshots;
CREATE POLICY lineup_snapshots_authenticated_insert ON public.lineup_snapshots
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS lineup_snapshots_authenticated_update ON public.lineup_snapshots;
CREATE POLICY lineup_snapshots_authenticated_update ON public.lineup_snapshots
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

COMMIT;
