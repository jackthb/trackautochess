-- RLS policies for all tables
-- Access patterns:
--   Desktop app: anon key → inserts games/player_games/users
--   Web browser: authenticated session → reads/edits own data
--   Web API routes: service_role key → bypasses RLS (drodo, auth)

BEGIN;

-- ============================================================
-- games (the match itself — public, lightweight)
-- ============================================================
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

-- Anyone can read matches
CREATE POLICY games_select ON games FOR SELECT USING (true);
-- Desktop app inserts via anon key
CREATE POLICY games_insert ON games FOR INSERT WITH CHECK (true);

-- ============================================================
-- player_games (a player's result in a match)
-- ============================================================
ALTER TABLE player_games ENABLE ROW LEVEL SECURITY;

-- Public read (player profiles are public)
CREATE POLICY player_games_select ON player_games FOR SELECT USING (true);
-- Desktop app inserts via anon key
CREATE POLICY player_games_insert ON player_games FOR INSERT WITH CHECK (true);
-- Authenticated users can update/delete their own rows only
CREATE POLICY player_games_update ON player_games FOR UPDATE TO authenticated
    USING (user_id = (auth.jwt() ->> 'steam_id')::bigint);
CREATE POLICY player_games_delete ON player_games FOR DELETE TO authenticated
    USING (user_id = (auth.jwt() ->> 'steam_id')::bigint);

-- ============================================================
-- users
-- ============================================================
-- (RLS already enabled from earlier migration, drop old policies first)
DROP POLICY IF EXISTS anon_insert ON users;
DROP POLICY IF EXISTS anon_select ON users;

CREATE POLICY users_select ON users FOR SELECT USING (true);
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (true);

-- ============================================================
-- player_seasons (written by service_role, read by everyone)
-- ============================================================
-- (RLS already enabled, drop old policies)
DROP POLICY IF EXISTS anon_select ON player_seasons;
DROP POLICY IF EXISTS anon_insert ON player_seasons;
DROP POLICY IF EXISTS anon_update ON player_seasons;

CREATE POLICY player_seasons_select ON player_seasons FOR SELECT USING (true);
-- service_role bypasses RLS, so no insert/update policy needed

-- ============================================================
-- drodo_profiles (written by service_role, read by everyone)
-- ============================================================
ALTER TABLE drodo_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY drodo_profiles_select ON drodo_profiles FOR SELECT USING (true);
-- service_role bypasses RLS, so no insert/update policy needed

COMMIT;
