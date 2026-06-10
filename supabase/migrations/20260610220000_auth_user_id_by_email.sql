-- Steam sign-in keys auth accounts by a synthetic email (<steam_id>@steam.local).
-- The admin SDK has no getUserByEmail, and scanning auth.admin.listUsers pages
-- broke sign-in once the project outgrew one page (default 50/page). This gives
-- the auth callback a direct, indexed lookup instead. service_role only.
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where email = p_email limit 1;
$$;

revoke all on function public.auth_user_id_by_email(text) from public;
revoke all on function public.auth_user_id_by_email(text) from anon;
revoke all on function public.auth_user_id_by_email(text) from authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;
