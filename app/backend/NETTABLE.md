# NetTable Capture

Captures Drodo's CustomNetTable broadcasts (queen ladder, per-lobby match
histories, post-game `end_board`, player_id ↔ team mapping) into Supabase.

## How it works

1. Dota launches with `-condebug -conclearlog` in launch options. `condebug`
   tees the in-game console to `<dota>/game/dota/console.log`;
   `conclearlog` truncates it at each launch, so ingest is idempotent
   across sessions.
2. On app startup, `nettable_capture.NetTableCapture` writes
   `autoexec.cfg` (with `alias dac_dump_all "...; ..."` and `bind F12
   dac_dump_all`) into `<dota>/game/dota/cfg/`. Idempotent — only rewrites
   if the contents differ.
3. The capture module tails `console.log` and sends F12 to the Dota HWND
   (via `PostMessageW`, no focus needed) at two moments per game:
   - **~30 s after `DOTA_GAMERULES_STATE_GAME_IN_PROGRESS`** — captures
     ladder, match histories, player_info, player_id slots.
   - **~5 s after `DOTA_GAMERULES_STATE_POST_GAME`** — captures
     `end_board` (the post-game record).
4. The F12 alias fires `dumpstringtable` for six tables; the engine
   writes their binary VBKV payloads into console.log.
5. The tailer detects stable dump blocks (no new `[stringtables]` lines
   for 2 s), decodes them via `nettable_parser.parse_log`, and POSTs rows
   to `dac_nettable_dumps` in Supabase.

## Files

| File | Role |
|---|---|
| `nettable_capture.py` | Autoexec install, log tailer, F12 sender, auto-ingest, event emits, ingest helpers (`extract_rows`, `insert_dumps`). |
| `nettable_parser.py` | Pure VBKV decoder (`parse_vbkv`) and console.log walker (`parse_log`). |
| `main.py ingest-nettable` | CLI fallback for manual ingest when the app daemon isn't running. |
| `headless.py` | Instantiates `NetTableCapture(self._emit)` and runs its tailer thread. |

`AUTOEXEC_CFG_CONTENT` is the literal cfg file payload, inlined as a
constant in `nettable_capture.py` — single source of truth, no extra
bundled data file.

## Events emitted (consumed by `useNetTableEvents` in the renderer)

```ts
{ type: "nettable_status", autoexec_installed: bool, log_path: str, log_writable: bool, dota_dir: str }
{ type: "nettable_dump_captured", tables: string[], at: ISO_string }
{ type: "nettable_ingest_complete", rows_written: number, tables: string[], at: ISO_string }
{ type: "nettable_ingest_error", error: string }
```

## What gets captured

The F12 alias dumps these six tables. Each row in `dac_nettable_dumps` is
`(table_name, key, raw jsonb)`.

| Table | Entries | Contents |
|---|---|---|
| `CustomNetTable_ranking_top_table` | `ranking_top` | Full queen ladder + leaderboard subcategories. |
| `CustomNetTable_match_history_table` | `match_history_<player_id>` | Per-lobby-player match history. |
| `CustomNetTable_dac_table` | `player_info`, `user_panel_ranking`, `end_board`, `show_all_player_connect_status` | Live player stats; `end_board` is the post-game record. |
| `CustomNetTable_player_id_table` | `player_<i>`, `chessboard_<i>`, `courier_<i>`, `vchess_<i>`, `relic_ttl_<i>`, `mmr_level_<i>` | Per-slot mapping + live state. |
| `CustomNetTable_player_info_table` | aggregate | Aggregate player_info. |
| `CustomNetTable_game_info` | `death_team`, `game_version`, `quest`, `round_info` | Game metadata. |

## Manual test (no app running)

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = '<sb_secret_...>'
cd app/backend
python main.py ingest-nettable --dry-run        # parse-only
python main.py ingest-nettable                   # write
python main.py ingest-nettable --only dac_table  # filter
```

Bare names in `--only` get the `CustomNetTable_` prefix auto-prepended.

## Supabase auth

The `dac_nettable_dumps` table has RLS open SELECT to anon only. Writes
need the service role key. Either:

- Export `SUPABASE_SERVICE_ROLE_KEY` in the environment the app inherits
  (preferred — keeps the publishable key in `config.json` for the rest of
  the app), or
- Replace `supabase_key` in `~/.dac/config.json` with the service-role
  key (not recommended — that key would then be readable by everything in
  the app).

If creds are wrong, the first ingest will emit `nettable_ingest_error`
with the underlying Supabase response in the message, surfacing it on
the activity feed.

## Throwaway account

Dumping NetTables doesn't modify any client files — it just reads
broadcasts Drodo's dedi already sends. Using a throwaway is a hygiene
habit from the panorama-hook era; it's not strictly required for this
pipeline. The `-condebug` and `-conclearlog` flags are read-only.
