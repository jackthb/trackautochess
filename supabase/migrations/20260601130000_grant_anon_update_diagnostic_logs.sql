-- NOTE: resequenced to 20260601130000 — the original 20260601120000 prefix
-- collided with 20260601120000_drop_users_banned.sql, so the Supabase
-- integration recorded that version as applied and silently skipped this file.
--
-- Fix: diagnostic-log uploads were 400ing on every attempt
-- ("new row violates row-level security policy").
--
-- The desktop app uploads tracker.log.gz / console.log.gz with x-upsert: true so
-- periodic re-uploads overwrite the same stable per-session object. Supabase
-- Storage implements upsert as INSERT ... ON CONFLICT DO UPDATE, which requires
-- an UPDATE policy in addition to INSERT. The original bucket migration
-- (20260529120000) granted anon INSERT only, so every upsert was rejected by RLS
-- and the bucket stayed empty.
--
-- Grant anon UPDATE scoped to this bucket. The bucket stays private: still no
-- anon SELECT, so logs remain readable only via the dashboard (service role).

drop policy if exists "anon can update diagnostic logs" on storage.objects;
create policy "anon can update diagnostic logs"
  on storage.objects for update
  to anon
  using (bucket_id = 'diagnostic-logs')
  with check (bucket_id = 'diagnostic-logs');
