-- Add columns from `games` table to `match_players` so match_players becomes
-- the single per-player-per-match table. The `games` table is deprecated.

BEGIN;

ALTER TABLE match_players
    ADD COLUMN IF NOT EXISTS screenshot text,
    ADD COLUMN IF NOT EXISTS notes      text,
    ADD COLUMN IF NOT EXISTS replay     text,
    ADD COLUMN IF NOT EXISTS played_at  timestamptz,
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- played_at index for ordering in player profiles
CREATE INDEX IF NOT EXISTS match_players_played_at_idx
    ON match_players (played_at DESC NULLS LAST);

-- Composite index for player profile queries (steam_id + played_at ordering)
CREATE INDEX IF NOT EXISTS match_players_steam_id_played_at_idx
    ON match_players (steam_id, played_at DESC NULLS LAST);

COMMIT;
