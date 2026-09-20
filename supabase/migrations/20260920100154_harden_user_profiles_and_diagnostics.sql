-- Profile identity is server-owned; ladder/capture telemetry remains shared
-- client-reported data. Keep existing desktop roster/ladder upserts working.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- The Steam callback creates confirmed synthetic email accounts after verifying
-- OpenID. Read that identity from auth.users, never editable user_metadata or
-- a caller-provided Steam ID. Reading the row also supports existing JWTs.
CREATE OR REPLACE FUNCTION private.verified_steam_id()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT split_part(u.email, '@', 1)
  FROM auth.users AS u
  WHERE u.id = (SELECT auth.uid())
    AND u.email_confirmed_at IS NOT NULL
    AND u.email ~ '^7656119[0-9]{10}@steam[.]local$|^7656120[0-9]{10}@steam[.]local$'
    AND split_part(u.email, '@', 1) >= '76561197960265728'
    AND split_part(u.email, '@', 1) <= '76561202255233023'
$$;
REVOKE ALL ON FUNCTION private.verified_steam_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.verified_steam_id() TO authenticated;

-- Draft visibility must use the same verified identity as profile/storage RLS.
DROP POLICY IF EXISTS community_builds_auth_select ON public.community_builds;
CREATE POLICY community_builds_auth_select ON public.community_builds
  FOR SELECT TO authenticated USING (
    status = 'approved'
    OR author_steam_id::text = (SELECT private.verified_steam_id())
  );

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users FROM PUBLIC, anon, authenticated;
-- Also remove any historical column grants, which table revokes do not remove.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ') INTO cols
  FROM pg_attribute WHERE attrelid = 'public.users'::regclass
    AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE ALL (%s) ON public.users FROM PUBLIC, anon, authenticated', cols);
END $$;
GRANT SELECT ON public.users TO anon, authenticated;
GRANT INSERT (steam_id, name, drodo_mmr, drodo_max_mmr, drodo_mmr_level,
  drodo_season, drodo_season_games, drodo_candy, drodo_chicken_count,
  drodo_raw_data, drodo_last_fetched_at, drodo_profile_missing,
  next_poll_at, poll_interval_seconds, queen_ladder_rank,
  queen_ladder_season, queen_ladder_last_seen_at)
ON public.users TO authenticated;
-- PostgREST upsert updates every submitted column, including steam_id. The
-- trigger below forbids changing the identity of an existing row.
GRANT UPDATE (steam_id, name, drodo_mmr, drodo_max_mmr, drodo_mmr_level,
  drodo_season, drodo_season_games, drodo_candy, drodo_chicken_count,
  drodo_raw_data, drodo_last_fetched_at, drodo_profile_missing,
  next_poll_at, poll_interval_seconds, queen_ladder_rank,
  queen_ladder_season, queen_ladder_last_seen_at)
ON public.users TO authenticated;

DROP POLICY IF EXISTS users_insert ON public.users;
DROP POLICY IF EXISTS users_update ON public.users;
DROP POLICY IF EXISTS users_authenticated_insert ON public.users;
DROP POLICY IF EXISTS users_authenticated_update ON public.users;
CREATE POLICY users_authenticated_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.verified_steam_id()) IS NOT NULL);
CREATE POLICY users_authenticated_update ON public.users
  FOR UPDATE TO authenticated
  USING ((SELECT private.verified_steam_id()) IS NOT NULL)
  WITH CHECK ((SELECT private.verified_steam_id()) IS NOT NULL);

CREATE OR REPLACE FUNCTION private.protect_user_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Service-role Steam/profile refreshes and operator maintenance are trusted.
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'UPDATE' AND NEW.steam_id IS DISTINCT FROM OLD.steam_id THEN
      RAISE EXCEPTION 'Player identity cannot be reassigned' USING ERRCODE = '42501';
    END IF;
    IF NEW.steam_id::text IS DISTINCT FROM private.verified_steam_id() THEN
      -- Ladder captures include other players' names. Ignore that field rather
      -- than failing the entire batch or letting it overwrite a trusted name.
      IF TG_OP = 'UPDATE' THEN NEW.name := OLD.name;
      ELSE NEW.name := NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_user_identity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_user_identity ON public.users;
CREATE TRIGGER protect_user_identity BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION private.protect_user_identity();

-- Do not create a new bucket or enable new telemetry collection here. Existing
-- buckets become private; these policies also secure any later bucket creation.
UPDATE storage.buckets SET public = false WHERE id = 'diagnostic-logs';
DROP POLICY IF EXISTS "anon can upload diagnostic logs" ON storage.objects;
DROP POLICY IF EXISTS "anon can read diagnostic logs" ON storage.objects;
DROP POLICY IF EXISTS "anon can update diagnostic logs" ON storage.objects;
CREATE POLICY diagnostic_logs_own_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'diagnostic-logs'
    AND (storage.foldername(name))[1] = (SELECT private.verified_steam_id())
  );
CREATE POLICY diagnostic_logs_own_select ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'diagnostic-logs'
    AND (storage.foldername(name))[1] = (SELECT private.verified_steam_id())
  );
CREATE POLICY diagnostic_logs_own_update ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'diagnostic-logs'
    AND (storage.foldername(name))[1] = (SELECT private.verified_steam_id())
  ) WITH CHECK (
    bucket_id = 'diagnostic-logs'
    AND (storage.foldername(name))[1] = (SELECT private.verified_steam_id())
  );
