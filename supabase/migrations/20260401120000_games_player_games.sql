-- Restructure: games → matches, player results → player_games
-- A "game" is the match itself. A "player_game" is one player's result in that match.

BEGIN;

-- 1. Rename old table out of the way
ALTER TABLE games RENAME TO games_old;

-- 2. Create new games table (the match)
CREATE TABLE games (
    id          bigserial PRIMARY KEY,
    played_at   timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. Create player_games table (one player's result in a match)
CREATE TABLE player_games (
    id          bigserial PRIMARY KEY,
    game_id     bigint NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id     bigint NOT NULL REFERENCES users(steam_id),
    placement   smallint NOT NULL CHECK (placement BETWEEN 1 AND 8),
    rank        text,
    rank_change text CHECK (rank_change IN ('up', 'down', 'none')),
    lineup      text,
    synergies   text,
    talents     text,
    relic       text,
    level       smallint,
    wins        smallint,
    losses      smallint,
    screenshot  text,
    replay      text,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. Migrate existing data: one game per old row (1:1)
INSERT INTO games (id, played_at, created_at)
SELECT
    id,
    COALESCE(
        played_at::timestamptz,
        date::timestamptz,
        created_at
    ),
    COALESCE(created_at, now())
FROM games_old;

-- Advance the sequence past existing IDs
SELECT setval('games_id_seq', COALESCE((SELECT MAX(id) FROM games), 0));

INSERT INTO player_games (game_id, user_id, placement, rank, rank_change, lineup, synergies, talents, relic, level, wins, losses, screenshot, replay, notes, created_at)
SELECT
    id,
    user_id,
    COALESCE(placement::smallint, 0),
    rank,
    rank_change,
    lineup,
    synergies,
    talents,
    relic,
    CASE WHEN level ~ '^\d+$' THEN level::smallint ELSE NULL END,
    CASE WHEN wl ~ '^\d+-\d+$' THEN split_part(wl, '-', 1)::smallint ELSE NULL END,
    CASE WHEN wl ~ '^\d+-\d+$' THEN split_part(wl, '-', 2)::smallint ELSE NULL END,
    screenshot,
    replay,
    notes,
    COALESCE(created_at, now())
FROM games_old
WHERE user_id IS NOT NULL;

-- 5. Indexes
CREATE INDEX idx_player_games_game_id ON player_games(game_id);
CREATE INDEX idx_player_games_user_id ON player_games(user_id);
CREATE INDEX idx_player_games_user_played ON player_games(user_id, created_at DESC);
CREATE INDEX idx_games_played_at ON games(played_at DESC);

-- 6. Drop old table
DROP TABLE games_old;

-- 7. Create screenshots storage bucket (run via Supabase dashboard or API, not SQL)
-- Included as a comment for reference:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('screenshots', 'screenshots', true);

COMMIT;
