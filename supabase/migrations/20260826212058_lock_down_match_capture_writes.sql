-- Final cutover after the Edge Function client has been deployed and
-- smoke-tested. Public/authenticated reads remain unchanged.

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON public.matches
    FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.match_players
    FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.match_timelines
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_players TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_timelines TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.match_players_id_seq TO service_role;

DROP POLICY IF EXISTS matches_insert ON public.matches;
DROP POLICY IF EXISTS matches_update ON public.matches;
DROP POLICY IF EXISTS matches_authenticated_insert ON public.matches;
DROP POLICY IF EXISTS matches_authenticated_update ON public.matches;

DROP POLICY IF EXISTS match_players_insert ON public.match_players;
DROP POLICY IF EXISTS match_players_update ON public.match_players;
DROP POLICY IF EXISTS match_players_authenticated_insert ON public.match_players;
DROP POLICY IF EXISTS match_players_authenticated_update ON public.match_players;

DROP POLICY IF EXISTS anon_insert ON public.match_timelines;
DROP POLICY IF EXISTS anon_update ON public.match_timelines;
DROP POLICY IF EXISTS match_timelines_authenticated_insert ON public.match_timelines;
DROP POLICY IF EXISTS match_timelines_authenticated_update ON public.match_timelines;

COMMIT;
