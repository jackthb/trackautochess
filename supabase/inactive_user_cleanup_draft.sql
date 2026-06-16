-- Draft only: inactive user cleanup / security review.
--
-- This file is an operator-reviewed artifact, not a migration. Do not run the
-- purge section as-is in production. The review queries are read-only. The
-- destructive section is intentionally commented out and must be copied,
-- reviewed, and wrapped in a transaction by an operator with service_role/admin
-- access.
--
-- Current simple background polling policy:
--   * Visible Queen board: refreshed every 5 minutes.
--   * Active players: signed in with Steam within the active window, currently
--     14 days in shared/drodo-core.mjs, or known Queen ladder players.
--   * Inactive players: tracked users with a cached non-missing Drodo profile
--     who are not active players. Inactive polling is daily and oldest-first by
--     drodo_last_fetched_at.
--
-- Existing SteamID64 database constraints:
--   * users.steam_id, player_seasons.steam_id, match_players.steam_id, and
--     mmr_snapshots.steam_id must be in the public individual SteamID64 range
--     76561197960265728..76561202255233023.
--   * matches.observer_steam_id is either null or in the same range.
--   * These constraints prevent fake/out-of-range IDs but do not prove that the
--     caller owns the Steam account.
--
-- Remaining RLS / policy gaps for user creation:
--   * users_insert is still FOR INSERT WITH CHECK (true), so anon/public clients
--     can create any in-range users.steam_id row.
--   * users_update is FOR UPDATE USING (true) WITH CHECK (true), with no column
--     restriction or ownership check, so anon/public clients can update any
--     users row accepted by table constraints.
--   * The SteamID64 constraints narrow abuse to real-looking public user IDs,
--     but ownership should still be enforced in an authenticated/server-only
--     path before user creation/profile mutation is considered trusted.

-- ---------------------------------------------------------------------------
-- 1. Read-only inactive cohort review.
-- ---------------------------------------------------------------------------
-- Keep these constants aligned with shared/drodo-core.mjs and web/lib/queens.ts.
WITH params AS (
  SELECT
    now() AS as_of,
    interval '14 days' AS active_sign_in_window,
    interval '1 day' AS inactive_poll_interval,
    300 AS queen_candidate_limit,
    100 AS queen_table_limit
),
queen_candidates AS (
  SELECT u.*
  FROM public.users u
  WHERE u.queen_ladder_rank IS NOT NULL
  ORDER BY
    u.queen_ladder_last_seen_at DESC NULLS LAST,
    u.queen_ladder_rank ASC NULLS LAST,
    u.drodo_mmr DESC NULLS LAST
  LIMIT (SELECT queen_candidate_limit FROM params)
),
queen_ranked AS (
  SELECT
    qc.steam_id,
    qc.queen_ladder_rank,
    row_number() OVER (
      PARTITION BY qc.queen_ladder_rank
      ORDER BY
        qc.drodo_last_fetched_at DESC NULLS LAST,
        qc.queen_ladder_last_seen_at DESC NULLS LAST,
        qc.drodo_mmr DESC NULLS LAST,
        qc.steam_id ASC
    ) AS rank_duplicate_order
  FROM queen_candidates qc
  WHERE qc.queen_ladder_rank <= (SELECT queen_table_limit FROM params)
),
visible_queen_board AS (
  SELECT steam_id
  FROM queen_ranked
  WHERE rank_duplicate_order = 1
  ORDER BY queen_ladder_rank ASC
  LIMIT (SELECT queen_table_limit FROM params)
),
classified_users AS (
  SELECT
    u.steam_id,
    u.created_at,
    u.steam_signed_in_at,
    u.drodo_last_fetched_at,
    u.drodo_profile_missing,
    u.queen_ladder_rank,
    u.queen_ladder_last_seen_at,
    (u.steam_signed_in_at >= p.as_of - p.active_sign_in_window) AS is_active_recent,
    (u.queen_ladder_rank IS NOT NULL) AS is_known_queen,
    (vqb.steam_id IS NOT NULL) AS is_visible_queen,
    (
      u.drodo_last_fetched_at IS NOT NULL
      AND u.drodo_profile_missing = false
      AND NOT (u.steam_signed_in_at >= p.as_of - p.active_sign_in_window)
      AND u.queen_ladder_rank IS NULL
    ) AS is_inactive_policy_user,
    (
      u.drodo_last_fetched_at <= p.as_of - p.inactive_poll_interval
    ) AS due_for_daily_inactive_poll
  FROM public.users u
  CROSS JOIN params p
  LEFT JOIN visible_queen_board vqb ON vqb.steam_id = u.steam_id
)
SELECT
  count(*) FILTER (WHERE is_active_recent) AS active_recent_users,
  count(*) FILTER (WHERE is_known_queen) AS known_queen_users,
  count(*) FILTER (WHERE is_visible_queen) AS visible_queen_users,
  count(*) FILTER (WHERE is_inactive_policy_user) AS inactive_policy_users,
  count(*) FILTER (
    WHERE is_inactive_policy_user AND due_for_daily_inactive_poll
  ) AS inactive_due_for_daily_poll,
  min(drodo_last_fetched_at) FILTER (WHERE is_inactive_policy_user) AS oldest_inactive_fetch,
  max(drodo_last_fetched_at) FILTER (WHERE is_inactive_policy_user) AS newest_inactive_fetch
FROM classified_users;

-- Sample the exact rows that would be considered inactive by policy.
WITH params AS (
  SELECT now() AS as_of, interval '14 days' AS active_sign_in_window
),
visible_queen_board AS (
  SELECT steam_id
  FROM (
    SELECT
      u.steam_id,
      u.queen_ladder_rank,
      row_number() OVER (
        PARTITION BY u.queen_ladder_rank
        ORDER BY
          u.drodo_last_fetched_at DESC NULLS LAST,
          u.queen_ladder_last_seen_at DESC NULLS LAST,
          u.drodo_mmr DESC NULLS LAST,
          u.steam_id ASC
      ) AS rank_duplicate_order
    FROM (
      SELECT *
      FROM public.users
      WHERE queen_ladder_rank IS NOT NULL
      ORDER BY
        queen_ladder_last_seen_at DESC NULLS LAST,
        queen_ladder_rank ASC NULLS LAST,
        drodo_mmr DESC NULLS LAST
      LIMIT 300
    ) u
    WHERE u.queen_ladder_rank <= 100
  ) ranked
  WHERE rank_duplicate_order = 1
  ORDER BY queen_ladder_rank ASC
  LIMIT 100
)
SELECT
  u.steam_id,
  u.created_at,
  u.steam_signed_in_at,
  u.drodo_last_fetched_at,
  u.queen_ladder_rank,
  u.queen_ladder_last_seen_at
FROM public.users u
CROSS JOIN params p
LEFT JOIN visible_queen_board vqb ON vqb.steam_id = u.steam_id
WHERE u.drodo_last_fetched_at IS NOT NULL
  AND u.drodo_profile_missing = false
  AND NOT (u.steam_signed_in_at >= p.as_of - p.active_sign_in_window)
  AND u.queen_ladder_rank IS NULL
ORDER BY u.drodo_last_fetched_at ASC NULLS LAST
LIMIT 100;

-- ---------------------------------------------------------------------------
-- 2. Purge candidate staging guidance.
-- ---------------------------------------------------------------------------
-- Inactive-by-policy is not, by itself, a deletion signal. Prefer purging only
-- rows that also satisfy a retention threshold and have no match ownership.
-- This conservative default preserves public match history and only targets
-- stale profile/cache rows. Adjust the retention interval after reviewing the
-- dry-run output.
--
-- Suggested conservative purge eligibility:
--   * is inactive by policy;
--   * drodo_last_fetched_at older than 180 days;
--   * never signed in, or signed in older than 180 days;
--   * no match_players rows;
--   * not referenced as matches.observer_steam_id.

/*
BEGIN;

CREATE TEMP TABLE purge_users_to_review AS
WITH params AS (
  SELECT
    now() AS as_of,
    interval '14 days' AS active_sign_in_window,
    interval '180 days' AS purge_retention
),
visible_queen_board AS (
  SELECT steam_id
  FROM (
    SELECT
      u.steam_id,
      u.queen_ladder_rank,
      row_number() OVER (
        PARTITION BY u.queen_ladder_rank
        ORDER BY
          u.drodo_last_fetched_at DESC NULLS LAST,
          u.queen_ladder_last_seen_at DESC NULLS LAST,
          u.drodo_mmr DESC NULLS LAST,
          u.steam_id ASC
      ) AS rank_duplicate_order
    FROM (
      SELECT *
      FROM public.users
      WHERE queen_ladder_rank IS NOT NULL
      ORDER BY
        queen_ladder_last_seen_at DESC NULLS LAST,
        queen_ladder_rank ASC NULLS LAST,
        drodo_mmr DESC NULLS LAST
      LIMIT 300
    ) u
    WHERE u.queen_ladder_rank <= 100
  ) ranked
  WHERE rank_duplicate_order = 1
  ORDER BY queen_ladder_rank ASC
  LIMIT 100
)
SELECT u.steam_id
FROM public.users u
CROSS JOIN params p
LEFT JOIN visible_queen_board vqb ON vqb.steam_id = u.steam_id
WHERE u.drodo_last_fetched_at IS NOT NULL
  AND u.drodo_profile_missing = false
  AND NOT (u.steam_signed_in_at >= p.as_of - p.active_sign_in_window)
  AND u.queen_ladder_rank IS NULL
  AND u.drodo_last_fetched_at < p.as_of - p.purge_retention
  AND (u.steam_signed_in_at IS NULL OR u.steam_signed_in_at < p.as_of - p.purge_retention)
  AND NOT EXISTS (
    SELECT 1 FROM public.match_players mp WHERE mp.steam_id = u.steam_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.matches m WHERE m.observer_steam_id = u.steam_id
  );

-- Mandatory review checkpoints before any delete:
SELECT count(*) AS candidate_users FROM purge_users_to_review;
SELECT * FROM purge_users_to_review ORDER BY steam_id LIMIT 100;

-- Abort if the candidate count is unexpectedly high.
DO $$
DECLARE
  candidate_count integer;
BEGIN
  SELECT count(*) INTO candidate_count FROM purge_users_to_review;
  IF candidate_count > 500 THEN
    RAISE EXCEPTION 'Refusing to purge % users; review candidate criteria first', candidate_count;
  END IF;
END $$;

-- Delete cache/profile rows first, then public.users, then matching auth.users.
-- The conservative candidate query excludes match_players and observer refs, so
-- this should not remove public match history.
DELETE FROM public.player_seasons ps
USING purge_users_to_review p
WHERE ps.steam_id = p.steam_id;

DELETE FROM public.mmr_snapshots ms
USING purge_users_to_review p
WHERE ms.steam_id = p.steam_id;

DELETE FROM public.users u
USING purge_users_to_review p
WHERE u.steam_id = p.steam_id;

DELETE FROM auth.users au
USING purge_users_to_review p
WHERE au.raw_user_meta_data->>'steam_id' = p.steam_id::text
   OR au.email = (p.steam_id::text || '@steam.local');

-- Leave this as ROLLBACK during rehearsal. Replace with COMMIT only after
-- reviewing row counts, backups/PITR posture, and product impact.
ROLLBACK;
-- COMMIT;
*/

-- ---------------------------------------------------------------------------
-- 3. If product decides to purge match history too.
-- ---------------------------------------------------------------------------
-- This is intentionally separate from the conservative default. Deleting
-- match_players removes the user's row from public match history and may orphan
-- matches/timelines, because match_timelines has no FK and match_players only
-- cascades when a match is deleted.
--
-- Required order for a full purge:
--   1. Stage and review purge_users_to_review.
--   2. DELETE FROM match_players for staged steam_ids.
--   3. UPDATE matches SET observer_steam_id = NULL for staged steam_ids.
--   4. DELETE orphan matches with no match_players.
--   5. DELETE orphan match_timelines with no matching matches row.
--   6. DELETE player_seasons, mmr_snapshots, users, and matching auth.users.
