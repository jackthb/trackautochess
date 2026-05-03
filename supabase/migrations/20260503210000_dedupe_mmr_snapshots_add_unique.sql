-- Collapse same-MMR/season/chicken-count snapshots into a single row whose
-- snapshotted_at tracks the latest observation, then enforce that invariant
-- via a unique constraint so the cron-driven upsert can rely on it.

WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY steam_id, season, mmr, chicken_count
               ORDER BY snapshotted_at DESC, id DESC
           ) AS rn
    FROM mmr_snapshots
)
DELETE FROM mmr_snapshots m
USING ranked r
WHERE m.id = r.id AND r.rn > 1;

-- NULLS NOT DISTINCT so rows with NULL mmr (Drodo profile-missing case) also
-- collapse instead of accumulating one duplicate per poll.
ALTER TABLE mmr_snapshots
    ADD CONSTRAINT mmr_snapshots_observation_uniq
    UNIQUE NULLS NOT DISTINCT (steam_id, season, mmr, chicken_count);
