-- Merge the one-row Drodo cache into users.
-- player_seasons remains separate because it is one row per user per season.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_mmr integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_max_mmr integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_mmr_level integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_season text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_season_games integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_candy integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_chicken_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_raw_data jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_last_fetched_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drodo_profile_missing boolean NOT NULL DEFAULT false;

UPDATE users u
SET
    drodo_mmr = d.mmr,
    drodo_max_mmr = d.max_mmr,
    drodo_mmr_level = d.mmr_level,
    drodo_season = d.season,
    drodo_season_games = d.season_games,
    drodo_candy = d.candy,
    drodo_chicken_count = COALESCE(d.chicken_count, 0),
    drodo_raw_data = d.raw_data,
    drodo_last_fetched_at = d.fetched_at,
    drodo_profile_missing = false
FROM drodo_profiles d
WHERE u.steam_id = d.steam_id;

DROP POLICY IF EXISTS drodo_profiles_select ON drodo_profiles;
DROP TABLE IF EXISTS drodo_profiles;

COMMIT;
