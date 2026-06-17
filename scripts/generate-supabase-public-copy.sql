create or replace function pg_temp.export_public_table_inserts(
  table_name text,
  key_columns text[],
  table_order int
)
returns table(sort_key text, stmt text)
language plpgsql
as $$
declare
  column_names text[];
  column_list text;
  value_expr text;
  order_expr text;
  insert_prefix text;
begin
  select
    array_agg(attname::text order by attnum),
    string_agg(format('%I', attname), ', ' order by attnum)
  into column_names, column_list
  from pg_attribute
  where attrelid = format('public.%I', table_name)::regclass
    and attnum > 0
    and not attisdropped;

  select string_agg(format('%I', column_name), ', ')
  into order_expr
  from unnest(key_columns) as column_name;

  insert_prefix := format(
    'insert into public.%I (%s) values (',
    table_name,
    column_list
  );

  value_expr := format(
    '(select string_agg(case when to_jsonb(t)->>c is null then ''null'' else quote_literal(to_jsonb(t)->>c) end, '', '' order by ord) from unnest(%L::text[]) with ordinality as cols(c, ord))',
    column_names
  );

  return query execute format(
    'select %L || ''.'' || lpad(row_number() over (order by %s)::text, 10, ''0'') as sort_key, %L || %s || '');'' as stmt from public.%I as t',
    lpad(table_order::text, 3, '0'),
    order_expr,
    insert_prefix,
    value_expr,
    table_name
  );
end;
$$;

with statements as (
  select '000.0000000000' as sort_key, 'begin;' as stmt
  union all
  select
    '001.0000000000',
    'truncate table public.match_players, public.match_timelines, public.matches, public.player_seasons, public.lineup_snapshots, public.mmr_snapshots, public.site_status, public.users restart identity cascade;'
  union all
  select * from pg_temp.export_public_table_inserts('users', array['steam_id'], 10)
  union all
  select * from pg_temp.export_public_table_inserts('player_seasons', array['steam_id', 'season'], 20)
  union all
  select * from pg_temp.export_public_table_inserts('matches', array['match_id'], 30)
  union all
  select * from pg_temp.export_public_table_inserts('match_players', array['id'], 40)
  union all
  select * from pg_temp.export_public_table_inserts('match_timelines', array['match_id'], 50)
  union all
  select * from pg_temp.export_public_table_inserts('lineup_snapshots', array['id'], 60)
  union all
  select * from pg_temp.export_public_table_inserts('mmr_snapshots', array['id'], 70)
  union all
  select * from pg_temp.export_public_table_inserts('site_status', array['id'], 80)
  union all
  select
    '090.0000000000',
    'select setval(pg_get_serial_sequence(''public.match_players'', ''id''), coalesce((select max(id) from public.match_players), 1), (select count(*) > 0 from public.match_players));'
  union all
  select
    '091.0000000000',
    'select setval(pg_get_serial_sequence(''public.lineup_snapshots'', ''id''), coalesce((select max(id) from public.lineup_snapshots), 1), (select count(*) > 0 from public.lineup_snapshots));'
  union all
  select
    '092.0000000000',
    'select setval(pg_get_serial_sequence(''public.mmr_snapshots'', ''id''), coalesce((select max(id) from public.mmr_snapshots), 1), (select count(*) > 0 from public.mmr_snapshots));'
  union all
  select '999.0000000000', 'commit;'
)
select stmt
from statements
order by sort_key;
