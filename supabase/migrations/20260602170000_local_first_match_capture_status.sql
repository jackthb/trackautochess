-- Local-first capture model:
--   * raw CustomNetTable dumps stay on-device by default;
--   * Supabase stores the processed match representation plus provenance;
--   * raw dump table is no longer public debug surface.

BEGIN;

ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS capture_status text NOT NULL DEFAULT 'complete',
    ADD COLUMN IF NOT EXISTS is_finished boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS verification_source text NOT NULL DEFAULT 'end_board',
    ADD COLUMN IF NOT EXISTS verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS capture_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS capture_ended_at timestamptz,
    ADD COLUMN IF NOT EXISTS observer_steam_id bigint REFERENCES users(steam_id);

UPDATE matches
SET capture_status = COALESCE(capture_status, 'complete'),
    is_finished = COALESCE(is_finished, true),
    verification_source = COALESCE(verification_source, 'end_board'),
    verified_at = COALESCE(verified_at, played_at),
    capture_ended_at = COALESCE(capture_ended_at, played_at)
WHERE capture_status IS NULL
   OR verification_source IS NULL
   OR verified_at IS NULL
   OR capture_ended_at IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'matches_capture_status_check'
    ) THEN
        ALTER TABLE matches
            ADD CONSTRAINT matches_capture_status_check
            CHECK (capture_status IN (
                'complete',
                'partial',
                'player_eliminated',
                'abandoned',
                'timeout',
                'unknown'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS matches_capture_status_played_at_idx
    ON matches (capture_status, played_at DESC);

CREATE INDEX IF NOT EXISTS matches_is_finished_played_at_idx
    ON matches (is_finished, played_at DESC);

-- Raw dumps are debug/reprocessing material and should not be exposed through
-- the public anon API now that the app uploads processed match data instead.
DROP POLICY IF EXISTS anon_select ON dac_nettable_dumps;

COMMIT;
