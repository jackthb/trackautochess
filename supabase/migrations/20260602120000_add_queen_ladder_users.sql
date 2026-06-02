-- Cache the in-game Queen ladder discovered by the desktop NetTable capture.
-- Full Drodo profile polling still writes the drodo_* columns; these fields
-- let the site expose the Queen leaderboard immediately after the tracker sees
-- CustomNetTable_ranking_top_table.ranking_top.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS queen_ladder_rank integer,
  ADD COLUMN IF NOT EXISTS queen_ladder_mmr integer,
  ADD COLUMN IF NOT EXISTS queen_ladder_season text,
  ADD COLUMN IF NOT EXISTS queen_ladder_last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS users_queen_ladder_rank_idx
  ON users (queen_ladder_rank ASC NULLS LAST, queen_ladder_mmr DESC NULLS LAST)
  WHERE queen_ladder_last_seen_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_queen_ladder_seen_idx
  ON users (queen_ladder_last_seen_at DESC)
  WHERE queen_ladder_last_seen_at IS NOT NULL;
