ALTER TABLE mmr_snapshots
    ADD COLUMN IF NOT EXISTS queen_rank int;

ALTER TABLE mmr_snapshots
    DROP CONSTRAINT IF EXISTS mmr_snapshots_observation_uniq;

ALTER TABLE mmr_snapshots
    ADD CONSTRAINT mmr_snapshots_observation_uniq
    UNIQUE NULLS NOT DISTINCT (steam_id, season, mmr, chicken_count, queen_rank);
