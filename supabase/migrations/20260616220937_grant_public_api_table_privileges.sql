-- Supabase's Data API requires table privileges in addition to RLS policies.
-- These grants make a freshly-created project match the permissions expected
-- by the app and by server-side service-role jobs.

grant usage on schema public to anon, authenticated, service_role;

grant select on table
  public.users,
  public.player_seasons,
  public.mmr_snapshots,
  public.matches,
  public.match_players,
  public.match_timelines,
  public.lineup_snapshots,
  public.site_status
to anon, authenticated;

grant select, insert, update, delete on table
  public.users,
  public.player_seasons,
  public.mmr_snapshots,
  public.matches,
  public.match_players,
  public.match_timelines,
  public.lineup_snapshots,
  public.site_status,
  public.app_locks
to service_role;

grant usage, select on all sequences in schema public to service_role;
