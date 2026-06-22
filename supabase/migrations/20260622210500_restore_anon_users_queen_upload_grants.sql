-- Queen ladder uploads from existing desktop builds still use the publishable
-- Supabase key, so PostgREST executes them as the anon role. The RLS policies
-- already allow these users upserts, but anon also needs table privileges or
-- Postgres rejects the request before RLS with "permission denied for table users".

grant usage on schema public to anon;
grant select, insert, update on table public.users to anon;
