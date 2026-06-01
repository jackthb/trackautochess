-- Fix: match_timelines was created with anon SELECT only ("writes require the
-- service-role key"). The desktop app ships with only the publishable (anon)
-- key, so nettable_capture.make_service_role_client() falls back to it and the
-- timeline UPSERT was rejected with 401 — every match since the key migration
-- lost its timeline while matches/match_players (which already grant anon
-- INSERT) kept saving fine.
--
-- Grant anon the same write access its sibling tables (matches, match_players,
-- dac_nettable_dumps) already have. The UPSERT uses resolution=merge-duplicates,
-- which needs INSERT + UPDATE; anon_select already covers SELECT. Timeline data
-- is no more sensitive than the matches rows that are already anon-writable.
--
-- Idempotent (DROP ... IF EXISTS) so it is safe to re-run.

BEGIN;

DROP POLICY IF EXISTS anon_insert ON match_timelines;
CREATE POLICY anon_insert ON match_timelines FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS anon_update ON match_timelines;
CREATE POLICY anon_update ON match_timelines FOR UPDATE TO anon USING (true) WITH CHECK (true);

COMMIT;
