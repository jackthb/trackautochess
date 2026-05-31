-- Diagnostic logs bucket: stores full tracker.log + Dota console.log uploads
-- shipped by the desktop app's telemetry (gzipped). Private — only the
-- service role (dashboard) can read; the desktop app uploads with the
-- publishable/anon key, so we grant anon INSERT into this bucket only.
--
-- Tradeoff noted: the publishable key ships in the app, so anon INSERT here is
-- effectively public write. Acceptable for a small friends-only tool; revisit
-- with per-user path scoping / size limits if abuse appears.

insert into storage.buckets (id, name, public)
values ('diagnostic-logs', 'diagnostic-logs', false)
on conflict (id) do nothing;

-- Uploads only. No SELECT/UPDATE/DELETE for anon — the bucket stays private and
-- is read via the Supabase dashboard (service role bypasses RLS).
create policy "anon can upload diagnostic logs"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'diagnostic-logs');
