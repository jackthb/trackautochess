-- Delete dateless matches, then make match_players.played_at NOT NULL.
--
-- match_players was created 2026-05-20, but `played_at` wasn't added to the
-- table (or the backend insert allowlist) until the 2026-05-26 consolidation.
-- Every row written in that window had its played_at stripped → stored as NULL,
-- so those matches render with no date in the player profile / history views.
--
-- played_at is computed once per match and shared across all of that match's
-- player rows, so a NULL is always whole-match: dropping the dateless player
-- rows leaves the match header (and its timeline) orphaned, so we sweep those
-- too. Then enforce NOT NULL so a dateless match can never recur.

BEGIN;

-- 1. Drop the dateless per-player rows.
DELETE FROM match_players WHERE played_at IS NULL;

-- 2. Drop match headers left with no surviving player rows.
DELETE FROM matches m
WHERE NOT EXISTS (
    SELECT 1 FROM match_players mp WHERE mp.match_id = m.match_id
);

-- 3. Drop timelines orphaned by the deletes above (no FK, so manual).
DELETE FROM match_timelines mt
WHERE NOT EXISTS (
    SELECT 1 FROM matches m WHERE m.match_id = mt.match_id
);

-- 4. Enforce the invariant: a game always has a date.
ALTER TABLE match_players
    ALTER COLUMN played_at SET NOT NULL;

-- 5. Cascade match deletes onto player rows so match_players can never be
--    orphaned from its match. (Inline FK was created as match_players_match_id_fkey
--    with the default RESTRICT behaviour.)
ALTER TABLE match_players
    DROP CONSTRAINT match_players_match_id_fkey;
ALTER TABLE match_players
    ADD CONSTRAINT match_players_match_id_fkey
    FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE;

COMMIT;
