-- Run after the migration INSIDE a transaction and always ROLLBACK.
-- These synthetic accounts/rows must never be committed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE steam_id IN
      (76561202255233021,76561202255233022,76561202255233020)) THEN
    RAISE EXCEPTION 'Test IDs already exist; choose unused fixtures';
  END IF;
END $$;
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES ('00000000-0000-4000-8000-000000000021', '76561202255233021@steam.local', now(),
        '{"steam_id":"76561202255233022"}'),
       ('00000000-0000-4000-8000-000000000022', '76561202255233022@steam.local', now(), '{}'),
       ('00000000-0000-4000-8000-000000000023', 'unverified@example.invalid', NULL,
        '{"steam_id":"76561202255233021"}');
INSERT INTO public.users (steam_id, name, avatar_url)
VALUES (76561202255233021, 'Owner A', 'https://example.invalid/a'),
       (76561202255233022, 'Owner B', 'https://example.invalid/b');
INSERT INTO public.community_builds (author_steam_id,name,payload,status)
VALUES (76561202255233021,'security-test-owner-a','{}','draft'),
       (76561202255233022,'security-test-owner-b','{}','draft'),
       (76561202255233022,'security-test-public','{}','approved');
INSERT INTO storage.buckets (id, name, public)
VALUES ('diagnostic-logs','diagnostic-logs',false) ON CONFLICT DO NOTHING;
INSERT INTO storage.objects (bucket_id, name)
VALUES ('diagnostic-logs','76561202255233021/security-test/tracker.log'),
       ('diagnostic-logs','76561202255233022/security-test/tracker.log');

SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.users WHERE steam_id = 76561202255233021) <> 1 THEN
    RAISE EXCEPTION 'Public profiles must remain readable'; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='diagnostic-logs') THEN
    RAISE EXCEPTION 'Anonymous diagnostic read was allowed'; END IF;
  IF (SELECT count(*) FROM public.community_builds WHERE name LIKE 'security-test-%') <> 1 THEN
    RAISE EXCEPTION 'Anonymous draft read was allowed'; END IF;
  BEGIN
    INSERT INTO public.users (steam_id) VALUES (76561202255233020);
    RAISE EXCEPTION 'Anonymous insert was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.users SET name='attack' WHERE steam_id=76561202255233021;
    RAISE EXCEPTION 'Anonymous update was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('diagnostic-logs','76561202255233021/security-test/anon.log');
    RAISE EXCEPTION 'Anonymous diagnostic insert was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_table_privilege(current_user,'public.users','TRUNCATE') THEN
    RAISE EXCEPTION 'Anonymous truncate privilege remains'; END IF;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000021","role":"authenticated","user_metadata":{"steam_id":"76561202255233022"}}', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
  IF private.verified_steam_id() <> '76561202255233021' THEN
    RAISE EXCEPTION 'Editable metadata changed verified identity'; END IF;
  IF (SELECT count(*) FROM public.community_builds WHERE name LIKE 'security-test-%') <> 2
     OR EXISTS (SELECT 1 FROM public.community_builds WHERE name='security-test-owner-b') THEN
    RAISE EXCEPTION 'Spoofed metadata granted draft access'; END IF;
  UPDATE public.users SET name='Owner A changed' WHERE steam_id=76561202255233021;
  IF (SELECT name FROM public.users WHERE steam_id=76561202255233021) <> 'Owner A changed' THEN
    RAISE EXCEPTION 'Own name update failed'; END IF;
  -- Existing desktop ladder upsert, including another player's name.
  INSERT INTO public.users(steam_id,name,queen_ladder_rank,queen_ladder_season,queen_ladder_last_seen_at)
  VALUES (76561202255233022,'spoofed name',2,'s39',now())
  ON CONFLICT(steam_id) DO UPDATE SET steam_id=excluded.steam_id,
    name=excluded.name,queen_ladder_rank=excluded.queen_ladder_rank,
    queen_ladder_season=excluded.queen_ladder_season,queen_ladder_last_seen_at=excluded.queen_ladder_last_seen_at;
  IF (SELECT name FROM public.users WHERE steam_id=76561202255233022) <> 'Owner B'
    OR (SELECT queen_ladder_rank FROM public.users WHERE steam_id=76561202255233022) <> 2 THEN
    RAISE EXCEPTION 'Shared capture should succeed without changing other profile names'; END IF;
  INSERT INTO public.users(steam_id) VALUES (76561202255233020) ON CONFLICT DO NOTHING;
  BEGIN
    UPDATE public.users SET avatar_url='https://example.invalid/attack' WHERE steam_id=76561202255233022;
    RAISE EXCEPTION 'Protected profile update was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.users(steam_id,stream_link) VALUES (76561202255233020,'https://example.invalid/attack')
      ON CONFLICT(steam_id) DO UPDATE SET stream_link=excluded.stream_link;
    RAISE EXCEPTION 'Protected profile upsert was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.users SET steam_id=76561202255233019 WHERE steam_id=76561202255233020;
    RAISE EXCEPTION 'Identity reassignment was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_table_privilege(current_user,'public.users','TRUNCATE') THEN
    RAISE EXCEPTION 'Authenticated truncate privilege remains'; END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='diagnostic-logs' AND name LIKE '%/security-test/%') <> 1 THEN
    RAISE EXCEPTION 'Diagnostic reads were not isolated'; END IF;
  INSERT INTO storage.objects(bucket_id,name) VALUES ('diagnostic-logs','76561202255233021/security-test/new.log');
  UPDATE storage.objects SET metadata='{"test":true}' WHERE bucket_id='diagnostic-logs' AND name='76561202255233021/security-test/new.log';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Own diagnostic update failed'; END IF;
  UPDATE storage.objects SET metadata='{"test":true}' WHERE bucket_id='diagnostic-logs' AND name='76561202255233022/security-test/tracker.log';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Other diagnostic update allowed'; END IF;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('diagnostic-logs','76561202255233022/security-test/attack.log');
    RAISE EXCEPTION 'Other diagnostic insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE storage.objects SET name='76561202255233022/security-test/moved.log'
      WHERE bucket_id='diagnostic-logs' AND name='76561202255233021/security-test/new.log';
    RAISE EXCEPTION 'Diagnostic path reassignment allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000023","role":"authenticated","user_metadata":{"steam_id":"76561202255233021"}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
  IF private.verified_steam_id() IS NOT NULL THEN RAISE EXCEPTION 'Unverified identity accepted'; END IF;
  UPDATE public.users SET name='attack' WHERE steam_id=76561202255233021;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Unverified account can update'; END IF;
  BEGIN
    INSERT INTO public.users(steam_id) VALUES (76561202255233019);
    RAISE EXCEPTION 'Unverified account can insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.users SET name='Server profile', avatar_url='https://example.invalid/server',
  steam_signed_in_at=now() WHERE steam_id=76561202255233022;
DO $$ BEGIN
  IF (SELECT name FROM public.users WHERE steam_id=76561202255233022) <> 'Server profile' THEN
    RAISE EXCEPTION 'Trusted profile refresh failed'; END IF;
END $$;
RESET ROLE;
SELECT 'Profile and diagnostic access regression checks passed' AS result;
