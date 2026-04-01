-- Create drodo_profiles table (previously created ad-hoc via API)
CREATE TABLE IF NOT EXISTS drodo_profiles (
    steam_id      bigint PRIMARY KEY REFERENCES users(steam_id),
    mmr           integer,
    max_mmr       integer,
    mmr_level     integer,
    season        text,
    season_games  integer,
    chicken_count integer NOT NULL DEFAULT 0,
    raw_data      jsonb,
    fetched_at    timestamptz NOT NULL DEFAULT now()
);
