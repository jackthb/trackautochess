-- The 2026-07-06 migration (repair_authenticated_capture_access) was meant to
-- add this policy and shows as applied in migration history, but it is not
-- present on the live database. Without it, every authenticated capture
-- session has zero SELECT visibility on match_timelines, so all of its
-- upserts fail RLS at the plan level (INSERT ... ON CONFLICT DO UPDATE
-- requires SELECT visibility on the target table for the executing role,
-- regardless of whether a conflicting row exists) — every match since has
-- uploaded with no timeline/board data. matches/match_players already have a
-- `public`-role SELECT policy that covers this; match_timelines only had
-- anon_select, which does not cover the authenticated role.

BEGIN;

DROP POLICY IF EXISTS match_timelines_authenticated_select ON public.match_timelines;
CREATE POLICY match_timelines_authenticated_select ON public.match_timelines
    FOR SELECT TO authenticated
    USING (true);

COMMIT;
