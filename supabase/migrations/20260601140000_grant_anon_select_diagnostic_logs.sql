-- Completes the diagnostic-logs upsert fix (follows 20260601130000).
--
-- Adding the anon UPDATE policy was NOT sufficient: Supabase Storage's upsert
-- (x-upsert: true) reads the existing object before writing, so it also needs
-- SELECT. Verified live as anon: with INSERT+UPDATE only, upsert still returned
-- 400 "new row violates row-level security policy"; after adding SELECT, both
-- the insert and overwrite paths return 200.
--
-- TRADEOFF (accepted): the anon key ships in the desktop app, so granting anon
-- SELECT makes this bucket effectively public-read. The original bucket
-- migration (20260529120000) already noted anon write is effectively public for
-- this friends-only tool; read is the same class of tradeoff. Revisit with
-- per-user path scoping if this ever holds anything sensitive.
--
-- Already applied to production via MCP; this file keeps the repo authoritative
-- and is idempotent (safe to re-run).

drop policy if exists "anon can read diagnostic logs" on storage.objects;
create policy "anon can read diagnostic logs"
  on storage.objects for select
  to anon
  using (bucket_id = 'diagnostic-logs');
