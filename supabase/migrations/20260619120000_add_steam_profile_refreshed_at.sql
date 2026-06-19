alter table public.users
  add column if not exists steam_profile_refreshed_at timestamptz;
