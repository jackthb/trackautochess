-- Collapse duplicate match rows created by repeated fallback finalization.
--
-- A fallback upload used to salt match_id with the upload time, so retrying the
-- same post-game snapshot could create several `matches` rows with identical
-- players/results. Keep the best representative in each duplicate group and
-- delete the rest; match_players cascade via the existing FK.

BEGIN;

WITH match_signatures AS (
    SELECT
        m.match_id,
        m.played_at,
        m.capture_status,
        COUNT(mp.id) AS row_count,
        MAX(mp.id) AS latest_player_row_id,
        CONCAT_WS(
            '::',
            FLOOR(EXTRACT(EPOCH FROM m.played_at) / 5400)::bigint,
            STRING_AGG(
                CONCAT(mp.steam_id::text, ':', COALESCE(mp.placement::text, '?')),
                '|'
                ORDER BY mp.steam_id, mp.placement NULLS LAST
            )
        ) AS duplicate_key
    FROM matches m
    JOIN match_players mp ON mp.match_id = m.match_id
    GROUP BY m.match_id, m.played_at, m.capture_status
),
ranked_matches AS (
    SELECT
        match_id,
        duplicate_key,
        ROW_NUMBER() OVER (
            PARTITION BY duplicate_key
            ORDER BY
                CASE capture_status
                    WHEN 'complete' THEN 3
                    WHEN 'partial' THEN 2
                    ELSE 1
                END DESC,
                row_count DESC,
                latest_player_row_id DESC,
                played_at DESC,
                match_id DESC
        ) AS duplicate_rank
    FROM match_signatures
),
duplicate_matches AS (
    SELECT
        loser.match_id AS duplicate_match_id,
        keeper.match_id AS keeper_match_id,
        loser.duplicate_key,
        loser.duplicate_rank
    FROM ranked_matches loser
    JOIN ranked_matches keeper
      ON keeper.duplicate_key = loser.duplicate_key
     AND keeper.duplicate_rank = 1
    WHERE loser.duplicate_rank > 1
),
keeper_timelines AS (
    SELECT mt.match_id
    FROM match_timelines mt
    JOIN duplicate_matches dm ON dm.keeper_match_id = mt.match_id
),
delete_conflicting_timelines AS (
    DELETE FROM match_timelines mt
    USING duplicate_matches dm, keeper_timelines kt
    WHERE mt.match_id = dm.duplicate_match_id
      AND kt.match_id = dm.keeper_match_id
    RETURNING mt.match_id
),
timeline_candidates AS (
    SELECT
        mt.match_id AS duplicate_match_id,
        dm.keeper_match_id,
        ROW_NUMBER() OVER (
            PARTITION BY dm.duplicate_key
            ORDER BY dm.duplicate_rank
        ) AS timeline_rank
    FROM match_timelines mt
    JOIN duplicate_matches dm ON dm.duplicate_match_id = mt.match_id
    WHERE NOT EXISTS (
        SELECT 1
        FROM match_timelines existing
        WHERE existing.match_id = dm.keeper_match_id
    )
),
move_timelines AS (
    UPDATE match_timelines mt
    SET match_id = tc.keeper_match_id
    FROM timeline_candidates tc
    WHERE mt.match_id = tc.duplicate_match_id
      AND tc.timeline_rank = 1
    RETURNING mt.match_id
),
delete_unmoved_timelines AS (
    DELETE FROM match_timelines mt
    USING duplicate_matches dm
    WHERE mt.match_id = dm.duplicate_match_id
    RETURNING mt.match_id
)
DELETE FROM matches m
USING duplicate_matches dm
WHERE m.match_id = dm.duplicate_match_id;

COMMIT;
