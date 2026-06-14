DROP INDEX IF EXISTS users_drodo_queen_rank_idx;

ALTER TABLE users
    DROP COLUMN IF EXISTS drodo_queen_rank;
