CREATE TABLE IF NOT EXISTS mmr_snapshots (
    id             bigserial PRIMARY KEY,
    steam_id       bigint NOT NULL,
    -- Derived hot-path columns: cheap to query without unpacking `raw` on every read.
    mmr            int,
    season         text,
    -- Full Drodo response, kept so future metrics can be added without a backfill.
    raw            jsonb NOT NULL,
    snapshotted_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS mmr_snapshots_steam_id_time_idx
    ON mmr_snapshots (steam_id, snapshotted_at DESC);

ALTER TABLE mmr_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select ON mmr_snapshots FOR SELECT TO anon USING (true);
