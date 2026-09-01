-- Route desktop match writes through the validated match-ingest Edge Function.
-- The function authenticates the Steam session, validates the payload, and
-- writes with the service role. Public and authenticated clients retain read
-- access for the desktop history and web viewer.

BEGIN;

CREATE OR REPLACE FUNCTION public.ingest_match_capture(
    p_match jsonb,
    p_players jsonb,
    p_caller_steam_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_match_id text := p_match ->> 'match_id';
    v_existing_owner bigint;
    v_existing_status text;
    v_submitted_roster bigint[];
    v_existing_roster bigint[];
    v_candidate record;
    v_recent_count integer;
BEGIN
    IF current_user <> 'service_role' THEN
        RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_match_id, 0));

    SELECT array_agg(
        (submitted.player ->> 'steam_id')::bigint
        ORDER BY (submitted.player ->> 'steam_id')::bigint
    )
    INTO v_submitted_roster
    FROM jsonb_array_elements(p_players) AS submitted(player);

    IF v_submitted_roster IS NULL
       OR NOT p_caller_steam_id = ANY(v_submitted_roster) THEN
        RAISE EXCEPTION 'caller is not in submitted roster' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.users (steam_id)
    SELECT DISTINCT steam_id
    FROM unnest(v_submitted_roster || ARRAY[p_caller_steam_id]) AS roster(steam_id)
    ON CONFLICT (steam_id) DO NOTHING;

    SELECT observer_steam_id, capture_status
    INTO v_existing_owner, v_existing_status
    FROM public.matches
    WHERE match_id = v_match_id
    FOR UPDATE;

    IF FOUND THEN
        SELECT array_agg(steam_id ORDER BY steam_id)
        INTO v_existing_roster
        FROM public.match_players
        WHERE match_id = v_match_id;

        IF v_existing_owner IS NOT NULL
           AND v_existing_owner <> p_caller_steam_id THEN
            RAISE EXCEPTION 'match is owned by another Steam user'
                USING ERRCODE = '42501';
        END IF;
        IF v_existing_owner IS NULL AND v_existing_roster IS NULL THEN
            RAISE EXCEPTION 'ownerless legacy match has no stored roster'
                USING ERRCODE = '23514';
        END IF;
        IF v_existing_roster IS NOT NULL
           AND v_existing_roster <> v_submitted_roster THEN
            RAISE EXCEPTION 'match roster is immutable'
                USING ERRCODE = '23514';
        END IF;
        IF v_existing_status = 'complete'
           AND p_match ->> 'capture_status' <> 'complete' THEN
            RETURN v_match_id;
        END IF;
    ELSE
        PERFORM pg_advisory_xact_lock(
            hashtextextended('match-ingest-rate:' || p_caller_steam_id::text, 0)
        );
        SELECT count(*)
        INTO v_recent_count
        FROM public.matches
        WHERE observer_steam_id = p_caller_steam_id
          AND verified_at >= now() - interval '1 minute';
        IF v_recent_count >= 20 THEN
            RAISE EXCEPTION 'match ingest rate limit exceeded'
                USING ERRCODE = 'P0001';
        END IF;
        SELECT count(*)
        INTO v_recent_count
        FROM public.matches
        WHERE observer_steam_id = p_caller_steam_id
          AND verified_at >= now() - interval '1 day';
        IF v_recent_count >= 100 THEN
            RAISE EXCEPTION 'daily match ingest rate limit exceeded'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    INSERT INTO public.matches (
        match_id,
        played_at,
        duration,
        final_round,
        player_count,
        capture_status,
        is_finished,
        verification_source,
        verified_at,
        capture_started_at,
        capture_ended_at,
        observer_steam_id
    )
    VALUES (
        v_match_id,
        (p_match ->> 'played_at')::timestamptz,
        (p_match ->> 'duration')::real,
        (p_match ->> 'final_round')::smallint,
        (p_match ->> 'player_count')::smallint,
        p_match ->> 'capture_status',
        (p_match ->> 'is_finished')::boolean,
        p_match ->> 'verification_source',
        (p_match ->> 'verified_at')::timestamptz,
        (p_match ->> 'capture_started_at')::timestamptz,
        (p_match ->> 'capture_ended_at')::timestamptz,
        p_caller_steam_id
    )
    ON CONFLICT (match_id) DO UPDATE SET
        played_at = EXCLUDED.played_at,
        duration = EXCLUDED.duration,
        final_round = EXCLUDED.final_round,
        player_count = EXCLUDED.player_count,
        capture_status = EXCLUDED.capture_status,
        is_finished = EXCLUDED.is_finished,
        verification_source = EXCLUDED.verification_source,
        verified_at = EXCLUDED.verified_at,
        capture_started_at = EXCLUDED.capture_started_at,
        capture_ended_at = EXCLUDED.capture_ended_at,
        observer_steam_id = EXCLUDED.observer_steam_id;

    INSERT INTO public.match_players (
        match_id,
        steam_id,
        placement,
        mmr_level,
        hero_level,
        chess_lineup,
        chess_hand,
        synergies,
        relic,
        relic_history,
        talents,
        win_round,
        lose_round,
        draw_round,
        kills,
        deaths,
        hero_damage,
        hero_damaged,
        mvp_chess_name,
        mvp_chess_items,
        max_lineup_value,
        max_lineup_value_lineup,
        duration,
        final_round,
        zhugong,
        total_money,
        candy,
        played_at,
        replay,
        created_at
    )
    SELECT
        player.match_id,
        player.steam_id,
        player.placement,
        player.mmr_level,
        player.hero_level,
        player.chess_lineup,
        player.chess_hand,
        player.synergies,
        player.relic,
        player.relic_history,
        player.talents,
        player.win_round,
        player.lose_round,
        player.draw_round,
        player.kills,
        player.deaths,
        player.hero_damage,
        player.hero_damaged,
        player.mvp_chess_name,
        player.mvp_chess_items,
        player.max_lineup_value,
        player.max_lineup_value_lineup,
        player.duration,
        player.final_round,
        player.zhugong,
        player.total_money,
        player.candy,
        player.played_at,
        player.replay,
        player.created_at
    FROM jsonb_to_recordset(p_players) AS player (
        match_id text,
        steam_id bigint,
        placement smallint,
        mmr_level smallint,
        hero_level smallint,
        chess_lineup text,
        chess_hand text,
        synergies text,
        relic text,
        relic_history jsonb,
        talents text,
        win_round smallint,
        lose_round smallint,
        draw_round smallint,
        kills smallint,
        deaths smallint,
        hero_damage integer,
        hero_damaged integer,
        mvp_chess_name text,
        mvp_chess_items text,
        max_lineup_value integer,
        max_lineup_value_lineup text,
        duration real,
        final_round smallint,
        zhugong text,
        total_money integer,
        candy integer,
        played_at timestamptz,
        replay text,
        created_at timestamptz
    )
    ON CONFLICT (match_id, steam_id) DO UPDATE SET
        placement = EXCLUDED.placement,
        mmr_level = EXCLUDED.mmr_level,
        hero_level = EXCLUDED.hero_level,
        chess_lineup = EXCLUDED.chess_lineup,
        chess_hand = EXCLUDED.chess_hand,
        synergies = EXCLUDED.synergies,
        relic = EXCLUDED.relic,
        relic_history = EXCLUDED.relic_history,
        talents = EXCLUDED.talents,
        win_round = EXCLUDED.win_round,
        lose_round = EXCLUDED.lose_round,
        draw_round = EXCLUDED.draw_round,
        kills = EXCLUDED.kills,
        deaths = EXCLUDED.deaths,
        hero_damage = EXCLUDED.hero_damage,
        hero_damaged = EXCLUDED.hero_damaged,
        mvp_chess_name = EXCLUDED.mvp_chess_name,
        mvp_chess_items = EXCLUDED.mvp_chess_items,
        max_lineup_value = EXCLUDED.max_lineup_value,
        max_lineup_value_lineup = EXCLUDED.max_lineup_value_lineup,
        duration = EXCLUDED.duration,
        final_round = EXCLUDED.final_round,
        zhugong = EXCLUDED.zhugong,
        total_money = EXCLUDED.total_money,
        candy = EXCLUDED.candy,
        played_at = EXCLUDED.played_at,
        replay = EXCLUDED.replay;

    IF p_match ->> 'capture_status' = 'complete' THEN
        FOR v_candidate IN
            SELECT candidate.match_id
            FROM public.matches AS candidate
            WHERE candidate.observer_steam_id = p_caller_steam_id
              AND candidate.capture_status = 'partial'
              AND candidate.match_id <> v_match_id
              AND candidate.played_at BETWEEN
                  (p_match ->> 'played_at')::timestamptz - interval '30 minutes'
                  AND (p_match ->> 'played_at')::timestamptz + interval '30 minutes'
              AND (
                  SELECT array_agg(mp.steam_id ORDER BY mp.steam_id)
                  FROM public.match_players AS mp
                  WHERE mp.match_id = candidate.match_id
              ) = v_submitted_roster
        LOOP
            DELETE FROM public.match_timelines
            WHERE match_id = v_candidate.match_id;
            DELETE FROM public.matches
            WHERE match_id = v_candidate.match_id
              AND observer_steam_id = p_caller_steam_id;
        END LOOP;
    END IF;

    RETURN v_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_match_timeline(
    p_timeline jsonb,
    p_caller_steam_id bigint,
    p_roster bigint[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_match_id text := p_timeline ->> 'match_id';
    v_owner bigint;
    v_stored_roster bigint[];
    v_requested_roster bigint[];
BEGIN
    IF current_user <> 'service_role' THEN
        RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_match_id, 0));

    SELECT observer_steam_id
    INTO v_owner
    FROM public.matches
    WHERE match_id = v_match_id
    FOR UPDATE;

    IF NOT FOUND OR v_owner <> p_caller_steam_id THEN
        RAISE EXCEPTION 'match is not owned by caller' USING ERRCODE = '42501';
    END IF;

    SELECT array_agg(steam_id ORDER BY steam_id)
    INTO v_stored_roster
    FROM public.match_players
    WHERE match_id = v_match_id;

    SELECT array_agg(steam_id ORDER BY steam_id)
    INTO v_requested_roster
    FROM unnest(p_roster) AS requested(steam_id);

    IF v_stored_roster IS NULL OR v_stored_roster <> v_requested_roster THEN
        RAISE EXCEPTION 'timeline roster does not match stored roster'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.match_timelines (
        match_id,
        timeline,
        round_count,
        first_round,
        last_round
    )
    VALUES (
        v_match_id,
        p_timeline,
        (p_timeline ->> 'round_count')::smallint,
        (p_timeline ->> 'first_round')::smallint,
        (p_timeline ->> 'last_round')::smallint
    )
    ON CONFLICT (match_id) DO UPDATE SET
        timeline = EXCLUDED.timeline,
        round_count = EXCLUDED.round_count,
        first_round = EXCLUDED.first_round,
        last_round = EXCLUDED.last_round,
        captured_at = now()
    WHERE public.match_timelines.round_count < EXCLUDED.round_count;

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_match_capture(jsonb, jsonb, bigint)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_match_timeline(jsonb, bigint, bigint[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_match_capture(jsonb, jsonb, bigint)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_match_timeline(jsonb, bigint, bigint[])
    TO service_role;

COMMIT;
