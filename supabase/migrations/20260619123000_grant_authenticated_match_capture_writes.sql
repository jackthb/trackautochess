-- Desktop capture now exchanges verified Steam OpenID for a Supabase Auth
-- session and sends that access token as Authorization. Grant the
-- authenticated PostgREST role table privileges for the capture write path.

grant usage on schema public to authenticated;

grant select, insert, update on public.users to authenticated;
grant select, insert, update on public.player_seasons to authenticated;
grant select, insert, update on public.matches to authenticated;
grant select, insert, update on public.match_players to authenticated;
grant select, insert, update on public.match_timelines to authenticated;
grant select, insert, update on public.lineup_snapshots to authenticated;

grant usage, select on all sequences in schema public to authenticated;

drop policy if exists users_authenticated_insert on public.users;
create policy users_authenticated_insert on public.users
for insert to authenticated
with check (true);

drop policy if exists users_authenticated_update on public.users;
create policy users_authenticated_update on public.users
for update to authenticated
using (true)
with check (true);

drop policy if exists player_seasons_authenticated_insert on public.player_seasons;
create policy player_seasons_authenticated_insert on public.player_seasons
for insert to authenticated
with check (true);

drop policy if exists player_seasons_authenticated_update on public.player_seasons;
create policy player_seasons_authenticated_update on public.player_seasons
for update to authenticated
using (true)
with check (true);

drop policy if exists match_timelines_authenticated_insert on public.match_timelines;
create policy match_timelines_authenticated_insert on public.match_timelines
for insert to authenticated
with check (true);

drop policy if exists match_timelines_authenticated_update on public.match_timelines;
create policy match_timelines_authenticated_update on public.match_timelines
for update to authenticated
using (true)
with check (true);

drop policy if exists lineup_snapshots_authenticated_insert on public.lineup_snapshots;
create policy lineup_snapshots_authenticated_insert on public.lineup_snapshots
for insert to authenticated
with check (true);

drop policy if exists lineup_snapshots_authenticated_update on public.lineup_snapshots;
create policy lineup_snapshots_authenticated_update on public.lineup_snapshots
for update to authenticated
using (true)
with check (true);
