-- Authenticated capture sessions use PostgREST upserts (resolution=merge-duplicates).
-- UPDATE/upsert paths require the role to see existing rows under RLS, not just
-- INSERT/UPDATE policies. Without SELECT policies, timeline writes fail with
-- "new row violates row-level security policy" once a row already exists.

BEGIN;

DROP POLICY IF EXISTS users_authenticated_select ON public.users;
CREATE POLICY users_authenticated_select ON public.users
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS player_seasons_authenticated_select ON public.player_seasons;
CREATE POLICY player_seasons_authenticated_select ON public.player_seasons
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS matches_authenticated_select ON public.matches;
CREATE POLICY matches_authenticated_select ON public.matches
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS match_players_authenticated_select ON public.match_players;
CREATE POLICY match_players_authenticated_select ON public.match_players
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS match_timelines_authenticated_select ON public.match_timelines;
CREATE POLICY match_timelines_authenticated_select ON public.match_timelines
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS lineup_snapshots_authenticated_select ON public.lineup_snapshots;
CREATE POLICY lineup_snapshots_authenticated_select ON public.lineup_snapshots
    FOR SELECT TO authenticated
    USING (true);

COMMIT;
