-- Add replay column to games table for linking replay video filenames
ALTER TABLE games ADD COLUMN IF NOT EXISTS replay text;
