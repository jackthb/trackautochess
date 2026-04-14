-- Add match_id column to link all players' rows from the same match.
ALTER TABLE games ADD COLUMN IF NOT EXISTS match_id text;

CREATE INDEX IF NOT EXISTS idx_games_match_id ON games (match_id)
  WHERE match_id IS NOT NULL;
