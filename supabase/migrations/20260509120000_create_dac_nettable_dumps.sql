-- Generic landing zone for CustomNetTable values pulled out of Dota's
-- console.log via the panorama hook in tools/dac_dump/. One row per
-- (table_name, key) emit. Until we know what's actually in each table for
-- real, everything stays in `raw` jsonb — model out indexed columns later
-- once the ingest path is proven.
--
-- High-value tables we expect to see (refs into
-- data/vscripts/scripts/vscripts/addon_game_mode.lua):
--   ranking_top_table  / ranking_top                — full queen ladder + leaderboard_info
--   match_history_table/ match_history_<player_id>  — per-lobby-player match history
--   dac_table          / player_info                — _G.stat_info for all 8 (incl. queen_rank)
--   dac_table          / end_board                  — final placement / stats (set at game end)
--   dac_table          / user_panel_ranking         — in-match rank panel data
--   player_id_table    / player_<i>                 — player_id ↔ team_id ↔ hero_index
--   __synth__          / lobby_steam_ids            — synthesized from Players API (32-bit account ids)

CREATE TABLE IF NOT EXISTS dac_nettable_dumps (
    id          bigserial PRIMARY KEY,
    table_name  text NOT NULL,
    key         text NOT NULL,
    raw         jsonb NOT NULL,
    captured_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS dac_nettable_dumps_lookup_idx
    ON dac_nettable_dumps (table_name, key, captured_at DESC);

ALTER TABLE dac_nettable_dumps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'dac_nettable_dumps' AND policyname = 'anon_select'
    ) THEN
        CREATE POLICY anon_select ON dac_nettable_dumps
            FOR SELECT TO anon USING (true);
    END IF;
END $$;
