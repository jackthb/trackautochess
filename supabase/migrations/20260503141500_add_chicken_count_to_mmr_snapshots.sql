-- Capture wins (chickens) at each snapshot so we can chart chicken
-- progression over time. Drodo only returns one chicken_count value
-- — the count for the active season — so each snapshot row pairs the
-- chicken_count with the season column already on the row.
ALTER TABLE mmr_snapshots ADD COLUMN IF NOT EXISTS chicken_count int;
