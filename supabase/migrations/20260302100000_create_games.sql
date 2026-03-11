-- Create games table
CREATE TABLE IF NOT EXISTS games (
    id          bigserial PRIMARY KEY,
    date        text,
    placement   text,
    rank        text,
    rank_change text,
    lineup      text,
    synergies   text,
    talents     text,
    relic       text,
    level       text,
    wl          text,
    notes       text,
    created_at  timestamptz DEFAULT now()
);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'games' AND policyname = 'anon_insert'
    ) THEN
        CREATE POLICY anon_insert ON games FOR INSERT TO anon WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'games' AND policyname = 'anon_select'
    ) THEN
        CREATE POLICY anon_select ON games FOR SELECT TO anon USING (true);
    END IF;
END $$;
