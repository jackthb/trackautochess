// Isolated test-only dependency; see docs/database-access-hardening.md.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.local/db-security-test/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
import fs from 'node:fs';
const db = new PGlite();
try {
await db.exec(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb
$$;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
CREATE TABLE public.users(
 steam_id bigint PRIMARY KEY CHECK(steam_id BETWEEN 76561197960265728 AND 76561202255233023),
 created_at timestamptz DEFAULT now(),name text,custom_url text,
 drodo_mmr integer,drodo_max_mmr integer,drodo_mmr_level integer,drodo_season text,
 drodo_season_games integer,drodo_candy integer,drodo_chicken_count integer NOT NULL DEFAULT 0,
 drodo_raw_data jsonb,drodo_last_fetched_at timestamptz,drodo_profile_missing boolean NOT NULL DEFAULT false,
 avatar_url text,next_poll_at timestamptz NOT NULL DEFAULT now(),poll_interval_seconds integer NOT NULL DEFAULT 3600,
 queen_ladder_rank integer,queen_ladder_season text,queen_ladder_last_seen_at timestamptz,
 steam_signed_in_at timestamptz,stream_link text,steam_profile_refreshed_at timestamptz);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select ON public.users FOR SELECT USING(true);
CREATE POLICY users_insert ON public.users FOR INSERT WITH CHECK(true);
CREATE POLICY users_update ON public.users FOR UPDATE USING(true) WITH CHECK(true);
CREATE POLICY users_authenticated_insert ON public.users FOR INSERT TO authenticated WITH CHECK(true);
CREATE POLICY users_authenticated_update ON public.users FOR UPDATE TO authenticated USING(true) WITH CHECK(true);
GRANT ALL ON public.users TO anon,authenticated,service_role;
GRANT UPDATE(avatar_url) ON public.users TO anon,authenticated;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean DEFAULT false);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,metadata jsonb,UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO anon,authenticated,service_role;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parts text[]; BEGIN parts := string_to_array(name,'/'); RETURN parts[1:array_length(parts,1)-1]; END $$;
CREATE POLICY "anon can upload diagnostic logs" ON storage.objects FOR INSERT TO anon WITH CHECK(bucket_id='diagnostic-logs');
CREATE POLICY "anon can read diagnostic logs" ON storage.objects FOR SELECT TO anon USING(bucket_id='diagnostic-logs');
CREATE POLICY "anon can update diagnostic logs" ON storage.objects FOR UPDATE TO anon USING(bucket_id='diagnostic-logs') WITH CHECK(bucket_id='diagnostic-logs');
`);
await db.exec(fs.readFileSync('supabase/migrations/20260717012317_preserve_queen_ladder_rank_unless_capture_clear.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20260716154029_create_community_builds.sql','utf8'));
await db.exec('BEGIN');
await db.exec(fs.readFileSync('supabase/migrations/20260920100154_harden_user_profiles_and_diagnostics.sql','utf8'));
const results=await db.exec(fs.readFileSync('supabase/tests/profile_access.sql','utf8'));
console.log(JSON.stringify(results.flatMap(r=>r.rows).filter(r=>r.result),null,2));
await db.exec('ROLLBACK');
console.log('Local PostgreSQL regression transaction rolled back.');
} catch(e) { console.error(e.message);process.exitCode=1; }
finally { await db.close(); }
