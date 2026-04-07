-- Fix RLS policies to match actual schema (no player_games table).
--
-- 20260401120002_rls_policies.sql created policies for player_games which
-- doesn't exist. This migration sets up correct policies for the flat games
-- table with authenticated user update/delete.

BEGIN;

DROP POLICY IF EXISTS games_select ON games;
DROP POLICY IF EXISTS games_insert ON games;
DROP POLICY IF EXISTS anon_insert ON games;
DROP POLICY IF EXISTS anon_select ON games;

CREATE POLICY games_select ON games FOR SELECT USING (true);
CREATE POLICY games_insert ON games FOR INSERT WITH CHECK (true);
CREATE POLICY games_update ON games FOR UPDATE TO authenticated
    USING (user_id = (auth.jwt() ->> 'steam_id')::bigint);
CREATE POLICY games_delete ON games FOR DELETE TO authenticated
    USING (user_id = (auth.jwt() ->> 'steam_id')::bigint);

COMMIT;
