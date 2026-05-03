-- One-shot backfill: fetch Drodo data for every users row that has no
-- drodo_last_fetched_at yet. Uses pg_net to call Drodo, parses the JSON
-- inline, and writes to users + player_seasons exactly the way
-- fetchAndCacheDrodo does at runtime. mmr_snapshots is intentionally
-- skipped to mirror the runtime first-pull (snapshots only on manual
-- refresh).
--
-- Safe to re-run: rows that succeed or are marked missing populate
-- drodo_last_fetched_at, so the next run sees an empty work queue.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  rec       record;
  rid       bigint;
  pending   int;
  iter      int := 0;
  body      jsonb;
  ddata     jsonb;
  cur_season text;
  cur_n     int;
  k         text;
  n         int;
BEGIN
  CREATE TEMP TABLE _backfill_q (
    request_id bigint PRIMARY KEY,
    steam_id   text   NOT NULL
  ) ON COMMIT DROP;

  -- Queue one HTTP GET per unsearched user.
  FOR rec IN
    SELECT steam_id::text AS sid
    FROM users
    WHERE drodo_last_fetched_at IS NULL
  LOOP
    SELECT net.http_get(
      url := 'http://autochess.ppbizon.com/courier/get/@' || rec.sid
    ) INTO rid;
    INSERT INTO _backfill_q (request_id, steam_id) VALUES (rid, rec.sid);
  END LOOP;

  -- pg_net is async; wait until every queued request has a row in
  -- net._http_response. Cap at ~10 min so a stuck request doesn't hang
  -- the migration forever — anything not in by then stays null and the
  -- migration can be re-run.
  LOOP
    SELECT count(*) INTO pending
    FROM _backfill_q q
    LEFT JOIN net._http_response r ON r.id = q.request_id
    WHERE r.id IS NULL;
    EXIT WHEN pending = 0;
    iter := iter + 1;
    EXIT WHEN iter > 600;
    PERFORM pg_sleep(1);
  END LOOP;

  -- Walk responses, parse, write.
  FOR rec IN
    SELECT q.steam_id, r.status_code, r.content
    FROM _backfill_q q
    LEFT JOIN net._http_response r ON r.id = q.request_id
  LOOP
    BEGIN
      body := rec.content::jsonb;
    EXCEPTION WHEN OTHERS THEN
      body := NULL;
    END;

    IF rec.status_code IS NULL
       OR rec.status_code <> 200
       OR body IS NULL
       OR (body->>'err')::int IS DISTINCT FROM 0
       OR body->'user_info'->rec.steam_id IS NULL
    THEN
      -- 7-day cooldown for empty Drodo profiles is enforced at read time
      -- in lib/drodo.ts; here we just stamp the missing marker.
      UPDATE users
      SET drodo_profile_missing = true,
          drodo_last_fetched_at = now(),
          drodo_mmr            = NULL,
          drodo_max_mmr        = NULL,
          drodo_mmr_level      = NULL,
          drodo_season         = NULL,
          drodo_season_games   = NULL,
          drodo_candy          = NULL,
          drodo_chicken_count  = 0,
          drodo_raw_data       = NULL
      WHERE steam_id::text = rec.steam_id;
      CONTINUE;
    END IF;

    ddata := body->'user_info'->rec.steam_id;

    -- Highest mmr_sN key wins as current season.
    cur_n := 0;
    cur_season := NULL;
    FOR k IN SELECT jsonb_object_keys(ddata) LOOP
      IF k ~ '^mmr_s[0-9]+$' THEN
        n := (regexp_replace(k, '^mmr_s', ''))::int;
        IF n > cur_n THEN
          cur_n := n;
          cur_season := 's' || n;
        END IF;
      END IF;
    END LOOP;

    UPDATE users
    SET drodo_mmr = CASE WHEN cur_season IS NOT NULL
                         THEN NULLIF(ddata->>('mmr_' || cur_season), '')::int
                         ELSE NULL END,
        drodo_max_mmr = CASE WHEN cur_season IS NOT NULL
                             THEN NULLIF(ddata->>('max_mmr_' || cur_season), '')::int
                             ELSE NULL END,
        drodo_mmr_level     = NULLIF(ddata->>'mmr_level', '')::int,
        drodo_season        = cur_season,
        drodo_season_games  = CASE WHEN cur_season IS NOT NULL
                                   THEN NULLIF(ddata->>('match_' || cur_season), '')::int
                                   ELSE NULL END,
        drodo_candy         = NULLIF(ddata->>'candy', '')::int,
        drodo_chicken_count = COALESCE(NULLIF(ddata->>'chicken_count', '')::int, 0),
        drodo_raw_data      = ddata,
        drodo_last_fetched_at = now(),
        drodo_profile_missing = false
    WHERE steam_id::text = rec.steam_id;

    -- Per-season rows. chicken_count is only known for the current season;
    -- COALESCE on conflict so an existing historical row doesn't get
    -- nulled out.
    INSERT INTO player_seasons (
      steam_id, season, mmr, max_mmr, games_played, chicken_count, fetched_at
    )
    SELECT
      rec.steam_id::bigint,
      's' || regexp_replace(keys.k, '^mmr_s', ''),
      NULLIF(ddata->>keys.k, '')::int,
      NULLIF(ddata->>('max_mmr_s' || regexp_replace(keys.k, '^mmr_s', '')), '')::int,
      NULLIF(ddata->>('match_s'   || regexp_replace(keys.k, '^mmr_s', '')), '')::int,
      CASE WHEN ('s' || regexp_replace(keys.k, '^mmr_s', '')) = cur_season
           THEN NULLIF(ddata->>'chicken_count', '')::int
           ELSE NULL END,
      now()
    FROM jsonb_object_keys(ddata) AS keys(k)
    WHERE keys.k ~ '^mmr_s[0-9]+$'
    ON CONFLICT (steam_id, season) DO UPDATE
      SET mmr           = EXCLUDED.mmr,
          max_mmr       = EXCLUDED.max_mmr,
          games_played  = EXCLUDED.games_played,
          chicken_count = COALESCE(EXCLUDED.chicken_count, player_seasons.chicken_count),
          fetched_at    = EXCLUDED.fetched_at;
  END LOOP;
END $$;
