-- Revert the games/player_games split from 20260401120000_games_player_games.sql.
--
-- That migration was never applied to production. The database uses a single
-- flat "games" table with all player result columns (placement, rank, lineup,
-- etc.) rather than a separate player_games join table.
--
-- This migration is a no-op if the split was never applied (the normal case).
-- If it was applied, it merges player_games back into games.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'player_games'
    ) THEN
        ALTER TABLE games
            ADD COLUMN IF NOT EXISTS user_id bigint,
            ADD COLUMN IF NOT EXISTS placement text,
            ADD COLUMN IF NOT EXISTS rank text,
            ADD COLUMN IF NOT EXISTS rank_change text,
            ADD COLUMN IF NOT EXISTS lineup text,
            ADD COLUMN IF NOT EXISTS synergies text,
            ADD COLUMN IF NOT EXISTS talents text,
            ADD COLUMN IF NOT EXISTS relic text,
            ADD COLUMN IF NOT EXISTS level text,
            ADD COLUMN IF NOT EXISTS wl text,
            ADD COLUMN IF NOT EXISTS wins smallint,
            ADD COLUMN IF NOT EXISTS losses smallint,
            ADD COLUMN IF NOT EXISTS screenshot text,
            ADD COLUMN IF NOT EXISTS replay text,
            ADD COLUMN IF NOT EXISTS notes text;

        UPDATE games g SET
            user_id = pg.user_id,
            placement = pg.placement::text,
            rank = pg.rank,
            rank_change = pg.rank_change,
            lineup = pg.lineup,
            synergies = pg.synergies,
            talents = pg.talents,
            relic = pg.relic,
            level = pg.level::text,
            screenshot = pg.screenshot,
            replay = pg.replay,
            notes = pg.notes
        FROM player_games pg
        WHERE pg.game_id = g.id;

        DROP TABLE player_games;
    END IF;
END $$;
