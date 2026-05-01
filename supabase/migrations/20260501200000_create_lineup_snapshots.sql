CREATE TABLE IF NOT EXISTS lineup_snapshots (
    id          bigserial PRIMARY KEY,
    owner       text NOT NULL,
    round       int NOT NULL,
    result      text NOT NULL,
    population  int NOT NULL,
    chess       text NOT NULL,
    synergy     text,
    talent      text,
    lineup      jsonb NOT NULL,
    courier     text,
    entry_hash  text NOT NULL UNIQUE,
    captured_at timestamptz DEFAULT now()
);

ALTER TABLE lineup_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select ON lineup_snapshots FOR SELECT TO anon USING (true);
