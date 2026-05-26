-- Drop the games table. All reads/writes now use match_players.
-- Data is preserved in Supabase point-in-time backups if needed.

DROP INDEX IF EXISTS idx_games_live_dedup;
DROP TABLE IF EXISTS games;
