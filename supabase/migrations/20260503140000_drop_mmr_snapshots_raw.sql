-- The raw Drodo payload on mmr_snapshots was kept "in case future metrics
-- need it without a backfill". In practice the only thing the sparkline
-- and any downstream use cares about is the mmr value at a point in time;
-- raw doesn't help with mapping. Drop it to stop bloating the table.
ALTER TABLE mmr_snapshots DROP COLUMN IF EXISTS raw;
