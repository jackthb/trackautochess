-- Ensure the denormalized Drodo queen rank column exists on the live database.
--
-- 20260613173000_add_users_drodo_queen_rank.sql introduced users.drodo_queen_rank
-- (and dropped the unused queen_ladder_mmr), but it was never applied to the
-- connected project, so the /queens page 400s on the missing column. This
-- migration re-applies the same end state idempotently so the Supabase
-- integration picks it up and the schema matches the deployed code.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS drodo_queen_rank int;

UPDATE users
SET drodo_queen_rank = NULLIF(drodo_raw_data->>'queen_rank', '')::int
WHERE drodo_queen_rank IS NULL
  AND drodo_raw_data ? 'queen_rank'
  AND NULLIF(drodo_raw_data->>'queen_rank', '') ~ '^[0-9]+$';

CREATE INDEX IF NOT EXISTS users_drodo_queen_rank_idx
    ON users (drodo_queen_rank)
    WHERE drodo_queen_rank IS NOT NULL;

DROP INDEX IF EXISTS users_queen_ladder_idx;

CREATE INDEX IF NOT EXISTS users_queen_ladder_idx
    ON users (queen_ladder_rank ASC NULLS LAST)
    WHERE queen_ladder_last_seen_at IS NOT NULL;

ALTER TABLE users
    DROP COLUMN IF EXISTS queen_ladder_mmr;
