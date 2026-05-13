-- Speed up public profile pages and search endpoints used by the web app.
-- These paths feed Vercel Speed Insights' busiest routes: /, /players/[steamId],
-- and player search/autocomplete.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS users_public_default_search_idx
  ON users (drodo_last_fetched_at DESC NULLS LAST, name ASC)
  WHERE banned = false;

CREATE INDEX IF NOT EXISTS users_public_custom_url_idx
  ON users (custom_url)
  WHERE custom_url IS NOT NULL AND banned = false;

CREATE INDEX IF NOT EXISTS users_public_custom_url_trgm_idx
  ON users USING gin (custom_url gin_trgm_ops)
  WHERE custom_url IS NOT NULL AND banned = false;

CREATE INDEX IF NOT EXISTS users_public_name_trgm_idx
  ON users USING gin (name gin_trgm_ops)
  WHERE name IS NOT NULL AND banned = false;

CREATE INDEX IF NOT EXISTS users_public_ranked_mmr_idx
  ON users (drodo_mmr DESC)
  WHERE banned = false
    AND drodo_last_fetched_at IS NOT NULL
    AND drodo_profile_missing = false
    AND drodo_mmr IS NOT NULL;

CREATE INDEX IF NOT EXISTS games_user_played_at_idx
  ON games (user_id, played_at DESC)
  WHERE user_id IS NOT NULL;
