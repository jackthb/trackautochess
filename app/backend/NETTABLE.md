# NetTable Capture

Captures Drodo's CustomNetTable broadcasts (queen ladder, per-lobby match
histories, post-game `end_board`, player_id ↔ team mapping) into Supabase.

## How it works

1. Dota launches with `-condebug -conclearlog` in launch options. `condebug`
   tees the in-game console to `<dota>/game/dota/console.log`;
   `conclearlog` truncates it at each launch, so ingest is idempotent
   across sessions.
2. On app startup, `nettable_capture.NetTableCapture` writes
   `autoexec.cfg` into `<dota>/game/dota/cfg/`. Idempotent — only rewrites
   if the contents differ.
3. The capture module tails `console.log` and sends key presses to the Dota
   HWND (via `SendInput`) on two cadences:
   - **Every 2s**: F23 (`game_info` — round/death tracking)
   - **Every 15s**: full cascade — F21 (`dac_table`), F22 (`player_info_table`), F23 (`game_info`)
   - **Once at match start**: F24 (`player_id_table` — steam_id → slot mapping)
   - **Every 5 min**: F16 (`chess_pool_table` — bans, legendaries, relic pool)
   - **On POST_GAME**: burst of F21 to capture `end_board`
4. Each key fires a single `dumpstringtable` command; the engine writes
   binary VBKV payloads into console.log.
5. The tailer detects stable dump blocks (no new `[stringtables]` lines
   for 2s), decodes them via `nettable_parser.parse_log`, and either
   processes them in-memory (match extraction, timeline) or POSTs rows
   to `dac_nettable_dumps` in Supabase.

## Key binds (autoexec.cfg)

All binds use extended F-keys (F21–F25) to avoid conflicting with user
keyboard shortcuts. One table per key — Source 2 drops chained
`dumpstringtable` calls.

| Key | Table | Cadence |
|-----|-------|---------|
| F21 | `dac_table` | Every 15s cascade + POST_GAME burst |
| F22 | `player_info_table` | Every 15s cascade |
| F23 | `game_info` | Every 2s + 15s cascade |
| F24 | `player_id_table` | Once at match start |
| F16 | `chess_pool_table` | Every 5 min |
| F25 | `unit_table` | Debug only — not in cascade |

## Files

| File | Role |
|---|---|
| `nettable_capture.py` | Autoexec install, log tailer, key sender, match extraction, timeline, event emits, ingest helpers. |
| `nettable_parser.py` | Pure VBKV decoder (`parse_vbkv`) and console.log walker (`parse_log`). |
| `main.py ingest-nettable` | CLI fallback for manual ingest when the app daemon isn't running. |
| `headless.py` | Instantiates `NetTableCapture(self._emit)` and runs its tailer thread. |

`AUTOEXEC_CFG_CONTENT` is the literal cfg file payload, inlined as a
constant in `nettable_capture.py` — single source of truth.

## Events emitted (consumed by `useNetTableEvents` in the renderer)

```ts
{ type: "nettable_status", autoexec_installed: bool, log_path: str, log_writable: bool, dota_dir: str }
{ type: "nettable_dump_captured", tables: string[], at: ISO_string }
{ type: "nettable_ingest_complete", rows_written: number, tables: string[], at: ISO_string }
{ type: "nettable_ingest_error", error: string }
{ type: "nettable_end_board_saved", at: ISO_string }
```

## What gets captured

Each row in `dac_nettable_dumps` is `(table_name, key, raw jsonb)`.

| Table | Key entries | Contents |
|---|---|---|
| `dac_table` | `player_info`, `user_panel_ranking`, `end_board`, `show_all_player_connect_status` | Live player stats; `end_board` is the post-game record. |
| `player_info_table` | `player_info` | Aggregate per-player state (HP, lineup, gold, level, W/L). |
| `game_info` | `death_team`, `round_info`, `game_version`, `quest` | Round tracking and slot elimination. |
| `player_id_table` | `player_<i>`, `chessboard_<i>`, `courier_<i>`, `vchess_<i>`, `relic_ttl_<i>`, `mmr_level_<i>` | Per-slot mapping + live state. |
| `chess_pool_table` | `ban_info`, `ban_info_<N>`, `legendary_info`, `relic_list`, `destroy_info`, + static reference keys | Bans, legendaries, relic pool (match-specific). |
| `ranking_top_table` | `ranking_top` | Full queen ladder + leaderboard subcategories. |

See `NETTABLE_STORAGE_PLAN.md` for the full keep/drop breakdown per key.

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

- Export `SUPABASE_SERVICE_ROLE_KEY` in the environment the app inherits, or
- Replace `supabase_key` in `~/.dac/config.json` with the service-role
  key (not recommended).
