select setval(
  pg_get_serial_sequence('public.match_players', 'id'),
  coalesce((select max(id) from public.match_players), 1),
  (select count(*) > 0 from public.match_players)
);

select setval(
  pg_get_serial_sequence('public.lineup_snapshots', 'id'),
  coalesce((select max(id) from public.lineup_snapshots), 1),
  (select count(*) > 0 from public.lineup_snapshots)
);

select setval(
  pg_get_serial_sequence('public.mmr_snapshots', 'id'),
  coalesce((select max(id) from public.mmr_snapshots), 1),
  (select count(*) > 0 from public.mmr_snapshots)
);
