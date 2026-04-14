-- Add wins/losses columns to games table.
-- push_game() splits the wl text field (e.g. "21-17") into separate
-- integer columns for easier querying/aggregation.
ALTER TABLE games ADD COLUMN IF NOT EXISTS wins smallint;
ALTER TABLE games ADD COLUMN IF NOT EXISTS losses smallint;
