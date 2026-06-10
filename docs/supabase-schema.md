# Supabase Schema Snapshot

This is a readable snapshot of the current public product schema, derived from
`supabase/migrations/` after migration `20260609123000_add_user_stream_links`.
The migration files remain the source of truth. Refresh this document after
schema migrations that add, remove, or rename public tables/columns.

The Supabase CLI was not available when this snapshot was added. To replace this
with a live SQL dump, install/link the Supabase CLI and run:

```bash
supabase db dump --schema public --file docs/supabase-schema.sql
```

## Extensions And Storage

- `pg_trgm` is enabled for public user search indexes.
- Supabase Storage bucket `diagnostic-logs` stores diagnostic logs and raw
  nettable dumps uploaded by the desktop backend.
- The legacy `dac_nettable_dumps` Postgres table is intentionally dropped; raw
  dump data should stay in Storage/local disk, not relational tables.

## Tables

### `users`

Public player/profile row keyed by SteamID64.

| Column | Type | Notes |
| --- | --- | --- |
| `steam_id` | `bigint` | Primary key. Validated to public individual SteamID64 range. |
| `created_at` | `timestamptz` | Defaults to `now()`. |
| `name` | `text` | Steam display name cache. |
| `custom_url` | `text` | Steam vanity URL cache. |
| `avatar_url` | `text` | Steam avatar cache. |
| `steam_signed_in_at` | `timestamptz` | Last Steam sign-in time. |
| `stream_link` | `text` | Optional streamer profile link. |
| `drodo_mmr` | `integer` | Cached current Drodo MMR. |
| `drodo_max_mmr` | `integer` | Cached current-season max Drodo MMR. |
| `drodo_mmr_level` | `integer` | Drodo rank level. |
| `drodo_season` | `text` | Current Drodo season key, e.g. `s28`. |
| `drodo_season_games` | `integer` | Current-season game count. |
| `drodo_candy` | `integer` | Drodo candy value. |
| `drodo_chicken_count` | `integer` | Defaults to `0`. |
| `drodo_raw_data` | `jsonb` | Last raw Drodo profile payload. |
| `drodo_last_fetched_at` | `timestamptz` | Last Drodo fetch time. |
| `drodo_profile_missing` | `boolean` | Defaults to `false`. |
| `next_poll_at` | `timestamptz` | Adaptive Drodo poll schedule, defaults to `now()`. |
| `poll_interval_seconds` | `integer` | Adaptive poll interval, defaults to `3600`. |
| `queen_ladder_rank` | `integer` | In-game Queen ladder rank from NetTable capture. |
| `queen_ladder_mmr` | `integer` | In-game Queen ladder MMR. |
| `queen_ladder_season` | `text` | Queen ladder season key. |
| `queen_ladder_last_seen_at` | `timestamptz` | Last Queen ladder observation. |

Indexes:

- `users_next_poll_at_idx` on `next_poll_at` where Drodo has been fetched.
- `users_signed_in_next_poll_at_idx` on `next_poll_at` for signed-in users.
- Public search indexes on Drodo recency/name, `custom_url`, trigram
  `custom_url`, trigram `name`, and ranked Drodo MMR.
- Queen ladder indexes on rank/MMR and last seen time.

RLS:

- Public select and insert policies exist.
- Public update policy exists for cached profile maintenance paths.

### `player_seasons`

One Drodo season aggregate row per player/season.

| Column | Type | Notes |
| --- | --- | --- |
| `steam_id` | `bigint` | References `users(steam_id)`. Part of primary key. Validated to SteamID64 range. |
| `season` | `text` | Part of primary key. |
| `mmr` | `integer` | Season MMR. |
| `max_mmr` | `integer` | Season max MMR. |
| `games_played` | `integer` | Season games. |
| `fetched_at` | `timestamptz` | Defaults to `now()`. |
| `chicken_count` | `integer` | Current-season chicken count when available. |

RLS: public select, insert, and update policies exist.

### `mmr_snapshots`

Point-in-time Drodo observations for charts/history.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key. |
| `steam_id` | `bigint` | Validated to SteamID64 range. |
| `mmr` | `integer` | Observed MMR. |
| `season` | `text` | Season key. |
| `snapshotted_at` | `timestamptz` | Defaults to `now()`. |
| `chicken_count` | `integer` | Observed chicken count. |
| `queen_rank` | `integer` | Observed Queen rank. |

Indexes/constraints:

- `mmr_snapshots_steam_id_time_idx` on `(steam_id, snapshotted_at DESC)`.
- Unique observation constraint on `(steam_id, season, mmr, chicken_count,
  queen_rank)` with `NULLS NOT DISTINCT`.

RLS: public select policy exists.

### `matches`

One processed live-capture match row.

| Column | Type | Notes |
| --- | --- | --- |
| `match_id` | `text` | Primary key. |
| `played_at` | `timestamptz` | Required. |
| `duration` | `real` | Match duration. |
| `final_round` | `smallint` | Final round. |
| `player_count` | `smallint` | Player count. |
| `capture_status` | `text` | Defaults to `complete`; constrained to known capture states. |
| `is_finished` | `boolean` | Defaults to `true`. |
| `verification_source` | `text` | Defaults to `end_board`. |
| `verified_at` | `timestamptz` | Verification timestamp. |
| `capture_started_at` | `timestamptz` | Local capture start. |
| `capture_ended_at` | `timestamptz` | Local capture end. |
| `observer_steam_id` | `bigint` | Optional observer, references `users(steam_id)` and validates SteamID64 range. |

Indexes:

- `matches_played_at_idx` on `played_at DESC`.
- `matches_capture_status_played_at_idx` on `(capture_status, played_at DESC)`.
- `matches_is_finished_played_at_idx` on `(is_finished, played_at DESC)`.

RLS: public select, insert, and update policies exist.

### `match_players`

One player result row per match.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key. |
| `match_id` | `text` | References `matches(match_id)`. Unique with `steam_id`. |
| `steam_id` | `bigint` | References `users(steam_id)`. Validated to SteamID64 range. |
| `placement` | `smallint` | Final placement. |
| `mmr_level` | `smallint` | Rank level at match end. |
| `hero_level` | `smallint` | Courier/hero level. |
| `chess_lineup` | `text` | Final lineup. |
| `chess_hand` | `text` | Bench/hand state. |
| `synergies` | `text` | Final synergy string. |
| `relic` | `text` | Active/final relic. |
| `relic_history` | `jsonb` | Round-by-round relic picks. |
| `talents` | `text` | Talent string. |
| `win_round` | `smallint` | Win rounds. |
| `lose_round` | `smallint` | Loss rounds. |
| `draw_round` | `smallint` | Draw rounds. |
| `kills` | `smallint` | Kills. |
| `deaths` | `smallint` | Deaths. |
| `hero_damage` | `integer` | Damage dealt. |
| `hero_damaged` | `integer` | Damage taken. |
| `mvp_chess_name` | `text` | MVP unit name. |
| `mvp_chess_items` | `text` | MVP unit item string. |
| `max_lineup_value` | `integer` | Max lineup value. |
| `max_lineup_value_lineup` | `text` | Lineup for max value. |
| `duration` | `real` | Match duration. |
| `final_round` | `smallint` | Final round. |
| `zhugong` | `text` | Raw extracted field. |
| `total_money` | `integer` | Final total money. |
| `candy` | `integer` | Candy value. |
| `screenshot` | `text` | Optional media URL/path. |
| `notes` | `text` | Optional user notes. |
| `replay` | `text` | Optional replay path/URL. |
| `played_at` | `timestamptz` | Denormalized match time. |
| `created_at` | `timestamptz` | Defaults to `now()`. |

Indexes/constraints:

- Unique `(match_id, steam_id)`.
- Indexes on `match_id`, `steam_id`, `played_at DESC NULLS LAST`, and
  `(steam_id, played_at DESC NULLS LAST)`.

RLS: public select, insert, and update policies exist.

### `match_timelines`

One round-by-round timeline blob per match.

| Column | Type | Notes |
| --- | --- | --- |
| `match_id` | `text` | Primary key. No FK because CV-path match IDs may not exist in `matches`. |
| `timeline` | `jsonb` | Required timeline payload. |
| `round_count` | `smallint` | Number of timeline rounds. |
| `first_round` | `smallint` | First captured round. |
| `last_round` | `smallint` | Last captured round. |
| `captured_at` | `timestamptz` | Defaults to `now()`. |

RLS: public select, insert, and update policies exist.

### `lineup_snapshots`

Aggregate round/lineup observations used for lineup analysis.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key. |
| `owner` | `text` | Owner/player label. |
| `round` | `integer` | Round number. |
| `result` | `text` | Result label. |
| `population` | `integer` | Population count. |
| `chess` | `text` | Chess/unit string. |
| `synergy` | `text` | Synergy string. |
| `talent` | `text` | Talent string. |
| `lineup` | `jsonb` | Required lineup payload. |
| `courier` | `text` | Courier name. |
| `entry_hash` | `text` | Unique hash. |
| `captured_at` | `timestamptz` | Defaults to `now()`. |
| `relic` | `text` | Relic string. |

RLS: public select policy exists.

## Removed / Legacy Tables

- `games` was dropped by `20260526130000_drop_games_table.sql`; current reads and
  writes should use `match_players`.
- `drodo_profiles` was merged into `users`.
- `dac_nettable_dumps` was dropped; use Storage bucket `diagnostic-logs`.
- `banned_ips` and `users.banned` were removed.
