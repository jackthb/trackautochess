-- Preserve historical coverage while still deduping accidental repeated writes.
-- The previous uniqueness key collapsed identical observations across all time,
-- which erased "same MMR on a later day" history during imports and polling.

ALTER TABLE mmr_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_date date;

UPDATE mmr_snapshots
SET snapshot_date = (snapshotted_at AT TIME ZONE 'UTC')::date
WHERE snapshot_date IS NULL;

ALTER TABLE mmr_snapshots
  ALTER COLUMN snapshot_date SET NOT NULL,
  ALTER COLUMN snapshot_date SET DEFAULT ((now() AT TIME ZONE 'UTC')::date);

CREATE OR REPLACE FUNCTION public.set_mmr_snapshot_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.snapshot_date := (NEW.snapshotted_at AT TIME ZONE 'UTC')::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_mmr_snapshot_date_before_write ON mmr_snapshots;
CREATE TRIGGER set_mmr_snapshot_date_before_write
  BEFORE INSERT OR UPDATE OF snapshotted_at
  ON mmr_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_mmr_snapshot_date();

ALTER TABLE mmr_snapshots
  DROP CONSTRAINT IF EXISTS mmr_snapshots_observation_uniq;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY steam_id, season, snapshot_date, mmr, chicken_count, queen_rank
      ORDER BY snapshotted_at DESC, id DESC
    ) AS rn
  FROM mmr_snapshots
)
DELETE FROM mmr_snapshots m
USING ranked r
WHERE m.id = r.id
  AND r.rn > 1;

ALTER TABLE mmr_snapshots
  ADD CONSTRAINT mmr_snapshots_daily_observation_uniq
  UNIQUE NULLS NOT DISTINCT (
    steam_id,
    season,
    snapshot_date,
    mmr,
    chicken_count,
    queen_rank
  );

CREATE INDEX IF NOT EXISTS mmr_snapshots_steam_id_snapshot_date_idx
  ON mmr_snapshots (steam_id, snapshot_date DESC, snapshotted_at DESC);

-- Seed a missing first observation for cached Drodo rows. This cannot recreate
-- true historical movement, but it closes gaps where users/player_seasons were
-- populated without an mmr_snapshots row.
INSERT INTO mmr_snapshots (
  steam_id,
  season,
  mmr,
  chicken_count,
  queen_rank,
  snapshotted_at,
  snapshot_date
)
SELECT
  u.steam_id,
  u.drodo_season,
  u.drodo_mmr,
  u.drodo_chicken_count,
  u.queen_ladder_rank,
  u.drodo_last_fetched_at,
  (u.drodo_last_fetched_at AT TIME ZONE 'UTC')::date
FROM users u
WHERE u.drodo_profile_missing = false
  AND u.drodo_last_fetched_at IS NOT NULL
  AND (
    u.drodo_mmr IS NOT NULL
    OR u.drodo_chicken_count IS NOT NULL
    OR u.queen_ladder_rank IS NOT NULL
  )
ON CONFLICT ON CONSTRAINT mmr_snapshots_daily_observation_uniq DO NOTHING;
