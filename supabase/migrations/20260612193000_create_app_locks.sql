create table if not exists public.app_locks (
  lock_key text primary key,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.app_locks enable row level security;

revoke all on table public.app_locks from public;
revoke all on table public.app_locks from anon;
revoke all on table public.app_locks from authenticated;
grant select, insert, update on table public.app_locks to service_role;

create or replace function public.claim_app_lock(
  p_key text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_until timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 1));
begin
  insert into public.app_locks (lock_key, locked_until, updated_at)
  values (p_key, v_until, v_now)
  on conflict (lock_key) do update
    set locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
    where public.app_locks.locked_until <= v_now;

  return found;
end;
$$;

revoke all on function public.claim_app_lock(text, integer) from public;
revoke all on function public.claim_app_lock(text, integer) from anon;
revoke all on function public.claim_app_lock(text, integer) from authenticated;
grant execute on function public.claim_app_lock(text, integer) to service_role;
