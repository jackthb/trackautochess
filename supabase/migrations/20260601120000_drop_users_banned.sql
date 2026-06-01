-- Remove the user-banning feature entirely.
--
-- The `banned` column (added in 20260510120000) is dropped. Several partial
-- indexes from 20260513120000 were defined with `WHERE banned = false`; that
-- predicate can't reference a dropped column, so we drop and recreate those
-- indexes without it. The remaining columns/predicates are unchanged.
--
-- Also drops the abandoned `banned_ips` table where it exists (it was created
-- on the PR's Supabase preview branch by 20260528130000 before that migration
-- was reverted to a no-op). IF EXISTS keeps this harmless on databases that
-- never created it, such as production.

DROP TABLE IF EXISTS banned_ips;

-- The trigram GIN indexes recreated below use gin_trgm_ops, which comes from
-- pg_trgm. 20260513120000 installs it, but don't assume that migration has run
-- (preview branches diverge / extensions can be dropped) — guard it here too so
-- this migration is self-contained. IF NOT EXISTS makes it a no-op when present.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop the partial indexes that referenced banned, then the column.
DROP INDEX IF EXISTS users_public_default_search_idx;
DROP INDEX IF EXISTS users_public_custom_url_idx;
DROP INDEX IF EXISTS users_public_custom_url_trgm_idx;
DROP INDEX IF EXISTS users_public_name_trgm_idx;
DROP INDEX IF EXISTS users_public_ranked_mmr_idx;

DROP INDEX IF EXISTS users_banned_idx;

ALTER TABLE users
  DROP COLUMN IF EXISTS banned;

-- Recreate the public-facing indexes without the banned predicate.
CREATE INDEX IF NOT EXISTS users_public_default_search_idx
  ON users (drodo_last_fetched_at DESC NULLS LAST, name ASC);

CREATE INDEX IF NOT EXISTS users_public_custom_url_idx
  ON users (custom_url)
  WHERE custom_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_public_custom_url_trgm_idx
  ON users USING gin (custom_url gin_trgm_ops)
  WHERE custom_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_public_name_trgm_idx
  ON users USING gin (name gin_trgm_ops)
  WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_public_ranked_mmr_idx
  ON users (drodo_mmr DESC)
  WHERE drodo_last_fetched_at IS NOT NULL
    AND drodo_profile_missing = false
    AND drodo_mmr IS NOT NULL;
