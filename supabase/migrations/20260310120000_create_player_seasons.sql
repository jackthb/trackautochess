-- Create player_seasons table for per-season MMR snapshots
CREATE TABLE IF NOT EXISTS player_seasons (
    steam_id     bigint NOT NULL REFERENCES users(steam_id),
    season       text NOT NULL,
    mmr          integer,
    max_mmr      integer,
    games_played integer,
    fetched_at   timestamptz DEFAULT now(),
    PRIMARY KEY (steam_id, season)
);

ALTER TABLE player_seasons ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'player_seasons' AND policyname = 'anon_select'
    ) THEN
        CREATE POLICY anon_select ON player_seasons FOR SELECT TO anon USING (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'player_seasons' AND policyname = 'anon_insert'
    ) THEN
        CREATE POLICY anon_insert ON player_seasons FOR INSERT TO anon WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'player_seasons' AND policyname = 'anon_update'
    ) THEN
        CREATE POLICY anon_update ON player_seasons FOR UPDATE TO anon USING (true);
    END IF;
END $$;
