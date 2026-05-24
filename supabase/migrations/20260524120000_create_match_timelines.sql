-- Per-match round-by-round snapshot, built by nettable_capture's
-- _extract_match_timeline. Mirrors the local
-- ~/.dac/match_timelines/<match_id>.json file: an ordered list of round
-- snapshots, each containing players' lineup/HP/level/synergies at that
-- round. Drives the round scrubber on the web viewer.
--
-- One row per match. match_id can reference either the live-capture
-- 16-char hex id or the CV-path 12-char uuid prefix — both are stored in
-- games.match_id. No FK because the matches table only holds live-capture
-- ids (CV matches don't get a matches row).

BEGIN;

CREATE TABLE IF NOT EXISTS match_timelines (
    match_id     text        PRIMARY KEY,
    timeline     jsonb       NOT NULL,
    round_count  smallint    NOT NULL,
    first_round  smallint    NOT NULL,
    last_round   smallint    NOT NULL,
    captured_at  timestamptz NOT NULL DEFAULT now()
);

-- Anon can read; writes require the service-role key (no INSERT/UPDATE
-- policy is granted). Mirrors dac_nettable_dumps.
ALTER TABLE match_timelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_select ON match_timelines FOR SELECT TO anon USING (true);

COMMIT;
