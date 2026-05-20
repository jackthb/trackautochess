-- Live-capture match storage.
--
-- The CV (Game Over screenshot) path writes per-player rows to `games` with a
-- uuid-shaped `match_id` (12 chars including a hyphen). The live-capture path
-- (nettable end_board extract) writes the same per-player rows to `games` for
-- web-viewer compat AND writes rich match-level + per-player data to the new
-- `matches` / `match_players` tables defined here.
--
-- Live `match_id` is sha256([(steam_id, placement)…])[:16] — 16-char hex, no
-- hyphens. The partial unique index at the bottom dedupes by length=16, so the
-- CV path's uuid match_ids are unaffected.

BEGIN;

-- ── matches ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
    match_id     text        PRIMARY KEY,
    played_at    timestamptz NOT NULL,
    duration     real,
    final_round  smallint,
    player_count smallint
);

CREATE INDEX IF NOT EXISTS matches_played_at_idx ON matches (played_at DESC);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY matches_select ON matches FOR SELECT USING (true);
CREATE POLICY matches_insert ON matches FOR INSERT WITH CHECK (true);

-- ── match_players ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_players (
    id                      bigserial PRIMARY KEY,
    match_id                text      NOT NULL REFERENCES matches(match_id),
    steam_id                bigint    NOT NULL REFERENCES users(steam_id),
    placement               smallint,
    mmr_level               smallint,
    hero_level              smallint,
    chess_lineup            text,
    chess_hand              text,
    synergies               text,
    relic                   text,
    relic_history           jsonb,
    talents                 text,
    win_round               smallint,
    lose_round              smallint,
    draw_round              smallint,
    kills                   smallint,
    deaths                  smallint,
    hero_damage             int,
    hero_damaged            int,
    mvp_chess_name          text,
    mvp_chess_items         text,
    max_lineup_value        int,
    max_lineup_value_lineup text,
    duration                real,
    final_round             smallint,
    zhugong                 text,
    total_money             int,
    candy                   int,
    CONSTRAINT match_players_dedup UNIQUE (match_id, steam_id)
);

CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON match_players (match_id);
CREATE INDEX IF NOT EXISTS match_players_steam_id_idx ON match_players (steam_id);

ALTER TABLE match_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_players_select ON match_players FOR SELECT USING (true);
CREATE POLICY match_players_insert ON match_players FOR INSERT WITH CHECK (true);

-- ── games dedup for live path ────────────────────────────────────────────────
-- Live match_ids are 16 hex chars (no hyphens). CV match_ids are 12 chars
-- (uuid[:12]). length=16 selects live rows only; CV rows are unaffected and
-- continue to allow duplicates as they always have.
DROP INDEX IF EXISTS idx_games_live_dedup;
CREATE UNIQUE INDEX idx_games_live_dedup
    ON games (match_id, user_id)
    WHERE match_id IS NOT NULL AND length(match_id) = 16;

COMMIT;
