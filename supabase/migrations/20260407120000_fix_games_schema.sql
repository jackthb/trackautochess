-- Fix games table schema to match actual production state.
--
-- The previous migration (20260401120000_games_player_games) was never applied.
-- It proposed splitting games into games + player_games, but the DB still has
-- the original flat games table. This migration documents the columns that were
-- added/changed outside of migrations and brings the migration history in sync.
--
-- Changes already applied to production (captured here for history):
--   1. games.date (text) was dropped
--   2. games.played_at (timestamptz) was added
--   3. games.screenshot (text) was added
--
-- This migration is idempotent — safe to run against the current production DB.

ALTER TABLE games ADD COLUMN IF NOT EXISTS played_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS screenshot text;
ALTER TABLE games DROP COLUMN IF EXISTS date;
