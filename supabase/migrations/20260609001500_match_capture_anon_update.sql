-- Allow the public desktop capture key to repair/upsert match rows after the
-- first insert. The capture client uses PostgREST upsert semantics for live
-- match data, and without UPDATE policies existing thin rows cannot be filled
-- in with richer end_board fields.

BEGIN;

DROP POLICY IF EXISTS matches_update ON matches;
CREATE POLICY matches_update
    ON matches
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS match_players_update ON match_players;
CREATE POLICY match_players_update
    ON match_players
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

COMMIT;
