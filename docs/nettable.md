# NetTable Capture

Captures Drodo's CustomNetTable broadcasts (queen ladder, post-game
`end_board`, live player snapshots, player_id ↔ team mapping) locally first,
then uploads the processed match representation to Supabase.

## How it works

1. Dota launches with `-condebug -conclearlog -gamestateintegration`
   in launch options. `condebug` tees the in-game console to
   `<dota>/game/dota/console.log`; `conclearlog` truncates it at each launch,
   so ingest is idempotent across sessions.
2. When the user applies nettable setup, the Rust `nettable_service` writes a marked Track
   Auto Chess block inside `<dota>/game/dota/cfg/autoexec.cfg`. If the user has
   their own autoexec, it appends/replaces only our marked block and preserves
   the rest of the file.
3. The capture module tails `console.log` and sends dump commands through the
   app-owned extended F-key binds only while Dota is the foreground window.
   There is no focus stealing and no sending keys into other apps. If the user
   tabs out, dumps pause; when Dota regains focus, the backend immediately sends
   a catch-up snapshot before resuming the normal cadence:
   - **Every 2s**: F23 (`game_info` — round/death tracking)
   - **On round change**: F22 (`player_info_table`) + F20 (`player_id_table` — slot/board metadata refresh)
   - **Once at match/session opening**: F24 (`ranking_top_table` + `player_id_table`) then F16 (`chess_pool_table`)
   - **On POST_GAME**: burst of F21 to capture `end_board`
4. Each key bind runs one or more `dumpstringtable` calls. Dota writes binary
   VBKV payloads into `console.log`, which the tailer parses.
5. Match-session continuity is keyed by the exact sorted Steam-ID roster from
   `player_info_table.player_info.data`. If DAC emits `GAME_IN_PROGRESS` again
   after a disconnect/rejoin but the roster is identical, the app keeps the
   same session. If the roster differs, the previous open session is closed as
   partial/abandoned and a new session starts.
6. Upload consistency is observer-independent. Everyone can record locally; if
   multiple players upload the same deterministic `match_id`, `match_timelines`
   keeps the version with more captured rounds and ignores shorter/equal
   timelines. The timeline JSON also includes `roster_fingerprint` and
   `observer_steam_id` for audit/debugging.
7. The tailer detects stable dump blocks (no new `[stringtables]` lines
   for 2s), decodes them via `nettable_parser.parse_log`, optionally persists raw
   rows locally under `~/.dac/captures/` and `~/.dac/nettable_dumps/`, and processes them
   in-memory into `matches`, `match_players`, and `match_timelines`. Raw
   nettable dump logs upload through the web API to Cloudflare R2.

## Netconport

`-netconport` is intentionally not part of desktop capture. In practice it does
not work reliably for Windows Dota, and public Valve issues report the same
Windows/Linux split in Dota 2 and CS2. Do not add `-netconport` back to setup,
status checks, or capture delivery unless there is new evidence that Windows
Dota accepts remote-console connections consistently.

References documenting the upstream issue:

- Dota 2 issue: `-netconport` has been reported broken on Windows while Linux
  works: <https://github.com/ValveSoftware/Dota2-Gameplay/issues/11998>
- CS2 issue with the same Windows/Linux split and Workshop Tools note:
  <https://github.com/ValveSoftware/csgo-osx-linux/issues/3603>
- HLAE/advancedfx documents a related `-afxFixNetCon` workaround for Source 2
  netcon initialization: <https://github.com/advancedfx/advancedfx>

## Active capture matrix / console commands

The key names below are the app-owned autoexec binds. The app triggers them only
when Dota is focused. Most commands dump one table. F24 deliberately dumps
`ranking_top_table` and `player_id_table` together so the one-time lobby
metadata snapshot includes both the Queen ladder and the slot mapping.

| Key | Table(s) | Automatic trigger / cadence | Important keys | What it means / what we use it for | Raw-upload storage filter |
|---|---|---|---|---|---|
| F21 | `dac_table` | POST_GAME burst only | `end_board`, `player_info`, `user_panel_ranking`, `show_all_player_connect_status`, sometimes `stat_chess`, `game_over` | Main game-wide table, now captured only at the end because `end_board` is the important part. In observed same-second live dumps, `dac_table.player_info` was mostly default/stale, so continuously polling it was noise. Prefer `player_info_table.player_info` for current player state. | Kept. |
| F22 | `player_info_table` | On round change | `player_info` | Dedicated current player-state table: HP, gold, level, lineup, bench/hand, synergies, damage, rank, relic, talent tree, MMR/candy fields, etc. In same-second diffs, this is the table with the real current/final values while `dac_table.player_info` is mostly defaults. Round-change capture lines this up with the review UI's per-round view. | Kept. |
| F23 | `game_info` | Every 2s | `round_info`, `death_team`, `game_version`, `quest` | Cheap live heartbeat. `round_info.round` triggers heavier F22/F20 snapshots once per round. `death_team` maps team IDs to elimination bits and is used to detect when the local player dies before the whole lobby ends. | Processed capture uses `round_info` and `death_team`; `game_version` and `quest` are debug-only if present in raw logs. |
| F20 | `player_id_table` | On round change | `player_<n>`, `vchess_<n>`, `relic_ttl_<n>`, `mmr_level_<n>`, `courier_<n>`, `chessboard_<n>` | Per-slot state. `player_<n>` maps lobby slots/team IDs/hero indexes. `vchess_<n>` is the board grid state for that slot: unit IDs/names, board coordinates, items, water IDs, etc. `relic_ttl_<n>` is active relic + remaining duration. `mmr_level_<n>` is rank/candy baseline. | Processed capture uses `player_*`, `vchess_*`, `relic_ttl_*`, and `mmr_level_*`; cosmetic `courier_*` and `chessboard_*` are debug-only. |
| F24 | `ranking_top_table` + `player_id_table` | Once at match/session opening | `ranking_top`; plus the `player_id_table` keys above | One-shot lobby metadata. `ranking_top_table` normalizes into public Queen ladder/profile rank rows; the paired `player_id_table` gives an early steam_id → slot/team mapping before the first round snapshot. | Kept; `player_id_table` key-level filter still applies. |
| F16 | `chess_pool_table` | Once at match/session opening, immediately after F24 | `ban_info`, `ban_info_<n>`, `legendary_info`, `relic_list`, `destroy_info`, `chess_list_by_mana`, `chess_list_by_synergy`, `revealed_legendary_chess_list`, `unrevealed_legendary_chess_list`, static/reference list keys | Lobby pool metadata. Local raw dumps keep the whole one-shot table. The processed timeline currently extracts `ban_info_<n>` and `revealed_legendary_chess_list`; `relic_list`, `legendary_info`, `destroy_info`, and static reference lists are raw-only today unless we add explicit processed fields. | Kept. The old plan proposed dropping several static keys, but current code keeps the table because it is one-shot and useful for debugging patch/data drift. |
| F25 | `unit_table` | Bound only; not automatically fired | `egg_*` and/or unit entries depending on game state | Manual debugging only. It is not part of the normal capture cadence, so it should not appear unless someone presses F25 or runs a manual dump. | Debug-only if manually dumped, but normally absent. |

## Files

| File | Role |
|---|---|
| `app/backend/src/nettable_service.rs` | Autoexec/GSI setup helpers, log tailer orchestration, console command cadence, live state, match/timeline extraction, local dump persistence, and renderer events. |
| `app/backend/src/nettable_parser.rs` | Pure VBKV decoder and `console.log` walker used by the CLI, daemon, and tests. |
| `app/backend/src/main.rs` | JSON-lines daemon and CLI commands (`parse-log`, `parse-log-full`, `parse-live`, `queue`, `outbox-list`, `gsi-cfg`). |
| `app/backend/src/supabase.rs` | Processed match/timeline/Queen uploads, outbox replay, diagnostic-log Storage uploads, and raw nettable dump-log uploads. |
| `app/backend/src/dump_commands.rs` | Dump command identifiers, console command strings, focused key delivery, and Dota foreground detection. |

`AUTOEXEC_CFG_CONTENT` is the marked Track Auto Chess cfg block in `nettable_service.rs`. The setup path upserts that block instead of replacing the user's whole `autoexec.cfg`.

## Events emitted (consumed by `useNetTableEvents` in the renderer)

Representative Rust daemon event types include:

```ts
{ type: "nettable_status", backend: "rust", ok: boolean, autoexec_installed: boolean, gsi_cfg_installed: boolean, log_path: string, log_writable: boolean }
{ type: "nettable_state", backend: "rust", rows: number, state: object, players: unknown[], local_steam_ids: string[] }
{ type: "nettable_round_changed", backend: "rust", round: number, prev_round: number | null }
{ type: "nettable_creep_round", backend: "rust", round: number }
{ type: "nettable_game_ended", backend: "rust", message: string, match_id?: string }
{ type: "nettable_end_board_saved", backend: "rust", match_id: string }
{ type: "nettable_ingest_error", backend?: "rust", error: string }
{ type: "nettable_launch_options_applied", backend: "rust", ok: boolean, autoexec_path?: string, gsi_cfg_path?: string }
{ type: "nettable_queen_upload_progress", message: string }
{ type: "nettable_queen_upload_complete", ok: boolean, player_count: number, upserted_count: number, season: string }
{ type: "diagnostics_uploaded", backend: "rust", storage_ok: boolean, reason: string, paths: object }
```

## What gets captured

Normal Supabase writes use processed `matches`, `match_players`, `match_timelines`, and Queen ladder/profile rows. Raw decoded nettable rows are local-only unless the backend uploads a JSON dump log through `nettable_dump_upload_url`; the production endpoint stores it in Cloudflare R2.

Local raw dump persistence is controlled by the config field `keep_local_nettable_dumps`. When enabled, the backend writes `~/.dac/captures/latest_nettable_rows.json` and timestamped files under `~/.dac/nettable_dumps/`.

### Known DAC nettables not currently captured by the app

These showed up in older VPK/triage notes, but they are not in the current automatic key cadence. If we need one later, add an explicit bind/cadence and document why.

| Table | Current status | Notes |
|---|---|---|
| `match_history_table` | Not currently bound/captured | Previously investigated and observed to be empty in practice, so we do not treat it as a useful source unless a future patch proves otherwise. |
| `hp_bar_table` | Not currently bound/captured | Appears HUD-oriented: `hp_bar` maps unit indices to `{is_hero, unit_index, unit_name}`. It does **not** provide per-player elimination rows or reliable match-lifecycle state, so it is not used for live death detection in the current pipeline. |
| `quest_table` | Not currently bound/captured | Battle-pass/quest noise; not part of the normal capture cadence. |
| `casino_table` | Not currently bound/captured | Pass/minigame noise; not part of the normal capture cadence. |
| `hero_available_items`, `other_available_items` | Not currently bound/captured | In-game available-item UI state; not used by the tracker. |
| `ability_kv_table`, `chess_kv_table` | Not currently bound/captured | Static definitions better sourced from VPK/content data. |
| `gems`, `hero_ethereals`, `hero_prismatic`, `hero_wearables` | Not currently bound/captured | Cosmetic data. |
| `setting_table` | Not currently bound/captured | UI/settings state. |

### Current storage behavior

The Rust pipeline processes decoded rows in memory and uploads normalized product data. Diagnostic/raw dump artifacts are object-storage blobs, not table rows:

- `supabase.upload_diagnostic_logs(...)` uploads tracker/console diagnostics to `diagnostic-logs`.
- `supabase.upload_nettable_dump_log(...)` uploads raw nettable dump JSON logs to R2 keys shaped like `{steam_id}/nettable-dumps/{timestamp}.json`.
- Outbox replay routes legacy raw row payloads through the same raw nettable dump upload path.

### Open questions / current answers

| Question | Current answer |
|---|---|
| Is `player_info_table.player_info` different from `dac_table.player_info`? | Yes. In a same-second diff from `20260604_230953`, both tables had the same 8 Steam IDs, but `dac_table.player_info` was mostly default/stale for live stats while `player_info_table.player_info` had the real current values. Prefer `player_info_table` for current player state; use `dac_table` mainly for `end_board`, `user_panel_ranking`, and connection status. |
| Should `player_id_table.vchess_*` be dropped as an unknown VCHESS thing? | No. We now know this is the board-state table: unit entries keyed by board coordinates, with unit name/id/items/other per-piece fields. Keep it. |
| Do we need `mmr_level_*`? | Keep for now. It gives rank/candy baseline by slot and is small. |
| Is `death_team` redundant with HP or destroy info? | Maybe, but it is the cleanest local-player-death signal we currently have, so keep it. |
| Does `CustomNetTable_game_info` only contain `round_info`? | No. In observed payloads it has four keys: `round_info`, `death_team`, `game_version`, and `quest`. For processing, only `round_info.round` and `death_team` are used; the other two are debug metadata. |
| Does `hp_bar_table` add anything over `player_info.hp`? | It currently looks like a HUD-oriented unit index map (hero unit IDs and flags), not a direct player death/health timeline. We haven’t used it because it has no obvious per-team/per-player elimination state. If HP timing becomes unreliable, it is the next table to sample. |
| Do we need static `chess_pool_table` lists like `chess_list_by_mana`? | Not for normal processing, because VPK/content data is the source of truth. Current code still keeps them in the one-shot local/raw capture because the table is not polled repeatedly and it can expose patch drift. |
| Do we store the chess-pool relic list in processed match data? | Not currently. `chess_pool_table.relic_list` is present in local/raw dumps, but processed player/timeline rows currently use active per-player relic state from `player_id_table.relic_ttl_<n>`. |
| Can we list all legendaries in one match from captured data? | Yes, from one-shot `CustomNetTable_chess_pool_table`: `legendary_info`, `revealed_legendary_chess_list`, and `unrevealed_legendary_chess_list` contain the pool state/history, but only `revealed_legendary_chess_list` is currently promoted into processed timeline data. |

## Example raw output by table

These are representative decoded rows from local `raw_dumps.jsonl.gz` captures.
`dac_table`, `player_info_table`, and `player_id_table` are shown as full
decoded snapshots from one dump. The other examples are still trimmed with
`...` where the table repeats the same shape for many ranks or units.

### `CustomNetTable_dac_table`

Full decoded snapshot from `20260604_230953_76561198022169086/raw_dumps.jsonl.gz`.
Steam IDs are anonymized, but the table is otherwise not truncated.

```json
{
  "player_info": {
    "hehe": 675,
    "info": {
      "steam_id_0": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67134,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 0,
        "is_vip": 0,
        "max_lineup_value_lineup": "",
        "mvp_chess_damage": 0,
        "mvp_chess_name": "",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "steam_id": "steam_id_0",
        "player_id": 1,
        "team_id": 7,
        "is_author": 0,
        "hp": 100,
        "duration": 0,
        "rank": 0,
        "zhugong": "h421",
        "zhugong_model": "models/items/courier/onibi_lvl_21/onibi_lvl_21.vmdl",
        "zhugong_effect": "e000",
        "round": 0,
        "win_round": 0,
        "lose_round": 0,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_lineup": "",
        "chess_hand": "",
        "biscuit": 0,
        "hero_level": 0,
        "buff": "",
        "show_buff": "",
        "hero_damage": 0,
        "hero_damaged": 0,
        "max_lineup_value": 0,
        "total_money": 0,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 21,
        "candy": 205,
        "relic_history": {},
        "talent_tree": {}
      },
      "steam_id_1": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67111,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 0,
        "is_vip": 0,
        "max_lineup_value_lineup": "",
        "mvp_chess_damage": 0,
        "mvp_chess_name": "",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "steam_id": "steam_id_1",
        "player_id": 0,
        "team_id": 8,
        "is_author": 0,
        "hp": 100,
        "duration": 0,
        "rank": 0,
        "zhugong": "h416",
        "zhugong_model": "models/items/courier/krobeling/krobeling.vmdl",
        "zhugong_effect": "e000",
        "round": 0,
        "win_round": 0,
        "lose_round": 0,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_lineup": "",
        "chess_hand": "",
        "biscuit": 0,
        "hero_level": 0,
        "buff": "",
        "show_buff": "",
        "hero_damage": 0,
        "hero_damaged": 0,
        "max_lineup_value": 0,
        "total_money": 0,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 22,
        "candy": 510,
        "relic_history": {},
        "talent_tree": {}
      },
      "steam_id_2": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67111,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 0,
        "is_vip": 0,
        "max_lineup_value_lineup": "",
        "mvp_chess_damage": 0,
        "mvp_chess_name": "",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "steam_id": "steam_id_2",
        "player_id": 6,
        "team_id": 12,
        "is_author": 0,
        "hp": 100,
        "duration": 0,
        "rank": 0,
        "zhugong": "h110",
        "zhugong_model": "models/items/courier/jumo/jumo.vmdl",
        "zhugong_effect": "e000",
        "round": 0,
        "win_round": 0,
        "lose_round": 0,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_lineup": "",
        "chess_hand": "",
        "biscuit": 0,
        "hero_level": 0,
        "buff": "",
        "show_buff": "",
        "hero_damage": 0,
        "hero_damaged": 0,
        "max_lineup_value": 0,
        "total_money": 0,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 18,
        "candy": 326,
        "relic_history": {},
        "talent_tree": {}
      },
      "steam_id_3": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67048,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 0,
        "is_vip": 0,
        "max_lineup_value_lineup": "",
        "mvp_chess_damage": 0,
        "mvp_chess_name": "",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "steam_id": "steam_id_3",
        "player_id": 3,
        "team_id": 10,
        "is_author": 0,
        "hp": 100,
        "duration": 0,
        "rank": 0,
        "zhugong": "h225",
        "zhugong_model": "models/items/courier/little_fraid_the_courier_of_simons_retribution/little_fraid_the_courier_of_simons_retribution.vmdl",
        "zhugong_effect": "e000",
        "round": 0,
        "win_round": 0,
        "lose_round": 0,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_lineup": "",
        "chess_hand": "",
        "biscuit": 0,
        "hero_level": 0,
        "buff": "",
        "show_buff": "",
        "hero_damage": 0,
        "hero_damaged": 0,
        "max_lineup_value": 0,
        "total_money": 0,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 0,
        "candy": 128,
        "relic_history": {},
        "talent_tree": {}
      },
      "steam_id_4": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67129,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 0,
        "is_vip": 0,
        "max_lineup_value_lineup": "",
        "mvp_chess_damage": 0,
        "mvp_chess_name": "",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "steam_id": "steam_id_4",
        "player_id": 2,
        "team_id": 6,
        "is_author": 0,
        "hp": 100,
        "duration": 0,
        "rank": 0,
        "zhugong": "h318",
        "zhugong_model": "models/courier/baby_rosh/babyroshan.vmdl",
        "zhugong_effect": "e000",
        "round": 0,
        "win_round": 0,
        "lose_round": 0,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_lineup": "",
        "chess_hand": "",
        "biscuit": 0,
        "hero_level": 0,
        "buff": "",
        "show_buff": "",
        "hero_damage": 0,
        "hero_damaged": 0,
        "max_lineup_value": 0,
        "total_money": 0,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 20,
        "candy": 264,
        "relic_history": {},
        "talent_tree": {}
      },
      "steam_id_5": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67132,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 0,
        "is_vip": 0,
        "max_lineup_value_lineup": "",
        "mvp_chess_damage": 0,
        "mvp_chess_name": "",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "steam_id": "steam_id_5",
        "player_id": 7,
        "team_id": 11,
        "is_author": 0,
        "hp": 100,
        "duration": 0,
        "rank": 0,
        "zhugong": "h291",
        "zhugong_model": "models/nanguashenshi/nanguashenshi.vmdl",
        "zhugong_effect": "e416",
        "round": 0,
        "win_round": 0,
        "lose_round": 0,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_lineup": "",
        "chess_hand": "",
        "biscuit": 0,
        "hero_level": 0,
        "buff": "",
        "show_buff": "",
        "hero_damage": 0,
        "hero_damaged": 0,
        "max_lineup_value": 0,
        "total_money": 0,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 19,
        "candy": 269,
        "relic_history": {},
        "talent_tree": {}
      },
      "steam_id_6": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67046,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 2,
          "candy_added_limit_total": 10
        },
        "lineup_value": 0,
        "is_vip": 0,
        "max_lineup_value_lineup": "",
        "mvp_chess_damage": 0,
        "mvp_chess_name": "",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "steam_id": "steam_id_6",
        "player_id": 5,
        "team_id": 13,
        "is_author": 0,
        "hp": 100,
        "duration": 0,
        "rank": 0,
        "zhugong": "h204",
        "zhugong_model": "models/courier/seekling/seekling.vmdl",
        "zhugong_effect": "e000",
        "round": 0,
        "win_round": 0,
        "lose_round": 0,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_lineup": "",
        "chess_hand": "",
        "biscuit": 0,
        "hero_level": 0,
        "buff": "",
        "show_buff": "",
        "hero_damage": 0,
        "hero_damaged": 0,
        "max_lineup_value": 0,
        "total_money": 0,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 19,
        "candy": 351,
        "relic_history": {},
        "talent_tree": {}
      },
      "steam_id_7": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67083,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 3,
          "candy_added_limit_total": 10
        },
        "lineup_value": 0,
        "is_vip": 0,
        "max_lineup_value_lineup": "",
        "mvp_chess_damage": 0,
        "mvp_chess_name": "",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "steam_id": "steam_id_7",
        "player_id": 4,
        "team_id": 9,
        "is_author": 0,
        "hp": 100,
        "duration": 0,
        "rank": 0,
        "zhugong": "h313",
        "zhugong_model": "models/courier/defense3_sheep/defense3_sheep.vmdl",
        "zhugong_effect": "e000",
        "round": 0,
        "win_round": 0,
        "lose_round": 0,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_lineup": "",
        "chess_hand": "",
        "biscuit": 0,
        "hero_level": 0,
        "buff": "",
        "show_buff": "",
        "hero_damage": 0,
        "hero_damaged": 0,
        "max_lineup_value": 0,
        "total_money": 0,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 0,
        "candy": 95,
        "relic_history": {},
        "talent_tree": {}
      }
    }
  },
  "user_panel_ranking": {
    "table": {
      "steam_id_7": {
        "curr_rank": 7
      },
      "steam_id_1": {
        "curr_rank": 3
      },
      "steam_id_6": {
        "curr_rank": 1
      },
      "steam_id_3": {
        "curr_rank": 5
      },
      "steam_id_5": {
        "curr_rank": 2
      },
      "steam_id_4": {
        "curr_rank": 8
      },
      "steam_id_2": {
        "curr_rank": 4
      },
      "steam_id_0": {
        "curr_rank": 6
      }
    },
    "hehe": 141
  },
  "show_all_player_connect_status": {
    "table": {
      "0": 1,
      "1": 1,
      "2": 1,
      "3": 0,
      "4": 0,
      "5": 1,
      "6": 1,
      "7": 1
    },
    "hehe": 13473
  },
  "end_board": {
    "data": {
      "steam_id_0": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67134,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 66,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_chen,chess_ld,chess_ld,chess_pangolier1,chess_veno1,chess_pangolier1,chess_chen,chess_th,chess_snap1,",
        "mvp_chess_damage": 3230.23828125,
        "mvp_chess_name": "chess_pangolier1",
        "mvp_chess_items": "",
        "pandaman_getlist": {
          "1": "chess_ss_13",
          "2": "chess_shredder_21",
          "3": "chess_pangolier_22"
        },
        "delta": -98,
        "level_delta": -1,
        "steam_id": "steam_id_0",
        "candy_award": 0,
        "relic": "item_egg",
        "player_id": 1,
        "team_id": 7,
        "is_author": 0,
        "curr_rank": 6,
        "hp": 0,
        "duration": 1637.36669921875,
        "rank": 6,
        "zhugong": "h421",
        "zhugong_model": "models/items/courier/onibi_lvl_21/onibi_lvl_21.vmdl",
        "zhugong_effect": "e000",
        "round": 27,
        "win_round": 6,
        "lose_round": 13,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_beast",
          "2": "is_aqir"
        },
        "chess_lineup": "chess_chen,chess_ld,chess_ld,chess_pangolier1,chess_veno1,chess_pangolier1,chess_chen,chess_th,chess_snap1,",
        "chess_hand": "chess_doom,chess_tb,chess_am,chess_sf,chess_sf,chess_qop1,chess_am,chess_doom,",
        "biscuit": 0,
        "hero_level": 9,
        "buff": "is_beast:3,is_aqir:2,is_druid:1,is_priest:1,is_knight:1,is_hunter:1,is_assassin:1,is_warlock:1,is_goblin:1,is_naga:1,is_orc:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 52,
        "hero_damaged": 141,
        "max_lineup_value": 66,
        "total_money": 243,
        "block_team": {},
        "ban_synergy": "is_ogre",
        "mmr_level": 20,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_malefic_rapture",
            "round": 12
          },
          "2": {
            "relic": "item_egg",
            "round": 21
          }
        },
        "talent_tree": {
          "1": "talent_1b_losebonus",
          "2": "talent_2b_promotion",
          "3": "talent_3a_healdamage"
        }
      },
      "steam_id_1": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67111,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 89,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_riki1,chess_doom1,chess_ss11,chess_mag1,chess_eh1,chess_tusk11,chess_kez1,chess_bane11,chess_wd11,chess_sm11,",
        "mvp_chess_damage": 9958.9501953125,
        "mvp_chess_name": "chess_doom1",
        "mvp_chess_items": "item_fashulengjing,item_huiguang,item_huiyao,item_hongzhang",
        "pandaman_getlist": {
          "1": "chess_wd_9",
          "2": "chess_storm_27"
        },
        "delta": 22,
        "level_delta": 0,
        "steam_id": "steam_id_1",
        "candy_award": 1,
        "relic": "item_egg",
        "player_id": 0,
        "team_id": 8,
        "is_author": 0,
        "curr_rank": 3,
        "hp": 0,
        "duration": 2646.266845703125,
        "rank": 3,
        "zhugong": "h416",
        "zhugong_model": "models/items/courier/krobeling/krobeling.vmdl",
        "zhugong_effect": "e000",
        "round": 42,
        "win_round": 14,
        "lose_round": 17,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_satyr",
          "2": "is_centaur",
          "3": "is_harpy",
          "4": "is_troll",
          "5": "is_warlock",
          "6": "is_assassin",
          "7": "is_beast"
        },
        "chess_lineup": "chess_riki1,chess_doom1,chess_ss11,chess_mag1,chess_eh1,chess_tusk11,chess_kez1,chess_bane11,chess_wd11,chess_sm11,",
        "chess_hand": "egg,chess_doom,chess_kez1,",
        "biscuit": 0,
        "hero_level": 10,
        "buff": "is_assassin:3,is_warlock:2,is_warrior:2,is_harpy:2,is_centaur:2,is_satyr:2,is_beast:2,is_troll:2,is_druid:1,is_shaman:1,is_mage:1,is_nraqi:1,is_demon:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 146,
        "hero_damaged": 166,
        "max_lineup_value": 89,
        "total_money": 452,
        "block_team": {},
        "ban_synergy": "is_goblin",
        "mmr_level": 22,
        "candy": 1,
        "relic_history": {
          "1": {
            "relic": "item_stolen_vault",
            "round": 12
          },
          "2": {
            "relic": "item_free_draw",
            "round": 21
          },
          "3": {
            "relic": "item_rank_damage",
            "round": 31
          },
          "4": {
            "relic": "item_egg",
            "round": 41
          }
        },
        "talent_tree": {
          "1": "talent_1b_losebonus",
          "2": "talent_2a_discount",
          "3": "talent_3a_healdamage",
          "4": "talent_4a_moreio"
        }
      },
      "steam_id_2": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67111,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 68,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_es1,chess_bs1,chess_es1,chess_sb1,chess_lion1,chess_naga1,chess_earth1,chess_razor1,chess_ss1,",
        "mvp_chess_damage": 2216.894287109375,
        "mvp_chess_name": "chess_tusk1",
        "mvp_chess_items": "",
        "pandaman_getlist": {
          "1": "chess_earth_3",
          "2": "chess_pom_6",
          "3": "chess_brew_11",
          "4": "chess_pom_14",
          "5": "chess_brew_15",
          "6": "chess_earth_21",
          "7": "chess_brew_25",
          "8": "chess_earth_29"
        },
        "delta": 77,
        "steam_id": "steam_id_2",
        "level_delta": 1,
        "relic": "item_stolen_vault",
        "player_id": 6,
        "team_id": 12,
        "is_author": 0,
        "curr_rank": 4,
        "hp": 0,
        "duration": 2034.5999755859375,
        "rank": 4,
        "zhugong": "h110",
        "zhugong_model": "models/items/courier/jumo/jumo.vmdl",
        "zhugong_effect": "e000",
        "round": 33,
        "win_round": 11,
        "lose_round": 13,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_pandaman",
          "2": "is_tauren",
          "3": "is_kobold",
          "4": "is_shaman",
          "5": "is_wizard",
          "6": "is_shaman1"
        },
        "chess_lineup": "chess_es1,chess_bs1,chess_aw,chess_sb1,chess_lion1,chess_naga1,chess_earth1,chess_razor1,chess_ss1,",
        "chess_hand": "chess_razor,chess_razor,chess_es,chess_bs,chess_es,chess_es1,",
        "biscuit": 0,
        "hero_level": 9,
        "buff": "is_shaman:6,is_wizard:2,is_kobold:2,is_tauren:2,is_assassin:1,is_pandaman:1,is_demon:1,is_element:1,is_naga:1,is_orc:1,is_troll:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 115,
        "hero_damaged": 110,
        "max_lineup_value": 72,
        "total_money": 311,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 19,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_mangotree",
            "round": 11
          },
          "2": {
            "relic": "item_free_draw",
            "round": 21
          },
          "3": {
            "relic": "item_stolen_vault",
            "round": 31
          }
        },
        "talent_tree": {
          "1": "talent_1a_winbonus",
          "2": "talent_2b_promotion",
          "3": "talent_3a_healdamage"
        }
      },
      "steam_id_3": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67048,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 83,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_jugg1,chess_axe1,chess_chen,chess_wl,chess_enigma1,chess_au1,chess_bm1,chess_ok,chess_sf11,chess_dazzle1,",
        "mvp_chess_damage": 3359.786376953125,
        "mvp_chess_name": "chess_jugg1",
        "mvp_chess_items": "item_rengu,item_suiluchui,item_jipin",
        "pandaman_getlist": {
          "1": "chess_tb_5",
          "2": "chess_ck_8",
          "3": "chess_huskar_9",
          "4": "chess_void_17"
        },
        "delta": 74,
        "steam_id": "steam_id_3",
        "level_delta": 1,
        "relic": "item_rank_damage",
        "player_id": 3,
        "team_id": 10,
        "is_author": 0,
        "curr_rank": 5,
        "hp": 0,
        "duration": 1957.86669921875,
        "rank": 5,
        "zhugong": "h225",
        "zhugong_model": "models/items/courier/little_fraid_the_courier_of_simons_retribution/little_fraid_the_courier_of_simons_retribution.vmdl",
        "zhugong_effect": "e000",
        "round": 32,
        "win_round": 4,
        "lose_round": 19,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_priest",
          "2": "is_warlock1",
          "3": "is_warlock",
          "4": "is_orc",
          "5": "is_orc1"
        },
        "chess_lineup": "chess_jugg1,chess_axe1,chess_chen,chess_wl,chess_enigma1,chess_au1,chess_bm1,chess_ok,chess_sf11,chess_dazzle1,",
        "chess_hand": "chess_ga,chess_wl,chess_ok,chess_ga1,chess_qop,chess_qop,chess_enigma,chess_ga,",
        "biscuit": 0,
        "hero_level": 10,
        "buff": "is_orc:5,is_warlock:4,is_priest:2,is_warrior:2,is_demon:2,is_knight:1,is_hunter:1,is_element:1,is_human:1,is_troll:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 13,
        "hero_damaged": 182,
        "max_lineup_value": 83,
        "total_money": 285,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 0,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_egg",
            "round": 11
          },
          "2": {
            "relic": "item_malefic_rapture",
            "round": 21
          },
          "3": {
            "relic": "item_rank_damage",
            "round": 32
          }
        },
        "talent_tree": {
          "1": "talent_1b_losebonus",
          "2": "talent_2b_promotion",
          "3": "talent_3a_healdamage"
        }
      },
      "steam_id_4": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67129,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 34,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_sniper1,chess_brew1,chess_medusa,chess_wr1,chess_pom1,chess_bm1,chess_bh1,chess_hw1,",
        "mvp_chess_damage": 2472.953857421875,
        "mvp_chess_name": "chess_hw1",
        "mvp_chess_items": "item_wangyuanjing",
        "pandaman_getlist": {
          "1": "chess_fur_13",
          "2": "chess_clock_16",
          "3": "chess_am_20"
        },
        "delta": -138,
        "level_delta": -2,
        "steam_id": "steam_id_4",
        "candy_award": 0,
        "relic": "item_stolen_vault",
        "player_id": 2,
        "team_id": 6,
        "is_author": 0,
        "curr_rank": 8,
        "hp": 0,
        "duration": 1437.2667236328125,
        "rank": 8,
        "zhugong": "h318",
        "zhugong_model": "models/courier/baby_rosh/babyroshan.vmdl",
        "zhugong_effect": "e000",
        "round": 24,
        "win_round": 6,
        "lose_round": 11,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_dwarf",
          "2": "is_pandaman",
          "3": "is_hunter1",
          "4": "is_hunter"
        },
        "chess_lineup": "chess_sniper1,chess_brew1,chess_medusa,chess_wr1,chess_pom1,chess_bm1,chess_bh1,chess_hw1,",
        "chess_hand": "chess_bm,chess_hw,chess_sniper,chess_hw,chess_medusa,chess_pom1,chess_bh1,chess_hw1,",
        "biscuit": 0,
        "hero_level": 8,
        "buff": "is_hunter:7,is_dwarf:2,is_elf:2,is_monk:1,is_draenei:1,is_pandaman:1,is_goblin:1,is_naga:1,is_orc:1,is_beast:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 57,
        "hero_damaged": 86,
        "max_lineup_value": 34,
        "total_money": 243,
        "block_team": {},
        "ban_synergy": "is_knight",
        "mmr_level": 18,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_double_coin",
            "round": 11
          },
          "2": {
            "relic": "item_stolen_vault",
            "round": 21
          }
        },
        "talent_tree": {
          "1": "talent_1a_winbonus",
          "2": "talent_2a_discount"
        }
      },
      "steam_id_5": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67132,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 150,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_brew1,chess_void1,chess_void11,chess_sk1,chess_veno,chess_meepo1,chess_void1,chess_br11,chess_aw1,chess_veno1,chess_sk1,",
        "mvp_chess_damage": 14880.3466796875,
        "mvp_chess_name": "chess_void11",
        "mvp_chess_items": "item_dongchayandou,item_kuangzhanfu,item_xuanmingdunpai",
        "pandaman_getlist": {
          "1": "chess_void_3",
          "2": "chess_void_5",
          "3": "chess_void_7",
          "4": "chess_void_8",
          "5": "chess_enigma_9",
          "6": "chess_void_9",
          "7": "chess_lina_15",
          "8": "chess_brew_16",
          "9": "chess_brew_17",
          "10": "chess_void_18",
          "11": "chess_void_18",
          "12": "chess_void_19",
          "13": "chess_void_19",
          "14": "chess_void_20",
          "15": "chess_void_21",
          "16": "chess_brew_25",
          "17": "chess_brew_26",
          "18": "chess_dk_28",
          "19": "chess_void_31",
          "20": "chess_void_34",
          "21": "chess_void_35",
          "22": "chess_void_37",
          "23": "chess_brew_38",
          "24": "chess_storm_42",
          "25": "chess_brew_43"
        },
        "delta": 42,
        "steam_id": "steam_id_5",
        "level_delta": 1,
        "relic": "item_stolen_vault",
        "player_id": 7,
        "team_id": 11,
        "is_author": 0,
        "curr_rank": 2,
        "hp": 0,
        "duration": 2780.1669921875,
        "rank": 2,
        "zhugong": "h291",
        "zhugong_model": "models/nanguashenshi/nanguashenshi.vmdl",
        "zhugong_effect": "e416",
        "round": 44,
        "win_round": 27,
        "lose_round": 6,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_aqir1",
          "2": "is_pandaman",
          "3": "is_kobold",
          "4": "is_monk",
          "5": "is_aqir",
          "6": "is_pandaman1"
        },
        "chess_lineup": "chess_brew1,chess_void1,chess_void11,chess_sk1,chess_veno,chess_meepo1,chess_void1,chess_br11,chess_aw1,chess_veno1,chess_sk1,",
        "chess_hand": "chess_veno,",
        "biscuit": 0,
        "hero_level": 11,
        "buff": "is_aqir:4,is_monk:2,is_kobold:2,is_pandaman:2,is_shaman:1,is_hunter:1,is_assassin:1,is_mech:1,is_warlock:1,is_beast:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 289,
        "hero_damaged": 77,
        "max_lineup_value": 150,
        "total_money": 521,
        "block_team": {},
        "candy_award": 1,
        "mmr_level": 20,
        "candy": 1,
        "relic_history": {
          "1": {
            "relic": "item_egg",
            "round": 11
          },
          "2": {
            "relic": "item_rank_damage",
            "round": 21
          },
          "3": {
            "relic": "item_double_coin",
            "round": 31
          },
          "4": {
            "relic": "item_stolen_vault",
            "round": 41
          }
        },
        "talent_tree": {
          "1": "talent_1a_winbonus",
          "2": "talent_2b_promotion",
          "3": "talent_3b_lessdamage",
          "4": "talent_4b_morepieces"
        }
      },
      "steam_id_6": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67046,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 2,
          "candy_added_limit_total": 10
        },
        "lineup_value": 142,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_dk1,chess_tb11,chess_am1,chess_lion1,chess_lc1,chess_doom1,chess_au1,chess_ck1,chess_th,chess_ok,chess_sf11,",
        "mvp_chess_damage": 8506.2001953125,
        "mvp_chess_name": "chess_sf11",
        "mvp_chess_items": "",
        "pandaman_getlist": {
          "1": "chess_sd_14"
        },
        "delta": 62,
        "steam_id": "steam_id_6",
        "level_delta": 0,
        "relic": "item_rank_damage",
        "player_id": 5,
        "team_id": 13,
        "is_author": 0,
        "curr_rank": 1,
        "hp": 49,
        "duration": 2779.1669921875,
        "rank": 0,
        "zhugong": "h204",
        "zhugong_model": "models/courier/seekling/seekling.vmdl",
        "zhugong_effect": "e000",
        "round": 44,
        "win_round": 25,
        "lose_round": 7,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_demon",
          "2": "is_demonhunter",
          "3": "is_knight1",
          "4": "is_human",
          "5": "is_warlock",
          "6": "is_knight"
        },
        "chess_lineup": "chess_dk1,chess_tb11,chess_am1,chess_lion1,chess_lc1,chess_doom1,chess_au1,chess_ck1,chess_th,chess_ok,chess_sf11,",
        "chess_hand": "chess_ck1,chess_ck,chess_doom1,chess_au,chess_ok,chess_th,chess_am,chess_luna1,",
        "biscuit": 0,
        "hero_level": 11,
        "buff": "is_demon:6,is_knight:4,is_human:3,is_demonhunter:2,is_warlock:2,is_wizard:1,is_hunter:1,is_warrior:1,is_dragon:1,is_naga:1,is_elf:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 226,
        "hero_damaged": 92,
        "max_lineup_value": 142,
        "total_money": 456,
        "block_team": {},
        "candy_award": 5,
        "mmr_level": 19,
        "candy": 5,
        "relic_history": {
          "1": {
            "relic": "item_egg",
            "round": 11
          },
          "2": {
            "relic": "item_repeat_relic",
            "round": 21
          },
          "3": {
            "relic": "item_free_draw",
            "round": 31
          },
          "4": {
            "relic": "item_rank_damage",
            "round": 41
          }
        },
        "talent_tree": {
          "1": "talent_1a_winbonus",
          "2": "talent_2b_promotion",
          "3": "talent_3a_healdamage",
          "4": "talent_4b_morepieces"
        }
      },
      "steam_id_7": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67083,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 3,
          "candy_added_limit_total": 10
        },
        "lineup_value": 46,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_bm1,chess_et1,chess_ld1,chess_mag1,chess_sniper1,chess_tusk,chess_hw1,chess_eh1,",
        "mvp_chess_damage": 2321.5556640625,
        "mvp_chess_name": "chess_bm1",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "delta": -12,
        "level_delta": 0,
        "steam_id": "steam_id_7",
        "relic": "item_streak_plus",
        "candy_award": 0,
        "player_id": 4,
        "team_id": 9,
        "is_author": 0,
        "curr_rank": 7,
        "hp": 0,
        "duration": 1496.0,
        "rank": 7,
        "zhugong": "h313",
        "zhugong_model": "models/courier/defense3_sheep/defense3_sheep.vmdl",
        "zhugong_effect": "e000",
        "round": 25,
        "win_round": 5,
        "lose_round": 13,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_centaur",
          "2": "is_druid",
          "3": "is_hunter",
          "4": "is_beast",
          "5": "is_beast1"
        },
        "chess_lineup": "chess_bm1,chess_et1,chess_ld1,chess_mag1,chess_sniper1,chess_tusk,chess_hw1,chess_eh1,",
        "chess_hand": "chess_eh,chess_lyc,chess_tusk,chess_io,chess_ok,chess_veno,chess_veno,chess_tp1,",
        "biscuit": 0,
        "hero_level": 8,
        "buff": "is_beast:4,is_druid:3,is_hunter:3,is_centaur:2,is_assassin:1,is_warrior:1,is_tauren:1,is_god:1,is_dwarf:1,is_orc:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 64,
        "hero_damaged": 108,
        "max_lineup_value": 46,
        "total_money": 195,
        "block_team": {},
        "ban_synergy": "is_element",
        "mmr_level": 0,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_malefic_rapture",
            "round": 12
          },
          "2": {
            "relic": "item_streak_plus",
            "round": 21
          }
        },
        "talent_tree": {
          "1": "talent_1b_losebonus",
          "2": "talent_2b_promotion"
        }
      }
    },
    "hehe": 25519
  }
}
```

### `CustomNetTable_player_info_table`

Full decoded snapshot from `20260604_230953_76561198022169086/raw_dumps.jsonl.gz`.
Steam IDs are anonymized, but the table is otherwise not truncated.

```json
{
  "player_info": {
    "data": {
      "steam_id_0": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67134,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 66,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_chen,chess_ld,chess_ld,chess_pangolier1,chess_veno1,chess_pangolier1,chess_chen,chess_th,chess_snap1,",
        "mvp_chess_damage": 3230.23828125,
        "mvp_chess_name": "chess_pangolier1",
        "mvp_chess_items": "",
        "pandaman_getlist": {
          "1": "chess_ss_13",
          "2": "chess_shredder_21",
          "3": "chess_pangolier_22"
        },
        "delta": -98,
        "level_delta": -1,
        "steam_id": "steam_id_0",
        "candy_award": 0,
        "relic": "item_egg",
        "player_id": 1,
        "team_id": 7,
        "is_author": 0,
        "curr_rank": 6,
        "hp": 0,
        "duration": 1637.36669921875,
        "rank": 6,
        "zhugong": "h421",
        "zhugong_model": "models/items/courier/onibi_lvl_21/onibi_lvl_21.vmdl",
        "zhugong_effect": "e000",
        "round": 27,
        "win_round": 6,
        "lose_round": 13,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_beast",
          "2": "is_aqir"
        },
        "chess_lineup": "chess_chen,chess_ld,chess_ld,chess_pangolier1,chess_veno1,chess_pangolier1,chess_chen,chess_th,chess_snap1,",
        "chess_hand": "chess_doom,chess_tb,chess_am,chess_sf,chess_sf,chess_qop1,chess_am,chess_doom,",
        "biscuit": 0,
        "hero_level": 9,
        "buff": "is_beast:3,is_aqir:2,is_druid:1,is_priest:1,is_knight:1,is_hunter:1,is_assassin:1,is_warlock:1,is_goblin:1,is_naga:1,is_orc:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 52,
        "hero_damaged": 141,
        "max_lineup_value": 66,
        "total_money": 243,
        "block_team": {},
        "ban_synergy": "is_ogre",
        "mmr_level": 20,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_malefic_rapture",
            "round": 12
          },
          "2": {
            "relic": "item_egg",
            "round": 21
          }
        },
        "talent_tree": {
          "1": "talent_1b_losebonus",
          "2": "talent_2b_promotion",
          "3": "talent_3a_healdamage"
        }
      },
      "steam_id_1": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67111,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 89,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_riki1,chess_doom1,chess_ss11,chess_mag1,chess_eh1,chess_tusk11,chess_kez1,chess_bane11,chess_wd11,chess_sm11,",
        "mvp_chess_damage": 9958.9501953125,
        "mvp_chess_name": "chess_doom1",
        "mvp_chess_items": "item_fashulengjing,item_huiguang,item_huiyao,item_hongzhang",
        "pandaman_getlist": {
          "1": "chess_wd_9",
          "2": "chess_storm_27"
        },
        "delta": 22,
        "level_delta": 0,
        "steam_id": "steam_id_1",
        "candy_award": 1,
        "relic": "item_egg",
        "player_id": 0,
        "team_id": 8,
        "is_author": 0,
        "curr_rank": 3,
        "hp": 0,
        "duration": 2646.266845703125,
        "rank": 3,
        "zhugong": "h416",
        "zhugong_model": "models/items/courier/krobeling/krobeling.vmdl",
        "zhugong_effect": "e000",
        "round": 42,
        "win_round": 14,
        "lose_round": 17,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_satyr",
          "2": "is_centaur",
          "3": "is_harpy",
          "4": "is_troll",
          "5": "is_warlock",
          "6": "is_assassin",
          "7": "is_beast"
        },
        "chess_lineup": "chess_riki1,chess_doom1,chess_ss11,chess_mag1,chess_eh1,chess_tusk11,chess_kez1,chess_bane11,chess_wd11,chess_sm11,",
        "chess_hand": "egg,chess_doom,chess_kez1,",
        "biscuit": 0,
        "hero_level": 10,
        "buff": "is_assassin:3,is_warlock:2,is_warrior:2,is_harpy:2,is_centaur:2,is_satyr:2,is_beast:2,is_troll:2,is_druid:1,is_shaman:1,is_mage:1,is_nraqi:1,is_demon:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 146,
        "hero_damaged": 166,
        "max_lineup_value": 89,
        "total_money": 452,
        "block_team": {},
        "ban_synergy": "is_goblin",
        "mmr_level": 22,
        "candy": 1,
        "relic_history": {
          "1": {
            "relic": "item_stolen_vault",
            "round": 12
          },
          "2": {
            "relic": "item_free_draw",
            "round": 21
          },
          "3": {
            "relic": "item_rank_damage",
            "round": 31
          },
          "4": {
            "relic": "item_egg",
            "round": 41
          }
        },
        "talent_tree": {
          "1": "talent_1b_losebonus",
          "2": "talent_2a_discount",
          "3": "talent_3a_healdamage",
          "4": "talent_4a_moreio"
        }
      },
      "steam_id_2": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67111,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 68,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_es1,chess_bs1,chess_es1,chess_sb1,chess_lion1,chess_naga1,chess_earth1,chess_razor1,chess_ss1,",
        "mvp_chess_damage": 2216.894287109375,
        "mvp_chess_name": "chess_tusk1",
        "mvp_chess_items": "",
        "pandaman_getlist": {
          "1": "chess_earth_3",
          "2": "chess_pom_6",
          "3": "chess_brew_11",
          "4": "chess_pom_14",
          "5": "chess_brew_15",
          "6": "chess_earth_21",
          "7": "chess_brew_25",
          "8": "chess_earth_29"
        },
        "delta": 77,
        "steam_id": "steam_id_2",
        "level_delta": 1,
        "relic": "item_stolen_vault",
        "player_id": 6,
        "team_id": 12,
        "is_author": 0,
        "curr_rank": 4,
        "hp": 0,
        "duration": 2034.5999755859375,
        "rank": 4,
        "zhugong": "h110",
        "zhugong_model": "models/items/courier/jumo/jumo.vmdl",
        "zhugong_effect": "e000",
        "round": 33,
        "win_round": 11,
        "lose_round": 13,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_pandaman",
          "2": "is_tauren",
          "3": "is_kobold",
          "4": "is_shaman",
          "5": "is_wizard",
          "6": "is_shaman1"
        },
        "chess_lineup": "chess_es1,chess_bs1,chess_aw,chess_sb1,chess_lion1,chess_naga1,chess_earth1,chess_razor1,chess_ss1,",
        "chess_hand": "chess_razor,chess_razor,chess_es,chess_bs,chess_es,chess_es1,",
        "biscuit": 0,
        "hero_level": 9,
        "buff": "is_shaman:6,is_wizard:2,is_kobold:2,is_tauren:2,is_assassin:1,is_pandaman:1,is_demon:1,is_element:1,is_naga:1,is_orc:1,is_troll:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 115,
        "hero_damaged": 110,
        "max_lineup_value": 72,
        "total_money": 311,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 19,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_mangotree",
            "round": 11
          },
          "2": {
            "relic": "item_free_draw",
            "round": 21
          },
          "3": {
            "relic": "item_stolen_vault",
            "round": 31
          }
        },
        "talent_tree": {
          "1": "talent_1a_winbonus",
          "2": "talent_2b_promotion",
          "3": "talent_3a_healdamage"
        }
      },
      "steam_id_3": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67048,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 83,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_jugg1,chess_axe1,chess_chen,chess_wl,chess_enigma1,chess_au1,chess_bm1,chess_ok,chess_sf11,chess_dazzle1,",
        "mvp_chess_damage": 3359.786376953125,
        "mvp_chess_name": "chess_jugg1",
        "mvp_chess_items": "item_rengu,item_suiluchui,item_jipin",
        "pandaman_getlist": {
          "1": "chess_tb_5",
          "2": "chess_ck_8",
          "3": "chess_huskar_9",
          "4": "chess_void_17"
        },
        "delta": 74,
        "steam_id": "steam_id_3",
        "level_delta": 1,
        "relic": "item_rank_damage",
        "player_id": 3,
        "team_id": 10,
        "is_author": 0,
        "curr_rank": 5,
        "hp": 0,
        "duration": 1957.86669921875,
        "rank": 5,
        "zhugong": "h225",
        "zhugong_model": "models/items/courier/little_fraid_the_courier_of_simons_retribution/little_fraid_the_courier_of_simons_retribution.vmdl",
        "zhugong_effect": "e000",
        "round": 32,
        "win_round": 4,
        "lose_round": 19,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_priest",
          "2": "is_warlock1",
          "3": "is_warlock",
          "4": "is_orc",
          "5": "is_orc1"
        },
        "chess_lineup": "chess_jugg1,chess_axe1,chess_chen,chess_wl,chess_enigma1,chess_au1,chess_bm1,chess_ok,chess_sf11,chess_dazzle1,",
        "chess_hand": "chess_ga,chess_wl,chess_ok,chess_ga1,chess_qop,chess_qop,chess_enigma,chess_ga,",
        "biscuit": 0,
        "hero_level": 10,
        "buff": "is_orc:5,is_warlock:4,is_priest:2,is_warrior:2,is_demon:2,is_knight:1,is_hunter:1,is_element:1,is_human:1,is_troll:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 13,
        "hero_damaged": 182,
        "max_lineup_value": 83,
        "total_money": 285,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 0,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_egg",
            "round": 11
          },
          "2": {
            "relic": "item_malefic_rapture",
            "round": 21
          },
          "3": {
            "relic": "item_rank_damage",
            "round": 32
          }
        },
        "talent_tree": {
          "1": "talent_1b_losebonus",
          "2": "talent_2b_promotion",
          "3": "talent_3a_healdamage"
        }
      },
      "steam_id_4": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67129,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 34,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_sniper1,chess_brew1,chess_medusa,chess_wr1,chess_pom1,chess_bm1,chess_bh1,chess_hw1,",
        "mvp_chess_damage": 2472.953857421875,
        "mvp_chess_name": "chess_hw1",
        "mvp_chess_items": "item_wangyuanjing",
        "pandaman_getlist": {
          "1": "chess_fur_13",
          "2": "chess_clock_16",
          "3": "chess_am_20"
        },
        "delta": -138,
        "level_delta": -2,
        "steam_id": "steam_id_4",
        "candy_award": 0,
        "relic": "item_stolen_vault",
        "player_id": 2,
        "team_id": 6,
        "is_author": 0,
        "curr_rank": 8,
        "hp": 0,
        "duration": 1437.2667236328125,
        "rank": 8,
        "zhugong": "h318",
        "zhugong_model": "models/courier/baby_rosh/babyroshan.vmdl",
        "zhugong_effect": "e000",
        "round": 24,
        "win_round": 6,
        "lose_round": 11,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_dwarf",
          "2": "is_pandaman",
          "3": "is_hunter1",
          "4": "is_hunter"
        },
        "chess_lineup": "chess_sniper1,chess_brew1,chess_medusa,chess_wr1,chess_pom1,chess_bm1,chess_bh1,chess_hw1,",
        "chess_hand": "chess_bm,chess_hw,chess_sniper,chess_hw,chess_medusa,chess_pom1,chess_bh1,chess_hw1,",
        "biscuit": 0,
        "hero_level": 8,
        "buff": "is_hunter:7,is_dwarf:2,is_elf:2,is_monk:1,is_draenei:1,is_pandaman:1,is_goblin:1,is_naga:1,is_orc:1,is_beast:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 57,
        "hero_damaged": 86,
        "max_lineup_value": 34,
        "total_money": 243,
        "block_team": {},
        "ban_synergy": "is_knight",
        "mmr_level": 18,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_double_coin",
            "round": 11
          },
          "2": {
            "relic": "item_stolen_vault",
            "round": 21
          }
        },
        "talent_tree": {
          "1": "talent_1a_winbonus",
          "2": "talent_2a_discount"
        }
      },
      "steam_id_5": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67132,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 0,
          "candy_added_limit_total": 10
        },
        "lineup_value": 150,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_brew1,chess_void1,chess_void11,chess_sk1,chess_veno,chess_meepo1,chess_void1,chess_br11,chess_aw1,chess_veno1,chess_sk1,",
        "mvp_chess_damage": 14880.3466796875,
        "mvp_chess_name": "chess_void11",
        "mvp_chess_items": "item_dongchayandou,item_kuangzhanfu,item_xuanmingdunpai",
        "pandaman_getlist": {
          "1": "chess_void_3",
          "2": "chess_void_5",
          "3": "chess_void_7",
          "4": "chess_void_8",
          "5": "chess_enigma_9",
          "6": "chess_void_9",
          "7": "chess_lina_15",
          "8": "chess_brew_16",
          "9": "chess_brew_17",
          "10": "chess_void_18",
          "11": "chess_void_18",
          "12": "chess_void_19",
          "13": "chess_void_19",
          "14": "chess_void_20",
          "15": "chess_void_21",
          "16": "chess_brew_25",
          "17": "chess_brew_26",
          "18": "chess_dk_28",
          "19": "chess_void_31",
          "20": "chess_void_34",
          "21": "chess_void_35",
          "22": "chess_void_37",
          "23": "chess_brew_38",
          "24": "chess_storm_42",
          "25": "chess_brew_43"
        },
        "steam_id": "steam_id_5",
        "relic": "item_stolen_vault",
        "player_id": 7,
        "team_id": 11,
        "is_author": 0,
        "curr_rank": 2,
        "hp": 0,
        "duration": 2780.1669921875,
        "rank": 2,
        "zhugong": "h291",
        "zhugong_model": "models/nanguashenshi/nanguashenshi.vmdl",
        "zhugong_effect": "e416",
        "round": 44,
        "win_round": 27,
        "lose_round": 6,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_aqir1",
          "2": "is_pandaman",
          "3": "is_kobold",
          "4": "is_monk",
          "5": "is_aqir",
          "6": "is_pandaman1"
        },
        "chess_lineup": "chess_brew1,chess_void1,chess_void11,chess_sk1,chess_veno,chess_meepo1,chess_void1,chess_br11,chess_aw1,chess_veno1,chess_sk1,",
        "chess_hand": "chess_veno,",
        "biscuit": 0,
        "hero_level": 11,
        "buff": "is_aqir:4,is_monk:2,is_kobold:2,is_pandaman:2,is_shaman:1,is_hunter:1,is_assassin:1,is_mech:1,is_warlock:1,is_beast:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 289,
        "hero_damaged": 77,
        "max_lineup_value": 150,
        "total_money": 521,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 19,
        "candy": 269,
        "relic_history": {
          "1": {
            "relic": "item_egg",
            "round": 11
          },
          "2": {
            "relic": "item_rank_damage",
            "round": 21
          },
          "3": {
            "relic": "item_double_coin",
            "round": 31
          },
          "4": {
            "relic": "item_stolen_vault",
            "round": 41
          }
        },
        "talent_tree": {
          "1": "talent_1a_winbonus",
          "2": "talent_2b_promotion",
          "3": "talent_3b_lessdamage",
          "4": "talent_4b_morepieces"
        }
      },
      "steam_id_6": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67046,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 2,
          "candy_added_limit_total": 10
        },
        "lineup_value": 142,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_dk1,chess_tb11,chess_am1,chess_lion1,chess_lc1,chess_doom1,chess_au1,chess_ck1,chess_th,chess_ok,chess_sf11,",
        "mvp_chess_damage": 8506.2001953125,
        "mvp_chess_name": "chess_sf11",
        "mvp_chess_items": "",
        "pandaman_getlist": {
          "1": "chess_sd_14"
        },
        "steam_id": "steam_id_6",
        "relic": "item_rank_damage",
        "player_id": 5,
        "team_id": 13,
        "is_author": 0,
        "curr_rank": 1,
        "hp": 49,
        "duration": 2779.1669921875,
        "rank": 0,
        "zhugong": "h204",
        "zhugong_model": "models/courier/seekling/seekling.vmdl",
        "zhugong_effect": "e000",
        "round": 44,
        "win_round": 25,
        "lose_round": 7,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_demon",
          "2": "is_demonhunter",
          "3": "is_knight1",
          "4": "is_human",
          "5": "is_warlock",
          "6": "is_knight"
        },
        "chess_lineup": "chess_dk1,chess_tb11,chess_am1,chess_lion1,chess_lc1,chess_doom1,chess_au1,chess_ck1,chess_th,chess_ok,chess_sf11,",
        "chess_hand": "chess_ck1,chess_ck,chess_doom1,chess_au,chess_ok,chess_th,chess_am,chess_luna1,",
        "biscuit": 0,
        "hero_level": 11,
        "buff": "is_demon:6,is_knight:4,is_human:3,is_demonhunter:2,is_warlock:2,is_wizard:1,is_hunter:1,is_warrior:1,is_dragon:1,is_naga:1,is_elf:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 226,
        "hero_damaged": 92,
        "max_lineup_value": 142,
        "total_money": 456,
        "block_team": {},
        "candy_award": 0,
        "mmr_level": 19,
        "candy": 351,
        "relic_history": {
          "1": {
            "relic": "item_egg",
            "round": 11
          },
          "2": {
            "relic": "item_repeat_relic",
            "round": 21
          },
          "3": {
            "relic": "item_free_draw",
            "round": 31
          },
          "4": {
            "relic": "item_rank_damage",
            "round": 41
          }
        },
        "talent_tree": {
          "1": "talent_1a_winbonus",
          "2": "talent_2b_promotion",
          "3": "talent_3a_healdamage",
          "4": "talent_4b_morepieces"
        }
      },
      "steam_id_7": {
        "vip_info": {
          "casino_count": 0,
          "is_vip": 0,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "vip_vote_info": {},
          "biscuit_quest_level": 2,
          "biscuit_ttl": 67083,
          "casino_count_total": 5,
          "biscuit_quest": "q020",
          "candy_added_limit": 3,
          "candy_added_limit_total": 10
        },
        "lineup_value": 46,
        "is_vip": 0,
        "max_lineup_value_lineup": "chess_bm1,chess_et1,chess_ld1,chess_mag1,chess_sniper1,chess_tusk,chess_hw1,chess_eh1,",
        "mvp_chess_damage": 2321.5556640625,
        "mvp_chess_name": "chess_bm1",
        "mvp_chess_items": "",
        "pandaman_getlist": {},
        "delta": -12,
        "level_delta": 0,
        "steam_id": "steam_id_7",
        "relic": "item_streak_plus",
        "candy_award": 0,
        "player_id": 4,
        "team_id": 9,
        "is_author": 0,
        "curr_rank": 7,
        "hp": 0,
        "duration": 1496.0,
        "rank": 7,
        "zhugong": "h313",
        "zhugong_model": "models/courier/defense3_sheep/defense3_sheep.vmdl",
        "zhugong_effect": "e000",
        "round": 25,
        "win_round": 5,
        "lose_round": 13,
        "draw_round": 0,
        "kills": 0,
        "deaths": 0,
        "chess_synergies": {
          "1": "is_centaur",
          "2": "is_druid",
          "3": "is_hunter",
          "4": "is_beast",
          "5": "is_beast1"
        },
        "chess_lineup": "chess_bm1,chess_et1,chess_ld1,chess_mag1,chess_sniper1,chess_tusk,chess_hw1,chess_eh1,",
        "chess_hand": "chess_eh,chess_lyc,chess_tusk,chess_io,chess_ok,chess_veno,chess_veno,chess_tp1,",
        "biscuit": 0,
        "hero_level": 8,
        "buff": "is_beast:4,is_druid:3,is_hunter:3,is_centaur:2,is_assassin:1,is_warrior:1,is_tauren:1,is_god:1,is_dwarf:1,is_orc:1,",
        "show_buff": "is_beast:4,is_hunter:3,is_druid:2,is_centaur:2",
        "hero_damage": 64,
        "hero_damaged": 108,
        "max_lineup_value": 46,
        "total_money": 195,
        "block_team": {},
        "ban_synergy": "is_element",
        "mmr_level": 0,
        "candy": 0,
        "relic_history": {
          "1": {
            "relic": "item_malefic_rapture",
            "round": 12
          },
          "2": {
            "relic": "item_streak_plus",
            "round": 21
          }
        },
        "talent_tree": {
          "1": "talent_1b_losebonus",
          "2": "talent_2b_promotion"
        }
      }
    },
    "hehe": 59216
  }
}
```

### `CustomNetTable_game_info`

```json
{
  "round_info": {
    "round": 43
  },
  "death_team": {
    "6": 1,
    "7": 1,
    "8": 1,
    "9": 1,
    "10": 1,
    "11": 1,
    "12": 1,
    "13": 1
  },
  "game_version": {
    "version": "dist"
  },
  "quest": {
    "biscuit_quest": "q020"
  }
}
```

### `CustomNetTable_player_id_table`

Full decoded snapshot from `20260604_230953_76561198022169086/raw_dumps.jsonl.gz`.
This is the whole table from that dump: all 8 slots, including rank/candy,
cosmetic board/courier keys, slot mappings, relic TTLs, and `vchess_<n>` board
state. It is not truncated.

```json
{
  "mmr_level_7": {
    "mmr_level": 19,
    "candy": 269
  },
  "mmr_level_0": {
    "mmr_level": 22,
    "candy": 510
  },
  "mmr_level_6": {
    "mmr_level": 18,
    "candy": 326
  },
  "mmr_level_3": {
    "mmr_level": 0,
    "candy": 128
  },
  "mmr_level_5": {
    "mmr_level": 19,
    "candy": 351
  },
  "mmr_level_2": {
    "mmr_level": 20,
    "candy": 264
  },
  "mmr_level_4": {
    "mmr_level": 0,
    "candy": 95
  },
  "mmr_level_1": {
    "mmr_level": 21,
    "candy": 205
  },
  "chessboard_1": {
    "chessboard": "b106"
  },
  "chessboard_7": {
    "chessboard": "b101"
  },
  "chessboard_3": {
    "chessboard": "b101"
  },
  "chessboard_2": {
    "chessboard": "b101"
  },
  "chessboard_6": {
    "chessboard": "b103"
  },
  "chessboard_4": {
    "chessboard": "b101"
  },
  "chessboard_5": {
    "chessboard": "b106"
  },
  "chessboard_0": {
    "chessboard": "b106"
  },
  "courier_4": {
    "courier": "h313",
    "level": 8,
    "courier_id": "h313_e000_22.70_p000_t000_n000",
    "win_streak": 0
  },
  "player_0": {
    "team_id": 8,
    "hero_index": 240,
    "player_index": 2,
    "player_id": 0
  },
  "player_1": {
    "team_id": 7,
    "hero_index": 208,
    "player_index": 1,
    "player_id": 1
  },
  "player_2": {
    "team_id": 6,
    "hero_index": 368,
    "player_index": 0,
    "player_id": 2
  },
  "player_3": {
    "team_id": 10,
    "hero_index": 432,
    "player_index": 4,
    "player_id": 3
  },
  "player_4": {
    "team_id": 9,
    "hero_index": 272,
    "player_index": 3,
    "player_id": 4
  },
  "player_5": {
    "team_id": 13,
    "hero_index": 400,
    "player_index": 7,
    "player_id": 5
  },
  "player_6": {
    "team_id": 12,
    "hero_index": 304,
    "player_index": 6,
    "player_id": 6
  },
  "player_7": {
    "team_id": 11,
    "hero_index": 336,
    "player_index": 5,
    "player_id": 7
  },
  "courier_5": {
    "courier": "h204",
    "level": 11,
    "courier_id": "h204_e000_30.00_p000_t000_n000",
    "win_streak": 2
  },
  "courier_7": {
    "courier": "h291",
    "level": 11,
    "courier_id": "h291_e416_30.00_p000_t000_n202",
    "win_streak": 0
  },
  "courier_1": {
    "courier": "h421",
    "level": 9,
    "courier_id": "h421_e000_29.20_p000_t000_n000",
    "win_streak": 0
  },
  "courier_0": {
    "courier": "h416",
    "level": 10,
    "courier_id": "h416_e000_30.00_p000_t000_n000",
    "win_streak": 0
  },
  "courier_2": {
    "courier": "h318",
    "level": 8,
    "courier_id": "h318_e000_30.00_p000_t000_n000",
    "win_streak": 0
  },
  "courier_6": {
    "courier": "h110",
    "level": 9,
    "courier_id": "h110_e000_30.00_p000_t000_n000",
    "win_streak": 0
  },
  "courier_3": {
    "courier": "h225",
    "level": 10,
    "courier_id": "h225_e000_25.60_p000_t000_n000",
    "win_streak": 0
  },
  "vchess_7": {
    "4_6": {
      "index": 1341,
      "water_id": 32,
      "chess": "chess_brew1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_xingyunguazhui"
      },
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 6,
      "item": {}
    },
    "4_5": {
      "index": 1163,
      "water_id": 70,
      "chess": "chess_void1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_xingyunguazhui",
        "2": "item_wangchongtui"
      },
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "4_4": {
      "index": 3534,
      "water_id": 45,
      "chess": "chess_void11",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_dongchayandou",
        "2": "item_hudie",
        "3": "item_kuangzhanfu",
        "4": "item_xuanwo",
        "5": "item_wangzhezhijie",
        "6": "item_xingyunguazhui",
        "7": "item_moping"
      },
      "buy_price": 18,
      "xuejingshi_count": 0,
      "x": 4,
      "item": {}
    },
    "1_8": {
      "index": 2798,
      "water_id": 59,
      "chess": "chess_sk1",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "2_1": {
      "index": 3202,
      "lastitem": {},
      "buy_price": 3,
      "water_id": 64,
      "chess": "chess_veno",
      "item": {},
      "x": 1,
      "y": 2
    },
    "4_8": {
      "index": 2384,
      "water_id": 83,
      "chess": "chess_meepo1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "4_1": {
      "index": 495,
      "water_id": 78,
      "chess": "chess_void1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 1,
      "item": {}
    },
    "4_3": {
      "index": 3444,
      "water_id": 87,
      "chess": "chess_br11",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 25,
      "xuejingshi_count": 0,
      "x": 3,
      "item": {}
    },
    "2_7": {
      "index": 1421,
      "water_id": 89,
      "chess": "chess_aw1",
      "grow_count": 0,
      "press_count": 0,
      "y": 2,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 15,
      "xuejingshi_count": 0,
      "x": 7,
      "item": {}
    },
    "2_4": {
      "index": 2833,
      "water_id": 62,
      "chess": "chess_veno1",
      "grow_count": 0,
      "press_count": 0,
      "y": 2,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 9,
      "xuejingshi_count": 0,
      "x": 4,
      "item": {}
    },
    "1_1": {
      "index": 239,
      "water_id": 79,
      "chess": "chess_sk1",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 9,
      "xuejingshi_count": 0,
      "x": 1,
      "item": {}
    }
  },
  "vchess_1": {
    "1_3": {
      "index": 1282,
      "lastitem": {},
      "buy_price": 4,
      "water_id": 50,
      "chess": "chess_chen",
      "item": {},
      "x": 3,
      "y": 1
    },
    "4_2": {
      "index": 3079,
      "buy_price": 4,
      "water_id": 60,
      "chess": "chess_ld",
      "item": {},
      "x": 2,
      "y": 4
    },
    "3_1": {
      "index": 1251,
      "buy_price": 4,
      "water_id": 63,
      "chess": "chess_ld",
      "item": {},
      "x": 1,
      "y": 3
    },
    "1_5": {
      "index": 2603,
      "water_id": 54,
      "chess": "chess_pangolier1",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_anmie",
        "2": "item_wuzhixiaomao",
        "3": "item_lilianghuwan"
      },
      "buy_price": 10,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "2_5": {
      "index": 1515,
      "water_id": 62,
      "chess": "chess_veno1",
      "grow_count": 0,
      "press_count": 0,
      "y": 2,
      "changdun_count": 0,
      "buy_price": 9,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "4_3": {
      "index": 3326,
      "water_id": 58,
      "chess": "chess_pangolier1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 12,
      "xuejingshi_count": 0,
      "x": 3,
      "item": {}
    },
    "1_7": {
      "index": 897,
      "lastitem": {
        "1": "item_wangchongtui"
      },
      "buy_price": 4,
      "water_id": 31,
      "chess": "chess_chen",
      "item": {},
      "x": 7,
      "y": 1
    },
    "4_4": {
      "index": 2309,
      "buy_price": 5,
      "water_id": 66,
      "chess": "chess_th",
      "item": {},
      "x": 4,
      "y": 4
    },
    "1_8": {
      "index": 1980,
      "water_id": 51,
      "chess": "chess_snap1",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 12,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    }
  },
  "vchess_6": {
    "4_6": {
      "index": 2047,
      "water_id": 50,
      "chess": "chess_es1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_moping"
      },
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 6,
      "item": {}
    },
    "4_5": {
      "index": 2620,
      "water_id": 61,
      "chess": "chess_bs1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 4,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "3_7": {
      "index": 766,
      "lastitem": {},
      "buy_price": 5,
      "water_id": 85,
      "chess": "chess_aw",
      "item": {},
      "x": 7,
      "y": 3
    },
    "1_5": {
      "index": 2521,
      "water_id": 32,
      "chess": "chess_sb1",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "3_5": {
      "index": 697,
      "water_id": 70,
      "chess": "chess_lion1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 12,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "4_8": {
      "index": 2342,
      "water_id": 65,
      "chess": "chess_naga1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "4_7": {
      "index": 2237,
      "water_id": 81,
      "chess": "chess_earth1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_moping"
      },
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 7,
      "item": {}
    },
    "4_3": {
      "index": 1810,
      "water_id": 57,
      "chess": "chess_razor1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 9,
      "xuejingshi_count": 0,
      "x": 3,
      "item": {}
    },
    "3_3": {
      "index": 1845,
      "water_id": 78,
      "chess": "chess_ss1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_tiaodao",
        "2": "item_xiwa"
      },
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 3,
      "item": {}
    }
  },
  "vchess_3": {
    "4_2": {
      "index": 2031,
      "water_id": 36,
      "chess": "chess_jugg1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_rengu",
        "2": "item_suiluchui",
        "3": "item_jipin"
      },
      "buy_price": 4,
      "xuejingshi_count": 0,
      "x": 2,
      "item": {}
    },
    "4_6": {
      "index": 3559,
      "water_id": 31,
      "chess": "chess_axe1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 6,
      "item": {}
    },
    "1_4": {
      "index": 367,
      "lastitem": {},
      "buy_price": 4,
      "water_id": 37,
      "chess": "chess_chen",
      "item": {},
      "x": 4,
      "y": 1
    },
    "2_4": {
      "index": 2338,
      "lastitem": {},
      "buy_price": 5,
      "water_id": 49,
      "chess": "chess_wl",
      "item": {},
      "x": 4,
      "y": 2
    },
    "3_6": {
      "index": 3012,
      "chess": "chess_enigma1",
      "grow_count": 0,
      "item": {},
      "xuejingshi_count": 0,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 9,
      "y": 3,
      "press_count": 0,
      "x": 6
    },
    "3_7": {
      "index": 1992,
      "water_id": 58,
      "chess": "chess_au1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "buy_price": 15,
      "xuejingshi_count": 0,
      "x": 7,
      "item": {}
    },
    "2_6": {
      "index": 632,
      "water_id": 38,
      "chess": "chess_bm1",
      "grow_count": 0,
      "press_count": 0,
      "y": 2,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_linglichangbian"
      },
      "buy_price": 4,
      "xuejingshi_count": 0,
      "x": 6,
      "item": {}
    },
    "4_4": {
      "index": 2417,
      "lastitem": {
        "1": "item_chihongjia"
      },
      "buy_price": 5,
      "water_id": 43,
      "chess": "chess_ok",
      "item": {},
      "x": 4,
      "y": 4
    },
    "3_4": {
      "index": 3175,
      "water_id": 51,
      "chess": "chess_sf11",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_konglingguajian"
      },
      "buy_price": 9,
      "xuejingshi_count": 0,
      "x": 4,
      "item": {}
    },
    "3_3": {
      "index": 3445,
      "water_id": 10,
      "chess": "chess_dazzle1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_moping"
      },
      "buy_price": 2,
      "xuejingshi_count": 0,
      "x": 3,
      "item": {}
    }
  },
  "vchess_0": {
    "4_5": {
      "index": 2651,
      "water_id": 93,
      "chess": "chess_riki1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 5,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "2_4": {
      "index": 3114,
      "water_id": 86,
      "chess": "chess_doom1",
      "grow_count": 0,
      "press_count": 0,
      "y": 2,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_fashulengjing",
        "2": "item_huiguang",
        "3": "item_huiyao",
        "4": "item_hongzhang"
      },
      "buy_price": 10,
      "xuejingshi_count": 0,
      "x": 4,
      "item": {}
    },
    "3_8": {
      "index": 3068,
      "water_id": 64,
      "chess": "chess_ss11",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 1,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "4_4": {
      "index": 3447,
      "water_id": 89,
      "chess": "chess_mag1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 10,
      "xuejingshi_count": 0,
      "x": 4,
      "item": {}
    },
    "4_8": {
      "index": 2545,
      "water_id": 85,
      "chess": "chess_eh1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 1,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "4_3": {
      "index": 3073,
      "water_id": 70,
      "chess": "chess_tusk11",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 1,
      "xuejingshi_count": 0,
      "x": 3,
      "item": {}
    },
    "1_4": {
      "index": 2761,
      "water_id": 52,
      "chess": "chess_kez1",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 5,
      "xuejingshi_count": 0,
      "x": 4,
      "item": {}
    },
    "1_8": {
      "index": 1509,
      "water_id": 69,
      "chess": "chess_bane11",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 2,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "3_1": {
      "index": 2891,
      "water_id": 63,
      "chess": "chess_wd11",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 1,
      "item": {}
    },
    "1_1": {
      "index": 3059,
      "water_id": 65,
      "chess": "chess_sm11",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 2,
      "xuejingshi_count": 0,
      "x": 1,
      "item": {}
    }
  },
  "vchess_4": {
    "4_6": {
      "index": 2508,
      "water_id": 35,
      "chess": "chess_bm1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 4,
      "xuejingshi_count": 0,
      "x": 6,
      "item": {}
    },
    "4_5": {
      "index": 1055,
      "water_id": 46,
      "chess": "chess_et1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 6,
      "lastitem": {
        "1": "item_changdun",
        "2": "item_chihongjia"
      },
      "changdun_round": 24,
      "buy_price": 8,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "3_6": {
      "index": 3014,
      "water_id": 48,
      "chess": "chess_ld1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 8,
      "xuejingshi_count": 0,
      "x": 6,
      "item": {}
    },
    "1_4": {
      "index": 617,
      "chess": "chess_mag1",
      "grow_count": 0,
      "item": {},
      "xuejingshi_count": 0,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 12,
      "y": 1,
      "press_count": 0,
      "x": 4
    },
    "3_5": {
      "index": 2113,
      "water_id": 38,
      "chess": "chess_sniper1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 4,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "4_3": {
      "index": 3152,
      "lastitem": {},
      "buy_price": 1,
      "water_id": 1,
      "chess": "chess_tusk",
      "item": {},
      "x": 3,
      "y": 4
    },
    "3_4": {
      "index": 749,
      "water_id": 8,
      "chess": "chess_hw1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 7,
      "lastitem": {},
      "buy_price": 2,
      "xuejingshi_count": 0,
      "x": 4,
      "item": {}
    },
    "3_3": {
      "index": 2353,
      "water_id": 32,
      "chess": "chess_eh1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 2,
      "xuejingshi_count": 0,
      "x": 3,
      "item": {}
    }
  },
  "vchess_5": {
    "4_7": {
      "index": 532,
      "water_id": 64,
      "chess": "chess_dk1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 12,
      "xuejingshi_count": 0,
      "x": 7,
      "item": {}
    },
    "4_6": {
      "index": 2508,
      "water_id": 47,
      "chess": "chess_tb11",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_xueji",
        "2": "item_dongchayandou",
        "3": "item_chihongjia",
        "4": "item_huiyao",
        "5": "item_shuijingjian",
        "6": "item_suiluchui"
      },
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 6,
      "item": {}
    },
    "4_5": {
      "index": 3566,
      "water_id": 69,
      "chess": "chess_am1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 8,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "2_4": {
      "index": 2457,
      "water_id": 76,
      "chess": "chess_lion1",
      "grow_count": 0,
      "press_count": 0,
      "y": 2,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 12,
      "xuejingshi_count": 0,
      "x": 4,
      "item": {}
    },
    "4_1": {
      "index": 1452,
      "water_id": 40,
      "chess": "chess_lc1",
      "grow_count": 0,
      "press_count": 21,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 1,
      "item": {}
    },
    "4_2": {
      "index": 2238,
      "water_id": 68,
      "chess": "chess_doom1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 12,
      "xuejingshi_count": 0,
      "x": 2,
      "item": {}
    },
    "3_2": {
      "index": 724,
      "water_id": 82,
      "chess": "chess_au1",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 15,
      "xuejingshi_count": 0,
      "x": 2,
      "item": {}
    },
    "4_8": {
      "index": 684,
      "water_id": 48,
      "chess": "chess_ck1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 6,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "4_4": {
      "index": 2567,
      "lastitem": {},
      "buy_price": 5,
      "water_id": 54,
      "chess": "chess_th",
      "item": {},
      "x": 4,
      "y": 4
    },
    "4_3": {
      "index": 467,
      "lastitem": {},
      "buy_price": 5,
      "water_id": 78,
      "chess": "chess_ok",
      "item": {},
      "x": 3,
      "y": 4
    },
    "3_7": {
      "index": 2282,
      "water_id": 81,
      "chess": "chess_sf11",
      "grow_count": 0,
      "press_count": 0,
      "y": 3,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 7,
      "item": {}
    }
  },
  "vchess_2": {
    "1_5": {
      "index": 1357,
      "water_id": 57,
      "chess": "chess_sniper1",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "buy_price": 4,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "4_5": {
      "index": 3534,
      "water_id": 51,
      "chess": "chess_brew1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_xingyunguazhui"
      },
      "buy_price": 0,
      "xuejingshi_count": 0,
      "x": 5,
      "item": {}
    },
    "2_7": {
      "index": 2611,
      "lastitem": {},
      "buy_price": 4,
      "water_id": 40,
      "chess": "chess_medusa",
      "item": {},
      "x": 7,
      "y": 2
    },
    "2_3": {
      "index": 692,
      "water_id": 64,
      "chess": "chess_wr1",
      "grow_count": 0,
      "press_count": 0,
      "y": 2,
      "changdun_count": 0,
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 3,
      "item": {}
    },
    "1_8": {
      "index": 1088,
      "water_id": 21,
      "chess": "chess_pom1",
      "grow_count": 0,
      "press_count": 0,
      "y": 1,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "4_8": {
      "index": 997,
      "water_id": 48,
      "chess": "chess_bm1",
      "grow_count": 0,
      "press_count": 0,
      "y": 4,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_linglichangbian"
      },
      "buy_price": 3,
      "xuejingshi_count": 0,
      "x": 8,
      "item": {}
    },
    "4_2": {
      "index": 1140,
      "chess": "chess_bh1",
      "grow_count": 0,
      "item": {},
      "xuejingshi_count": 0,
      "changdun_count": 0,
      "lastitem": {},
      "buy_price": 0,
      "y": 4,
      "press_count": 0,
      "x": 2
    },
    "1_1": {
      "index": 1417,
      "chess": "chess_hw1",
      "grow_count": 0,
      "item": {},
      "xuejingshi_count": 0,
      "changdun_count": 0,
      "lastitem": {
        "1": "item_wangyuanjing",
        "2": "item_qishijian"
      },
      "buy_price": 3,
      "y": 1,
      "press_count": 0,
      "x": 1
    }
  },
  "relic_ttl_2": {
    "ttl": 8,
    "relic_name": "item_stolen_vault"
  },
  "relic_ttl_6": {
    "ttl": 9,
    "relic_name": "item_stolen_vault"
  },
  "relic_ttl_7": {
    "ttl": 8,
    "relic_name": "item_stolen_vault"
  },
  "relic_ttl_3": {
    "ttl": 10,
    "relic_name": "item_rank_damage"
  },
  "relic_ttl_5": {
    "ttl": 8,
    "relic_name": "item_rank_damage"
  },
  "relic_ttl_4": {
    "ttl": 7,
    "relic_name": "item_streak_plus"
  },
  "relic_ttl_0": {
    "ttl": 10,
    "relic_name": "item_egg"
  },
  "relic_ttl_1": {
    "ttl": 5,
    "relic_name": "item_egg"
  }
}
```

### `CustomNetTable_ranking_top_table`

```json
{
  "ranking_top": {
    "season": "_s43",
    "hehe": 121,
    "ranking_top": {
      "1": {
        "player": "76561198237138642",
        "is_vip": 0,
        "chicken_count": 138,
        "mmr_level": 38,
        "queen_rank": 1
      },
      "2": {
        "player": "76561198100277066",
        "is_vip": 1,
        "chicken_count": 99,
        "mmr_level": 38,
        "queen_rank": 2
      },
      "...": "up to 100 queen ladder rows"
    },
    "leaderboard_info": {
      "leaderboard_pandaman_fish": {
        "1": {
          "steam_id": "76561199607255448",
          "chess_list": "chess_storm_7,chess_earth_10,...",
          "is_vip": 0,
          "count": 1020333
        },
        "...": "more rows"
      },
      "leaderboard_mvp_chess": {
        "1": {
          "damage": 95983,
          "is_vip": 0,
          "steam_id": "76561198260781060",
          "name": "chess_sven11",
          "item": "item_yonghengzhipan,item_aoshuxie,..."
        },
        "...": "more rows"
      },
      "leaderboard_lineup_value": { "...": "lineup value leaderboard" },
      "leaderboard_chicken": { "...": "chicken count leaderboard" }
    }
  }
}
```

### `CustomNetTable_chess_pool_table`

```json
{
  "ban_info": {
    "is_aqir": {
      "chess_list": {
        "1": "chess_sk",
        "2": "chess_veno",
        "3": "chess_br"
      },
      "ban_price": 6
    },
    "is_demon": {
      "chess_list": {
        "1": "chess_sd",
        "2": "chess_ck",
        "3": "chess_tb",
        "4": "chess_sf",
        "5": "chess_doom",
        "...": "..."
      },
      "ban_price": 16
    },
    "...": "more synergy ban entries"
  },
  "legendary_info": {
    "hehe": 341,
    "chess_banned": {
      "1": "chess_pb",
      "2": "chess_morph",
      "3": "chess_ta",
      "...": "..."
    },
    "chess_active": {
      "1": "chess_ok",
      "2": "chess_gyro",
      "3": "chess_zeus",
      "...": "..."
    },
    "relic_banned": {
      "1": "item_bench_contract",
      "2": "item_more_creep",
      "...": "..."
    },
    "relic_active": {
      "1": "item_streak_plus",
      "2": "item_second_chance",
      "3": "item_egg",
      "...": "..."
    }
  },
  "relic_list": {
    "1": "item_upgrade_lootbox",
    "2": "item_streak_plus",
    "3": "item_free_ban",
    "4": "item_second_chance",
    "5": "item_egg",
    "...": "..."
  },
  "destroy_info": {
    "1": "chess_tb",
    "2": "chess_tusk",
    "3": "chess_ss",
    "4": "chess_wd",
    "5": "chess_sm",
    "...": "..."
  },
  "chess_list_by_mana": {
    "1": {
      "1": "chess_bane",
      "2": "chess_tusk",
      "3": "chess_dw",
      "...": "..."
    },
    "2": {
      "1": "chess_luna",
      "2": "chess_lina",
      "3": "chess_bs",
      "...": "..."
    },
    "...": "cost buckets 3, 4, 5"
  },
  "revealed_legendary_chess_list": {
    "1": "chess_wl",
    "2": "chess_th",
    "3": "chess_gyro",
    "...": "..."
  },
  "unrevealed_legendary_chess_list": {}
}
```

## Manual test (no app running)

When manually running `dumpstringtable` commands in Dota's console, avoid one
huge semicolon chain for every candidate table. Very long direct dump batches
can truncate or drop output in `console.log`; split broad audits into a few
smaller commands and run them one at a time.

### 2026-06-05 broad audit capture

Captured locally in:

```text
~/.dac/captures/sessions/20260605_180916_76561198022169086/raw_dumps.jsonl.gz
```

Steam IDs in the decoded output below are anonymized as `steam_id_N`; the raw archive keeps the original values.

Observed tables and row/key counts:

```text
dumps: 5
CustomNetTable_ability_kv_table: 366 row(s), 122 key(s)
CustomNetTable_casino_table: 4 row(s), 1 key(s)
CustomNetTable_chess_kv_table: 1848 row(s), 616 key(s)
CustomNetTable_chess_pool_table: 82 row(s), 17 key(s)
CustomNetTable_dac_table: 15 row(s), 3 key(s)
CustomNetTable_game_info: 20 row(s), 4 key(s)
CustomNetTable_hp_bar_table: 4 row(s), 1 key(s)
CustomNetTable_player_id_table: 212 row(s), 46 key(s)
CustomNetTable_player_info_table: 5 row(s), 1 key(s)
CustomNetTable_quest_table: 4 row(s), 1 key(s)
CustomNetTable_ranking_top_table: 5 row(s), 1 key(s)
CustomNetTable_setting_table: 4 row(s), 1 key(s)
```

Decoded latest output by table/key from that archive:

#### `CustomNetTable_ability_kv_table`

```json
{
  "a108": {
    "AbilityCooldown": "6 4 3",
    "AbilityKV": {
      "damage_per_missile": "250 300 350",
      "missile_count": "3 3 4"
    },
    "AbilityManaCost": 100,
    "AbilityName": "a108",
    "IsDOTA2OriginalAbility": "false"
  },
  "aa_ice_blast": {
    "AbilityKV": {
      "attack_range_bonus": "0 200 400",
      "attackspeed_reduction": "-30 -40 -60",
      "duration": "4 6 10"
    },
    "AbilityName": "aa_ice_blast",
    "IsDOTA2OriginalAbility": "false"
  },
  "abaddon_aphotic_shield": {
    "AbilityKV": {
      "%damage_absorb": "150 200 250",
      "AbilityCooldown": "10 8 6",
      "absorb_damage_aoe": 0,
      "absorb_to_damage": 0,
      "duration": 15,
      "radius": 300,
      "regen": 0
    },
    "AbilityManaCost": 100,
    "AbilityName": "abaddon_aphotic_shield",
    "IsDOTA2OriginalAbility": "true"
  },
  "ability_disruptor_static_storm": {
    "AbilityCooldown": "20 15 10",
    "AbilityKV": {
      "damage_max": "100 150 200",
      "dur\u0012ation": "4 6 8",
      "pulses": "8 12 16",
      "radius": "350 400 450"
    },
    "AbilityManaCost": 75,
    "AbilityName": "ability_disruptor_static_storm",
    "IsDOTA2OriginalAbility": "false"
  },
  "ability_drow_ranger_wave_of_silence": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "blocks": "2 3 4",
      "damage": "100 150 �200",
      "distance": "500 600 800",
      "silence_duration": "3 4 5",
      "wave_speed": 2000,
      "wave_width": 250
    },
    "AbilityManaCost": 100,
    "AbilityName": "ability_drow_ranger_wave_of_silence",
    "IsDOTA2OriginalAbility": "false"
  },
  "ability_viper_viper_strike": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "bonus_attack_speed": "-40 -60 -100",
      "bonus_movement_speed": "-40 -60 -100",
      "cast_range_scepter": 9999,
      "charge_restore_time": 0,
      "cooldown_scepter": "6 8 10",
      "damage": "40 60 100",
      "duration": "6 8 10",
      "mana_cost_scepter": 100,
      "max_charges": 1,
      "projectile_speed": 1200
    },
    "AbilityManaCost": 100,
    "AbilityName": "ability_viper_viper_strike",
    "IsDOTA2OriginalAbility": "false"
  },
  "alchemist_chemical_rage": {
    "AbilityCooldown": "25 20 15",
    "AbilityKV": {
      "acid_duration": 15,
      "armor_reduce": "4 8 12",
      "base_attack_time": "0.6 0.55 0.5",
      "bonus_health": 0,
      "bonus_health_regen": "60 80 100",
      "bonus_mana_regen": 0,
      "bonus_movespeed": 0,
      "duration": 15,
      "scepter_bonus_damage": 25,
      "scepter_gold_damage": 2,
      "scepter_spell_amp": 5,
      "transformation_time": "0.3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "alchemist_chemical_rage",
    "IsDOTA2OriginalAbility": "true"
  },
  "am_mana_break": {
    "AbilityKV": {
      "mana_per_hit": "40 60 100",
      "mana_void_aoe_radius": "300 300 400",
      "mana_void_damage_per_mana": "2 4 8",
      "mana_void_ministun": 0.5,
      "mana_void_required": 100
    },
    "AbilityName": "am_mana_break",
    "IsDOTA2OriginalAbility": "false"
  },
  "arc_double": {
    "AbilityKV": {
      "duration": "10 20 30"
    },
    "AbilityManaCost": 0,
    "AbilityName": "arc_double",
    "IsDOTA2OriginalAbility": "false"
  },
  "au_portal": {
    "AbilityCooldown": 0,
    "AbilityKV": {
      "interval": 4
    },
    "AbilityManaCost": 0,
    "AbilityName": "au_portal",
    "IsDOTA2OriginalAbility": "false"
  },
  "axe_berserkers_call": {
    "AbilityCooldown": 8,
    "AbilityKV": {
      "bonus_armor": "10 15 25",
      "bonus_attack_speed": 0,
      "duration": "4 6 8",
      "radius": 192
    },
    "AbilityManaCost": 100,
    "AbilityName": "axe_berserkers_call",
    "IsDOTA2OriginalAbility": "true"
  },
  "baby_dragon": {
    "AbilityCooldown": "30 20 15",
    "AbilityKV": {
      "famaliar_count": "1 1 2",
      "magic_ass": 50,
      "steal_attack_speed": "20 30 40",
      "steal_duration": 6,
      "summon_duration": "40 40 30"
    },
    "AbilityManaCost": 100,
    "AbilityName": "baby_dragon",
    "IsDOTA2OriginalAbility": "false"
  },
  "bane_fiends_grip": {
    "AbilityCooldown": 6,
    "AbilityKV": {
      "AbilityChannelTime": "4 6 8",
      "AbilityCooldown": 6,
      "fiend_grip_damage": "75 100 125",
      "fiend_grip_mana_drain": 0,
      "fiend_grip_tick_interval": 0.5
    },
    "AbilityManaCost": 100,
    "AbilityName": "bane_fiends_grip",
    "IsDOTA2OriginalAbility": "true"
  },
  "batrider_firefly": {
    "AbilityCooldown": "15 12 9",
    "AbilityKV": {
      "bonus_vision": "100 200 300",
      "damage_per_second": "50 75 100",
      "duration": 10,
      "movement_speed": 0,
      "radius": 200,
      "tick_interval": 0.5,
      "tree_radius": "200 200 200"
    },
    "AbilityManaCost": 100,
    "AbilityName": "batrider_firefly",
    "IsDOTA2OriginalAbility": "true"
  },
  "bh_shuriken": {
    "AbilityCooldown": "9 7 5",
    "AbilityKV": {
      "damage": "300 400 600",
      "gold_count": "1 3 5",
      "ministun": 1
    },
    "AbilityManaCost": 100,
    "AbilityName": "bh_shuriken",
    "IsDOTA2OriginalAbility": "false"
  },
  "bloodseeker_blood_bath_lua": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "damage": "200 250 350",
      "delay": "2.6",
      "delay_plus_castpoint_tooltip": "2.9",
      "radius": "300 400 500",
      "silence_duration": "2 2 3"
    },
    "AbilityManaCost": 75,
    "AbilityName": "bloodseeker_blood_bath_lua",
    "IsDOTA2OriginalAbility": "false"
  },
  "bm_beast": {
    "AbilityCooldown": 20,
    "AbilityKV": {
      "summon_duration": 30
    },
    "AbilityManaCost": 100,
    "AbilityName": "bm_beast",
    "IsDOTA2OriginalAbility": "false"
  },
  "br_web_new": {
    "AbilityCooldown": "5 4 3",
    "AbilityKV": {
      "attack_damage": "10 20 30",
      "duration": 6,
      "impact_damage": "50 75 100",
      "miss_chance": "40 60 80",
      "projectile_speed": 1200
    },
    "AbilityManaCost": 0,
    "AbilityName": "br_web_new",
    "IsDOTA2OriginalAbility": "false"
  },
  "brew_ssr_3_pandas": {
    "AbilityCooldown": 999,
    "AbilityKV": {},
    "AbilityManaCost": 100,
    "AbilityName": "brew_ssr_3_pandas",
    "IsDOTA2OriginalAbility": "false"
  },
  "brewmaster_cinder_brew": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "AbilityCastRange": 700,
      "barrel_impact_damage": 0,
      "barrel_width": 0,
      "duration": 5,
      "extra_duration": "3 4 5",
      "max_movement": 0,
      "min_movement": 0,
      "miss_per": "30 50 70",
      "movement_slow": 30,
      "projectile_speed": 1600,
      "projectile_width": 250,
      "radius": "300 400 500",
      "total_ignite_damage": "100 150 200"
    },
    "AbilityManaCost": 100,
    "AbilityName": "brewmaster_cinder_brew",
    "IsDOTA2OriginalAbility": "true"
  },
  "burning_spear_datadriven": {
    "AbilityCooldown": "0.0 0.0 0.0",
    "AbilityKV": {
      "AbilityDamage": "15 20 25",
      "attack_speed_per_level": "7 10 15",
      "burning_spear_damage": "15 20 25",
      "burning_spear_duration": 5,
      "health_cost": "15 20 25",
      "hp_regain_per_level": "0.4",
      "magic_resist_per_level": 8
    },
    "AbilityManaCost": "0 0 0",
    "AbilityName": "burning_spear_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "chaos_knight_chaos_strike": {
    "AbilityKV": {
      "chance": 20,
      "creep_lifesteal_reduction_pct": 70,
      "creep_multiplier": 1,
      "crit_max": "150 200 250",
      "crit_min": 125,
      "lifesteal": 20
    },
    "AbilityName": "chaos_knight_chaos_strike",
    "IsDOTA2OriginalAbility": "true"
  },
  "chen_fuhuo": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "chess_star": "1 2 3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "chen_fuhuo",
    "IsDOTA2OriginalAbility": "false"
  },
  "chess_tech_bomb": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "damage": "800 1200 2000",
      "explode_delay": 3,
      "range": 600,
      "scale": "1.2 1.5 1.8"
    },
    "AbilityManaCost": 100,
    "AbilityName": "chess_tech_bomb",
    "IsDOTA2OriginalAbility": "false"
  },
  "ck_illusion": {
    "AbilityCooldown": 30,
    "AbilityKV": {},
    "AbilityManaCost": 100,
    "AbilityName": "ck_illusion",
    "IsDOTA2OriginalAbility": "false"
  },
  "clinkz_burning_barrage": {
    "AbilityCooldown": "8 7 6",
    "AbilityKV": {
      "archers_use_barrage": 0,
      "damage_pct": "50 75 100",
      "projectile_width": 125,
      "range": 800,
      "wave_count": 4
    },
    "AbilityManaCost": 100,
    "AbilityName": "clinkz_burning_barrage",
    "IsDOTA2OriginalAbility": "true"
  },
  "cm_mana_aura": {
    "AbilityKV": {
      "mana_regain": "8 12 20"
    },
    "AbilityName": "cm_mana_aura",
    "IsDOTA2OriginalAbility": "false"
  },
  "ct_double_edge": {
    "AbilityCooldown": "10 9 8",
    "AbilityKV": {
      "damage_base": "100 150 200",
      "damage_per": 10,
      "radius": "200 225 250"
    },
    "AbilityManaCost": 0,
    "AbilityName": "ct_double_edge",
    "IsDOTA2OriginalAbility": "false"
  },
  "dark_seer_ion_shell": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "AbilityCharges": 0,
      "bonus_health": 0,
      "damage_per_second": "50 75 100",
      "duration": "10 15 20",
      "radius": 260,
      "reduction_per": "10 15 20",
      "tick_interval": 0.5
    },
    "AbilityManaCost": 100,
    "AbilityName": "dark_seer_ion_shell",
    "IsDOTA2OriginalAbility": "true"
  },
  "dawnbreaker_fire_wreath": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "AbilityCooldown": "10 8 6",
      "animation_rate": 0,
      "duration": "1.1",
      "movement_speed": 215,
      "self_stun_duration0": "0.2",
      "shard_cast_point": "0.1",
      "shard_movement_penalty": 0,
      "smash_damage": "100 150 200",
      "smash_distance_from_hero": 120,
      "smash_radius": "210 210 260",
      "smash_stun_duration": "0.5 1 1.5",
      "sweep_stun_duration": "0.1",
      "swipe_damage": "15 30 45",
      "swipe_radius": 210,
      "swipe_slow": -100,
      "total_attacks": 3,
      "turn_rate": 90
    },
    "AbilityManaCost": 100,
    "AbilityName": "dawnbreaker_fire_wreath",
    "IsDOTA2OriginalAbility": "true"
  },
  "dazzle_bozang": {
    "AbilityCooldown": 15,
    "AbilityKV": {
      "count": "1 2 3",
      "duration": "4 4 4"
    },
    "AbilityManaCost": 100,
    "AbilityName": "dazzle_bozang",
    "IsDOTA2OriginalAbility": "false"
  },
  "death_prophet_exorcism": {
    "AbilityCooldown": 8,
    "AbilityKV": {
      "average_damage": 200,
      "ghost_spawn_rate": "0.4 0.3 0.2",
      "give_up_distance": "800 800 800",
      "heal_percent": "25 25 25",
      "hero_spirit_max_damage": 0,
      "hero_spirit_min_damage": 0,
      "max_damage": 200,
      "max_distance": "1000 1000 1000",
      "min_damage": 200,
      "movement_bonus": "12 16 20",
      "radius": "700 700 700",
      "scepter_movespeed_debuff_duration": "0.3",
      "scepter_movespeed_slow": 100,
      "scepter_spirit_bonus_damage": 50,
      "scepter_spirit_life_duration": 20,
      "spirit_speed": "500 500 500",
      "spirits": "6 8 12"
    },
    "AbilityManaCost": 100,
    "AbilityName": "death_prophet_exorcism",
    "IsDOTA2OriginalAbility": "true"
  },
  "dk_dragon_form": {
    "AbilityCooldown": 60,
    "AbilityKV": {
      "dragon_form_ad": "200 300 400",
      "poison_percent": 5,
      "slow_percent": -25,
      "splash_percent": 25
    },
    "AbilityManaCost": 100,
    "AbilityName": "dk_dragon_form",
    "IsDOTA2OriginalAbility": "false"
  },
  "doom_bringer_doom": {
    "AbilityCooldown": 10,
    "AbilityKV": {
      "AbilityCooldown": 10,
      "damage": "60 90 150",
      "deniable_pct": "25 25 25",
      "does_break": 0,
      "does_mute": 0,
      "duration": "7 10 20",
      "scepter_aura_radius": 0
    },
    "AbilityManaCost": 100,
    "AbilityName": "doom_bringer_doom",
    "IsDOTA2OriginalAbility": "true"
  },
  "dw_flower": {
    "AbilityKV": {
      "duration": "3 2 2",
      "enemy_count": "1 2 3"
    },
    "AbilityName": "dw_flower",
    "IsDOTA2OriginalAbility": "false"
  },
  "earth_rock_roll": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "damage": "300 400 600",
      "duration": "2 3 4",
      "roll_count": "1 2 3",
      "stun_duration": "`3 3 4"
    },
    "AbilityManaCost": 75,
    "AbilityName": "earth_rock_roll",
    "IsDOTA2OriginalAbility": "false"
  },
  "eh_untouchable_aura": {
    "AbilityKV": {
      "radius": 190,
      "slow_attack_speed": "-20 -30 -40",
      "slow_duration": 3
    },
    "AbilityName": "eh_untouchable_aura",
    "IsDOTA2OriginalAbility": "false"
  },
  "et_earth_splitter": {
    "AbilityCooldown": 60,
    "AbilityKV": {
      "damage_base": "20 25 30",
      "damage_per": "3 4 6",
      "duration": "1.0 1.5 2.0",
      "radius": 250
    },
    "AbilityManaCost": 100,
    "AbilityName": "et_earth_splitter",
    "IsDOTA2OriginalAbility": "false"
  },
  "fur_tree": {
    "AbilityCooldown": "7 10 10",
    "AbilityKV": {
      "summon_count": "1 2 2",
      "summon_duration": "30 20 20"
    },
    "AbilityManaCost": 100,
    "AbilityName": "fur_tree",
    "IsDOTA2OriginalAbility": "false"
  },
  "fv_zhao_new": {
    "AbilityCooldown": "15 12 10",
    "AbilityKV": {
      "bon5Pus_attack_speed": "25 35 50",
      "bonus_move_speed": "30 40 50",
      "duration": "5 6 7",
      "radius": "350 400 500",
      "reduction_attack_speed": "-25 -35 -50",
      "reduction_move_speed": "-30 -40 -50"
    },
    "AbilityManaCost": 100,
    "AbilityName": "fv_zhao_new",
    "IsDOTA2OriginalAbility": "false"
  },
  "gouhe": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "damage": "100 200 400",
      "duration": "6 8 12",
      "stun": "2 3 4"
    },
    "AbilityManaCost": 75,
    "AbilityName": "gouhe",
    "IsDOTA2OriginalAbility": "false"
  },
  "gs_mingyunzhibi": {
    "AbilityKV": {
      "fuhun_count": "2 3 4"
    },
    "AbilityName": "gs_mingyunzhibi",
    "IsDOTA2OriginalAbility": "false"
  },
  "gyro_flak_cannon": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "max_attacks": "2 4 8",
      "max_targets": "3 6 9"
    },
    "AbilityManaCost": 0,
    "AbilityName": "gyro_flak_cannon",
    "IsDOTA2OriginalAbility": "false"
  },
  "hoodwink_acorn_shot_datadriven": {
    "AbilityCooldown": "12 8 4",
    "AbilityKV": {
      "bounce_count": "2 3 4",
      "damage": "50 75 100",
      "duratuion": "3 5 7"
    },
    "AbilityManaCost": 0,
    "AbilityName": "hoodwink_acorn_shot_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "invoke": {
    "AbilityCooldown": "4 3 0",
    "AbilityKV": {},
    "AbilityManaCost": 0,
    "AbilityName": "invoke",
    "IsDOTA2OriginalAbility": "false"
  },
  "jakiro_dual_breath": {
    "AbilityCooldown": 3,
    "AbilityKV": {
      "AbilityCastRange": 750,
      "AbilityDamage": 0,
      "burn_damage": 200,
      "end_radius": 350,
      "fire_delay": "0.2",
      "slow_attack_speed_pct": -50,
      "slow_movement_speed_pct": -50,
      "speed": 1050,
      "speed_fire": 1050,
      "start_radius": 250
    },
    "AbilityManaCost": 100,
    "AbilityName": "jakiro_dual_breath",
    "IsDOTA2OriginalAbility": "true"
  },
  "jakiro_macropyre": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "AbilityCastRange": 1300,
      "burn_interval": "0.5 0.5 0.5",
      "damage": "150 200 300",
      "duration": 4,
      "ice_edge_linger_duration": 0,
      "ice_edge_movement_slow": 0,
      "ice_edge_path_radius": 0,
      "linger_duration": 2,
      "path_width": 250,
      "pierces_magic_immunity": 0,
      "pure_damage_type": 0
    },
    "AbilityManaCost": 100,
    "AbilityName": "jakiro_macropyre",
    "IsDOTA2OriginalAbility": "true"
  },
  "juggernaut_blade_fury_lua": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "blade_fury_damage": "60 100 140",
      "blade_fury_damage_tick": "0.6",
      "blade_fury_radius": 250,
      "duration": 5,
      "magic_ass": 80
    },
    "AbilityManaCost": 100,
    "AbilityName": "juggernaut_blade_fury_lua",
    "IsDOTA2OriginalAbility": "false"
  },
  "keeper_of_the_light_illuminate": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "AbilityCooldown": "12 10 8",
      "channel_vision_duration": "10.3",
      "channel_vision_interval": 0.5,
      "channel_vision_radiu5s": 300,
      "channel_vision_step": 150,
      "max_channel_time": 2.5,
      "radius": "300 300 350",
      "range": 1000,
      "speed": 900,
      "total_damage": "250 450 650",
      "vision_duration": "3.3",
      "vision_radius": 800
    },
    "AbilityManaCost": 100,
    "AbilityName": "keeper_of_the_light_illuminate",
    "IsDOTA2OriginalAbility": "true"
  },
  "kez_kazurai_katana_datadriven": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "damage": "300 400 600",
      "damage_per": "15 20 30",
      "stun_duration": "2.0 2.5 3.0"
    },
    "AbilityManaCost": 100,
    "AbilityName": "kez_kazurai_katana_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "kunkka_ship": {
    "AbilityCooldown": "15 12 9",
    "AbilityKV": {
      "damage": "250 350 600",
      "ghostship_distance": 2000,
      "ghostship_speed": 650,
      "ghostship_width": "400 450 500",
      "stun_duration": "1.5 2 3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "kunkka_ship",
    "IsDOTA2OriginalAbility": "false"
  },
  "largo_frogstomp": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "AbilityCastRange": 9999,
      "AbilityCooldown": "10 8 6",
      "damage_per_stomp": "30 40 50",
      "delay": 0.5,
      "radius": "200 300 400",
      "slow": "10 20 30",
      "stomp_interval": 1,
      "stun_duration": "0.1 0.2 0.3",
      "total_ticks": "3 4 5"
    },
    "AbilityManaCost": 100,
    "AbilityName": "largo_frogstomp",
    "IsDOTA2OriginalAbility": "true"
  },
  "lc_qianggong": {
    "AbilityKV": {
      "damage_bouns_per_victory": "10 10 10",
      "fanji_per": "15 25 35",
      "fanji_xixue": 25
    },
    "AbilityName": "lc_qianggong",
    "IsDOTA2OriginalAbility": "false"
  },
  "ld_bear": {
    "AbilityCooldown": 60,
    "AbilityKV": {
      "summon_duration": 40
    },
    "AbilityManaCost": 100,
    "AbilityName": "ld_bear",
    "IsDOTA2OriginalAbility": "false"
  },
  "leshrac_pulse_nova": {
    "AbilityCooldown": "8 6 4",
    "AbilityKV": {
      "bonus_movespeed": 0,
      "damage": "75 100 125",
      "damage_resistance": 0,
      "mana_cost_per_second": 20,
      "radius": "300 350 400"
    },
    "AbilityManaCost": 0,
    "AbilityName": "leshrac_pulse_nova",
    "IsDOTA2OriginalAbility": "true"
  },
  "lich_chain_frost": {
    "AbilityCooldown": "8 7 6",
    "AbilityKV": {
      "bonus_jump_damage": 25,
      "bonus_jumps_per_creep_killed": 0,
      "bonus_jumps_per_hero_killed": 0,
      "damage": "100 150 200",
      "frostbound_duration": 0,
      "initial_projectile_speed": 1050,
      "jump_range": 300,
      "jumps": "4 5 7",
      "projectile_speed": 800,
      "slow_attack_speed": -50,
      "slow_duration": "3 4 5",
      "slow_movement_speed": -50,
      "vision_radius": 800
    },
    "AbilityManaCost": 100,
    "AbilityName": "lich_chain_frost",
    "IsDOTA2OriginalAbility": "true"
  },
  "life_stealer_rage": {
    "AbilityCooldown": 12,
    "AbilityKV": {
      "bonus_armor": 0,
      "debuff_immunity": 1,
      "duration": "4.0 6.0 9.0",
      "magic_resist": 80,
      "status_resist": 0
    },
    "AbilityManaCost": 0,
    "AbilityName": "life_stealer_rage",
    "IsDOTA2OriginalAbility": "true"
  },
  "lina_laguna_blade": {
    "AbilityKV": {
      "AbilityCooldown": "8 6 4",
      "burn_damage_tooltip": 0,
      "burn_duration_tooltip": 0,
      "damage": "400 600 800",
      "damage_delay": "0.3",
      "pierce_immunity": 0,
      "supercharge_duration": 0,
      "supercharge_stacks": 0
    },
    "AbilityManaCost": 100,
    "AbilityName": "lina_laguna_blade",
    "IsDOTA2OriginalAbility": "true"
  },
  "lion_finger_of_death": {
    "AbilityCooldown": "9 7 5",
    "AbilityKV": {
      "cleave_damage": 0,
      "cleave_distance": 0,
      "cleave_ending_width": 0,
      "cleave_starting_width": 0,
      "cooldown_scepter": "9 7 5",
      "damage": "500 750 1000",
      "damage_bonus": "100 150 200",
      "damage_delay": "0.3",
      "damage_per_kill": 0,
      "grace_period": 3,
      "punch_attack_range": 0,
      "punch_bonus_damage_base": 0,
      "punch_bonus_damage_per_stack": 0,
      "punch_duration": 0,
      "punch_grace_period": 0,
      "splash_radius_scepter": 0
    },
    "AbilityManaCost": 100,
    "AbilityName": "lion_finger_of_death",
    "IsDOTA2OriginalAbility": "true"
  },
  "lion_voodoo": {
    "AbilityCooldown": "8 6 4",
    "AbilityKV": {
      "AbilityCooldown": "8 6 4",
      "duration": "4 4 5",
      "movespeed": 120,
      "radius": 0
    },
    "AbilityManaCost": 75,
    "AbilityName": "lion_voodoo",
    "IsDOTA2OriginalAbility": "true"
  },
  "luna_moon_glaive": {
    "AbilityKV": {
      "AbilityCooldown": 0,
      "AbilityManaCost": 0,
      "bounces": "3 4 5",
      "damage_reduction_percent": 30,
      "range": 300,
      "rotating_glaives": 0,
      "rotating_glaives_collision_damage": 0,
      "rotating_glaives_damage_reduction": 0,
      "rotating_glaives_duration": 0,
      "rotating_glaives_hit_radius": 0,
      "rotating_glaives_movement_radius": 0,
      "rotating_glaives_speed": 0,
      "unclamp_max_radius": 0
    },
    "AbilityName": "luna_moon_glaive",
    "IsDOTA2OriginalAbility": "true"
  },
  "lyc_wolf": {
    "AbilityCooldown": 60,
    "AbilityKV": {
      "attack_damage_bonus": "50 75 100",
      "summon_duration": 30,
      "wolf_count": "2 2 3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "lyc_wolf",
    "IsDOTA2OriginalAbility": "false"
  },
  "mag_reverse_polarity": {
    "AbilityCooldown": "15 12 9",
    "AbilityKV": {
      "damage": "150 200 300",
      "radius": "350 400 500",
      "stun_duration": "1.5 1.5 2",
      "stun_duration_step": 0.5
    },
    "AbilityManaCost": 100,
    "AbilityName": "mag_reverse_polarity",
    "IsDOTA2OriginalAbility": "false"
  },
  "marci_unleash": {
    "AbilityCooldown": "16 13 10",
    "AbilityKV": {
      "AbilityCooldown": "16 13 10",
      "AbilityManaCost": 100,
      "bonus_movespeed": 15,
      "charges_per_flurry": "3 4 5",
      "dispel": 0,
      "duration": 10,
      "flurry_bonus_attack_speed": "400 500 600",
      "max_time_window_per_hit": 1,
      "pulse_attapck_slow_pct": "30.0 50.0 70.0",
      "pulse_damage": "100 150 250",
      "pulse_debuff_duration": 3,
      "pulse_move_slow_pct": 30,
      "pulse_radius": "200 300 400",
      "pulse_silence_duration": 0,
      "recovery_fixed_attack_rate": 2,
      "scepter_cooldown_reduction": 10,
      "shard_push_length": 300,
      "time_between_flurries": 2
    },
    "AbilityManaCost": 100,
    "AbilityName": "marci_unleash",
    "IsDOTA2OriginalAbility": "true"
  },
  "mars_bulwark_attack": {
    "AbilityCooldown": 8,
    "AbilityKV": {
      "forward_angle": 90,
      "physicalE_damage_reduction": "30 45 60",
      "physical_damage_reduction_side": "15 23 30",
      "redirect_chance": 0,
      "redirect_range": 0,
      "redirect_speed_penatly": 0,
      "shield_bash_damage": "200 250 350",
      "shield_bash_radius": 200,
      "side_angle": 180
    },
    "AbilityManaCost": 0,
    "AbilityName": "mars_bulwark_attack",
    "IsDOTA2OriginalAbility": "false"
  },
  "medusa_stone_gaze": {
    "AbilityCooldown": "25 20 15",
    "AbilityKV": {
      "AbilityCastRange": "600 800 1000",
      "AbilityCooldown": "25 20 15",
      "AbilityManaCost": 100,
      "bonus_physical_damage": 0,
      "duration": "3 4 5",
      "extra_damage_per": "30 40 50",
      "face_duration": 2,
      "radius": "600 800 1000",
      "slo\u0010w": 30,
      "speed_boost": 0,
      "split_count": "2 3 4",
      "split_damage_per": 50,
      "stone_duration": "2 2.5 3",
      "vision_cone": 0.5
    },
    "AbilityManaCost": 100,
    "AbilityName": "medusa_stone_gaze",
    "IsDOTA2OriginalAbility": "true"
  },
  "midnight_pulse_datadriven": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "damage_per": "4 5 6",
      "damage_tick": 0.5,
      "duration": "4 5 7",
      "radius": "350 400 450"
    },
    "AbilityManaCost": 100,
    "AbilityName": "midnight_pulse_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "mk_ruyibangfa": {
    "AbilityKV": {
      "attack_count": "5 4 3",
      "damage_multiple": "150 175 200",
      "damage_range": 1200,
      "stun_duration": "1 1.5 2"
    },
    "AbilityName": "mk_ruyibangfa",
    "IsDOTA2OriginalAbility": "false"
  },
  "morphling_waveform": {
    "AbilityCooldown": 20,
    "AbilityKV": {
      "AbilityCastRange": 9999,
      "AbilityCharges": 0,
      "AbilityCooldown": 20,
      "AbilityDamage": "150 300 450",
      "pct_damage": 0,
      "process_procs": 0,
      "required_attack_count": "8 7 6",
      "speed": 1250,
      "str_agi_max": 250,
      "width": 200
    },
    "AbilityManaCost": 0,
    "AbilityName": "morphling_waveform",
    "IsDOTA2OriginalAbility": "true"
  },
  "muerta_pierce_the_veil": {
    "AbilityCooldown": "15 12 10",
    "AbilityKV": {
      "base_damage_pct": 100,
      "bonus_damage": 0,
      "double_shot_chance": "30 40 50",
      "duration": "3.5 4 4.5",
      "modelscale": 0,
      "spell_amp_steal": 0,
      "spell_amp_steal_range": 925,
      "spell_lifesteal": 0,
      "transform_duration": "0.3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "muerta_pierce_the_veil",
    "IsDOTA2OriginalAbility": "true"
  },
  "nec_scythe": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "base_damage": "300 400 600",
      "heartstopper_hp_per": "1 1.5 2.5",
      "hp_xishu": "30 40 60",
      "radius": "350 400 500",
      "stun_duration": 2
    },
    "AbilityManaCost": 100,
    "AbilityName": "nec_scythe",
    "IsDOTA2OriginalAbility": "false"
  },
  "nyx_assassin_spiked_carapace_datadriven": {
    "AbilityCooldown": 6,
    "AbilityKV": {
      "bonus_armor": 0,
      "bonus_damage": 0,
      "bonus_intellect": 0,
      "reflect_duration": "4 5 6",
      "stun_duration": "1 2 3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "nyx_assassin_spiked_carapace_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "ok_angel": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "duration": "4 5 P6",
      "heal": "200 300 400",
      "magical_resist": "30 50 70",
      "physical_resist": "30 50 70",
      "radius": "300 400 500"
    },
    "AbilityManaCost": 0,
    "AbilityName": "ok_angel",
    "IsDOTA2OriginalAbility": "false"
  },
  "om_multi_cast_aura": {
    "AbilityKV": {
      "attack_speed_bonus": "20 30 40",
      "bloodlust_duration": 10,
      "multi_per": "30 35 40",
      "radius": "350 450 550"
    },
    "AbilityManaCost": 0,
    "AbilityName": "om_multi_cast_aura",
    "IsDOTA2OriginalAbility": "false"
  },
  "oracle_rain_of_destiny_datadriven": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "duration": "5 7 10",
      "hps": "100 100 100",
      "radius": "250 300 400",
      "tick_rate": 1
    },
    "AbilityManaCost": 100,
    "AbilityName": "oracle_rain_of_destiny_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "pangolier_swashbuckle_datadriven": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "attack_interval": "0.1",
      "end_radius": 150,
      "max_distance": "550 600 650",
      "strikes": "4 5 6"
    },
    "AbilityManaCost": 100,
    "AbilityName": "pangolier_swashbuckle_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "phantom_assassin_coup_de_grace": {
    "AbilityKPV": {
      "crit_bonus": "300 400 500",
      "crit_chance": 20,
      "dagger_crit_chance": 0,
      "duration": "6 8 10",
      "miss_per": 50
    },
    "AbilityName": "phantom_assassin_coup_de_grace",
    "IsDOTA2OriginalAbility": "true"
  },
  "phoenix_sun_ray": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "base_damage": "35 70 105",
      "base_heal": "50 75 125",
      "duration": "4.0 5.0 6.0",
      "focal_point_blind_stack_multiplier": 0,
      "focal_point_full_length_tooltip_only": 0,
      "focal_point_max_multiplier": 0,
      "focal_point_start_length_pct": 0,
      "forward_move_speed": 0,
      "hp_cost_perc_per_second": 3,
      "hp_perc_damage": "0.5 1 2",
      "hp_perc_heal": "0.25 0.5 1",
      "radius": 150,
      "tick_interval": "0.2",
      "turn_rate": 25,
      "turn_rate_initial": 250
    },
    "AbilityManaCost": 0,
    "AbilityName": "phoenix_sun_ray",
    "IsDOTA2OriginalAbility": "true"
  },
  "pom_arrow_far": {
    "AbilityCooldown": "10 9 8",
    "AbilityKV": {
      "max_damage": "300 450 750",
      "max_distance": 1267,
      "max_stun": "3 4.5 7.5",
      "min_damage": "100 150 250",
      "min_stun": "1 1.5 2.5"
    },
    "AbilityManaCost": 100,
    "AbilityName": "pom_arrow_far",
    "IsDOTA2OriginalAbility": "false"
  },
  "poof": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "damage_radius": 205,
      "pure_damage": "150 300 600"
    },
    "AbilityManaCost": 100,
    "AbilityName": "poof",
    "IsDOTA2OriginalAbility": "false"
  },
  "primal_beast_pulverize_lua": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "AbilityDamage": "150 200 300",
      "animation_rate": "1.1",
      "cast_range": 205,
      "channel_time": "3.7 4.6 5.5",
      "interval": "0.9",
      "ministun": "0.5 1 1.5",
      "splash_radius": "400 450 550"
    },
    "AbilityManaCost": 100,
    "AbilityName": "primal_beast_pulverize_lua",
    "IsDOTA2OriginalAbility": "false"
  },
  "puck_illusory_orb": {
    "AbilityCooldown": "5 4 3",
    "AbilityKV": {
      "AbilityCooldown": "5 4 3",
      "curve_orb": 0,
      "curve_orb_duration_multiplier": 0,
      "curve_orb_max_acceleration": 0,
      "curve_orb_pullback_bonus_launch_speed": 0,
      "curve_strength": 0,
      "damage": "200 250 300",
      "max_distance": 800,
      "orb_speed": 550,
      "orb_vision": 450,
      "radius": 150,
      "vector_reticle_distance": 0,
      "vector_reticle_radius": 0,
      "vision_duration": 2.5,
      "warning_sound_time": "0.3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "puck_illusory_orb",
    "IsDOTA2OriginalAbility": "true"
  },
  "pudge_meat_hook_lua": {
    "AbilityCooldown": "8 7 5",
    "AbilityKV": {
      "hook_damage": "200 300 450",
      "hook_distance": 9999,
      "hook_followthrough_constant0": "0.6",
      "hook_speed": 1600,
      "hook_width": 100,
      "vision_duration": 4,
      "vision_radius": 500
    },
    "AbilityManaCost": 0,
    "AbilityName": "pudge_meat_hook_lua",
    "IsDOTA2OriginalAbility": "false"
  },
  "queenofpain_sonic_wave_datadriven": {
    "AbilityCooldown": "20 15 10",
    "AbilityKV": {
      "chaos_duration": "1.5 2 3",
      "cooldown_scepter": 40,
      "damage": "250 350 550",
      "damage_scepter": "250 350 550",
      "distance": 900,
      "final_aoe": 350,
      "speed": 1100,
      "starting_aoe": 200
    },
    "AbilityManaCost": 100,
    "AbilityName": "queenofpain_sonic_wave_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "rattletrap_battery_assault": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "creep_damage_multiplier": 1,
      "damage": "20 40 80",
      "duration": "6 8 10",
      "interval": "0.7",
      "radius": "275 275 275"
    },
    "AbilityManaCost": 100,
    "AbilityName": "rattletrap_battery_assault",
    "IsDOTA2OriginalAbility": "true"
  },
  "razor_plasma_field": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "damage_max": "150 225 300",
      "damage_min": 10,
      "radius": 450,
      "second_ring_delay": 0,
      "second_ring_reduction": 0,
      "slow_duration": 1.5,
      "slow_max": "10 15 25",
      "slow_min": 5,
      "total_ability_time": "2.2"
    },
    "AbilityManaCost": 75,
    "AbilityName": "razor_plasma_field",
    "IsDOTA2OriginalAbility": "true"
  },
  "ringmaster_spotlight": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "duration": 8,
      "illusion_percent_damage": "8 12 16",
      "initial_speed": 3000,
      "linger_duration": "0.3",
      "miss_chance": "40 60 80",
      "pulse_interval": "0.1",
      "radius": "250 350 500",
      "spotlight_count": 3,
      "start_offset": 0,
      "sweep_radius": "250 350 500",
      "sweep_speed": "0.8"
    },
    "AbilityManaCost": 0,
    "AbilityName": "ringmaster_spotlight",
    "IsDOTA2OriginalAbility": "true"
  },
  "rubick_qiequ": {
    "AbilityKV": {
      "ability_level": "1 2 3"
    },
    "AbilityName": "rubick_qiequ",
    "IsDOTA2OriginalAbility": "false"
  },
  "sandking_burrowstrike": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "AbilityCastRange": 9999,
      "AbilityCooldown": "12 10 8",
      "AbilityDamage": "150 250 350",
      "burrow_anim_time": "0.5",
      "burrow_duration": "1.5 1.5 2",
      "burrow_speed": 2000,
      "burrow_speed_scepter": 3000,
      "burrow_width": 150,
      "scepter_channel_time": 2,
      "scepter_max_power": 2
    },
    "AbilityManaCost": 100,
    "AbilityName": "sandking_burrowstrike",
    "IsDOTA2OriginalAbility": "true"
  },
  "sb_julizhongji": {
    "AbilityKV": {
      "damage": "100 150 200",
      "per": "30 40 50",
      "stun": 2
    },
    "AbilityName": "sb_julizhongji",
    "IsDOTA2OriginalAbility": "false"
  },
  "sd_disseminate": {
    "AbilityCooldown": 5,
    "AbilityKV": {
      "damage_reflection_pct": "20 30 40",
      "radius": "205 250 300"
    },
    "AbilityManaCost": 0,
    "AbilityName": "sd_disseminate",
    "IsDOTA2OriginalAbility": "false"
  },
  "shadow_fiend_requiem_of_souls_lua": {
    "AbilityCooldown": 10,
    "AbilityKV": {
      "AbilityDamage": "150 200 250",
      "base_soul_count": "4 5 6",
      "cast_time_tooltip": "1.7",
      "requiem_damage_pct_scepter": 40,
      "requiem_heal_pct_scepter": 100,
      "requiem_line_speed": 700,
      "requiem_line_width_end": 250,
      "requiem_line_width_start": 150,
      "requiem_radius": "700 800 900",
      "requiem_reduction_damage": 0,
      "requiem_reduction_ms": "10 15 25",
      "requiem_reduction_radius": 700,
      "requiem_reduction_tooltip": 0,
      "requiem_slow_duration": 5,
      "requiem_soul_conversion": 1,
      "soul_death_release": 0
    },
    "AbilityManaCost": 100,
    "AbilityName": "shadow_fiend_requiem_of_souls_lua",
    "IsDOTA2OriginalAbility": "false"
  },
  "shredder_whirling_death": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "duration": 0,
      "stat_loss_pct": 0,
      "stat_loss_univ": 0,
      "tree_damage_scale": 0,
      "wh0irling_damage": "200 250 300",
      "whirling_radius": 300,
      "whirling_tick": "0.3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "shredder_whirling_death",
    "IsDOTA2OriginalAbility": "true"
  },
  "siren_song": {
    "AbilityCooldown": 20,
    "AbilityKV": {
      "duration": 7,
      "radius": "250 350 450",
      "sleep_duration": "2 3 3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "siren_song",
    "IsDOTA2OriginalAbility": "false"
  },
  "skeletonking_reincarnation": {
    "AbilityKV": {
      "duration": "10 15 20",
      "radius": "250 300 400"
    },
    "AbilityManaCost": 0,
    "AbilityName": "skeletonking_reincarnation",
    "IsDOTA2OriginalAbility": "false"
  },
  "skywrath_mage_arcane_bolt_container": {
    "AbilityCooldown": 2,
    "AbilityKV": {
      "damage": "150 250 350"
    },
    "AbilityManaCost": 0,
    "AbilityName": "skywrath_mage_arcane_bolt_container",
    "IsDOTA2OriginalAbility": "false"
  },
  "slardar_slithereen_crush": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "crush_attack_slow_tooltip": "-10 -20 -40",
      "crush_damage": "100 125 175",
      "crush_extra_slow": "-10 -20 -40",
      "crush_extra_slow_duration": "2 3 4",
      "crush_radius": "250 300 350",
      "puddle_duration": 0,
      "puddle_radius": 0,
      "shard_amp_duration": 5,
      "shard_bonus_radius": 0,
      "stun_duration": "2 2.5 3"
    },
    "AbilityManaCost": 100,
    "AbilityName": "slardar_slithereen_crush",
    "IsDOTA2OriginalAbility": "true"
  },
  "slark_nengliangzhuanyi": {
    "AbilityKV": {
      "max_stack_count": "5 10 15",
      "speed_per_attack_buff": 10,
      "speed_per_attack_debuff": -10
    },
    "AbilityName": "slark_nengliangzhuanyi",
    "IsDOTA2OriginalAbility": "false"
  },
  "sleight_of_fist_datadriven": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "attack_interval": "0.2",
      "bonus_hero_damage": "100 200 300",
      "radius": "300 350 400"
    },
    "AbilityManaCost": 100,
    "AbilityName": "sleight_of_fist_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "smoke_screen_trigger": {
    "AbilityKV": {
      "duration": "1.5 2.5 3.5",
      "miss_rate": "20 30 40",
      "radius": "200 300 500"
    },
    "AbilityName": "smoke_screen_trigger",
    "IsDOTA2OriginalAbility": "false"
  },
  "snapfire_lil_shredder": {
    "AbilityCooldown": "8 6 4",
    "AbilityKV": {
      "armor_duration": 5,
      "armor_reduction_per_attack": "1 1 2",
      "attack_range_bonus": 250,
      "attack_speed_bonus": 300,
      "base_attack_time": "0.8",
      "buff_duration_tooltip": 8,
      "buffed_attacks": "8 12 20",
      "damage": "150 200 250",
      "damage_pct": 0
    },
    "AbilityManaCost": 100,
    "AbilityName": "snapfire_lil_shredder",
    "IsDOTA2OriginalAbility": "true"
  },
  "sniper_assassinate": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "%projectile_speed": "2500 2500 2500",
      "cooldown_reduction_on_kill": 0,
      "damage": "400 600 1000"
    },
    "AbilityManaCost": 100,
    "AbilityName": "sniper_assassinate",
    "IsDOTA2OriginalAbility": "true"
  },
  "spe_haunt": {
    "AbilityCooldown": "20 15 10",
    "AbilityKV": {
      "duration": "4 5 6",
      "max_count": "3 4 6"
    },
    "AbilityManaCost": 100,
    "AbilityName": "spe_haunt",
    "IsDOTA2OriginalAbility": "false"
  },
  "ss_ssr_wards": {
    "AbilityCooldown": 10,
    "AbilityKV": {},
    "AbilityManaCost": 100,
    "AbilityName": "ss_ssr_wards",
    "IsDOTA2OriginalAbility": "false"
  },
  "storm_spirit_ball_lightning_datadriven": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "AbilityDamage": "50 75 100",
      "ball_lightning_aoe": "125 150 200",
      "ball_lightning_initial_mana_base": 0,
      "ball_lightning_initial_mana_percentage": 0,
      "ball_lightning_move_speed": "1000 1250 1500",
      "ball_lightning_travel_cost_base": 0,
      "ball_lightning_travel_cost_percent": 0,
      "ball_lightning_vision_radius": 1000,
      "distance_per_damage": 128,
      "distance_per_mana": 100,
      "tree_destroy_interval": "0",
      "tree_destroy_radius": 100
    },
    "AbilityManaCost": 100,
    "AbilityName": "storm_spirit_ball_lightning_datadriven",
    "IsDOTA2OriginalAbility": "false"
  },
  "tb_mohua_new": {
    "AbilityCooldown": 60,
    "AbilityKV": {
      "mohua_friend_count": "0 1 2",
      "mohua_tb_ad": "80 160 320",
      "mohua_tb_hp": "700 1400 2800"
    },
    "AbilityManaCost": 100,
    "AbilityName": "tb_mohua_new",
    "IsDOTA2OriginalAbility": "false"
  },
  "templar_assassin_refraction": {
    "AbilityCooldown": "8 7 6",
    "AbilityKV": {
      "bonus_damage": "80 120 160",
      "duration": 6,
      "instances": "4 6 8",
      "shield_per_instance": "60 90 120"
    },
    "AbilityManaCost": 100,
    "AbilityName": "templar_assassin_refraction",
    "IsDOTA2OriginalAbility": "true"
  },
  "tidehunter_ravage": {
    "AbilityKV": {
      "\u0015\u0010AbilityCooldown": "20 15 10",
      "AbilityDamage": "150 250 400",
      "duration": "3 3.5 4.5",
      "radius": "450 550 750",
      "speed": 725
    },
    "AbilityManaCost": 100,
    "AbilityName": "tidehunter_ravage",
    "IsDOTA2OriginalAbility": "true"
  },
  "tiny_touzhi": {
    "AbilityCooldown": "10 8 6",
    "AbilityKV": {
      "damage": "100 200 300",
      "damage_radius": 200,
      "stun_duration": "1 1.5 2"
    },
    "AbilityManaCost": 100,
    "AbilityName": "tiny_touzhi",
    "IsDOTA2OriginalAbility": "false"
  },
  "tp_seed": {
    "AbilityCooldown": "8 7 6",
    "AbilityKV": {
      "damage_heal": "60 90 120",
      "damage_interval": 1,
      "duration": 5,
      "movement_speed": "-10 -20 -30",
      "radius": 400
    },
    "AbilityManaCost": 100,
    "AbilityName": "tp_seed",
    "IsDOTA2OriginalAbility": "false"
  },
  "troll_axe": {
    "AbilityKV": {
      "axe_per": "25 30 35",
      "cd_axe_melee": "3 2 1",
      "cd_axe_ranged": "3 2 1",
      "damage_axe_melee": "150 250 350",
      "damage_axe_ranged": "150 250 350"
    },
    "AbilityName": "troll_axe",
    "IsDOTA2OriginalAbility": "false"
  },
  "tusk_walrus_punch_lua": {
    "AbilityCooldown": "5 4 3",
    "AbilityKV": {
      "crit_multiplier": "200 275 350"
    },
    "AbilityManaCost": 100,
    "AbilityName": "tusk_walrus_punch_lua",
    "IsDOTA2OriginalAbility": "false"
  },
  "ud_decay": {
    "AbilityCooldown": "10 9 8",
    "AbilityKV": {
      "damage": "100 150 200",
      "hp_per": "4 6 8",
      "radius": "250 300 350"
    },
    "AbilityManaCost": 100,
    "AbilityName": "ud_decay",
    "IsDOTA2OriginalAbility": "false"
  },
  "veno_ward": {
    "AbilityCooldown": "4 4 6",
    "AbilityKV": {
      "count": "1 1 2",
      "magic_ass": 80,
      "summon_duration": "30 30 20"
    },
    "AbilityManaCost": 100,
    "AbilityName": "veno_ward",
    "IsDOTA2OriginalAbility": "false"
  },
  "void_astralstep": {
    "AbilityCooldown": "6 5 4",
    "AbilityKV": {
      "area": 370,
      "damage": "300 400 600",
      "delay": "1.3",
      "movement_slow_pct": "20 30 40",
      "steps": "3 4 6"
    },
    "AbilityManaCost": 100,
    "AbilityName": "void_astralstep",
    "IsDOTA2OriginalAbility": "false"
  },
  "vs_swap": {
    "AbilityCooldown": 60,
    "AbilityKV": {
      "max_star": "1 2 3"
    },
    "AbilityManaCost": 0,
    "AbilityName": "vs_swap",
    "IsDOTA2OriginalAbility": "false"
  },
  "windrunner_shackleshot": {
    "AbilityKV": {
      "AbilityCooldown": "12 9 6",
      "arrow_speed": 1600,
      "fail_stun_duration": 1,
      "shackle_angle": 30,
      "shackle_count": "1 1 2",
      "shackle_distance": "600 800 1000",
      "stun_duration": "3 4 4"
    },
    "AbilityManaCost": 100,
    "AbilityName": "windrunner_shackleshot",
    "IsDOTA2OriginalAbility": "true"
  },
  "winter_wyvern_cold_embrace": {
    "AbilityCooldown": "12 10 8",
    "AbilityKV": {
      "duration": "2.0 3.0 4.0",
      "heal_additive": 20,
      "heal_percentage": 10,
      "shard_cooldown_reduction": 4,
      "shard_splinter_range": 1200
    },
    "AbilityManaCost": 100,
    "AbilityName": "winter_wyvern_cold_embrace",
    "IsDOTA2OriginalAbility": "true"
  },
  "wisp_tether_lua": {
    "AbilityKV": {
      "damage_reduction_per": "10 15 25",
      "max_distance": "400 450 500",
      "radius": "300 350 400",
      "tether_interval": "4 3 2"
    },
    "AbilityManaCost": 0,
    "AbilityName": "wisp_tether_lua",
    "IsDOTA2OriginalAbility": "false"
  },
  "witch_doctor_paralyzing_cask": {
    "AbilityCooldown": "10 9 8",
    "AbilityKV": {
      "AbilityCooldown": "10 9 8",
      "base_damage": "30 40 50",
      "bounce_bonus_damage": 0,
      "bounce_delay": "0.3",
      "bounce_range": 300,
      "bounces": "4 5 6",
      "creep_damage_pct": 100,
      "creep_duration": 1,
      "hero_duration": 1,
      "speed": 1000
    },
    "AbilityManaCost": 100,
    "AbilityName": "witch_doctor_paralyzing_cask",
    "IsDOTA2OriginalAbility": "true"
  },
  "wl_inferno": {
    "AbilityCooldown": 60,
    "AbilityKV": {
      "another_inferno_per": 50,
      "damage": 100,
      "inferno_count": "1 2 3",
      "inferno_duration": 10,
      "stun_duration": 1,
      "stun_radius": "200 200 250"
    },
    "AbilityManaCost": 100,
    "AbilityName": "wl_inferno",
    "IsDOTA2OriginalAbility": "false"
  },
  "zeus_thunder": {
    "AbilityCooldown": "15 12 9",
    "AbilityKV": {
      "damage": "300 400 600",
      "damage_courier_per": "10 15 20",
      "damage_per": "10 20 40"
    },
    "AbilityManaCost": 100,
    "AbilityName": "zeus_thunder",
    "IsDOTA2OriginalAbility": "false"
  }
}
```

#### `CustomNetTable_casino_table`

```json
{
  "casino_info": {
    "available_player_count": 8,
    "award_list": {
      "1": 2.5999999046325684,
      "2": 1.600000023841858,
      "3": 1.2000000476837158,
      "4": 1,
      "5": 0.6000000238418579,
      "6": 0.20000000298023224,
      "7": 0,
      "8": 0
    },
    "casino": 0,
    "player_list": {
      "1": "steam_id_0",
      "2": "steam_id_1",
      "3": "steam_id_2",
      "4": "steam_id_3",
      "5": "steam_id_4",
      "6": "steam_id_5",
      "7": "steam_id_6",
      "8": "steam_id_7"
    }
  }
}
```

#### `CustomNetTable_chess_kv_table`

```json
{
  "chess_aa": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 60,
    "AttackDamageMin": 30,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "aa_ice_blast",
    "ChessName": "chess_aa",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 550,
    "StatusMana": 0
  },
  "chess_aa1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 120,
    "AttackDamageMin": 60,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "aa_ice_blast",
    "ChessName": "chess_aa1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 1100,
    "StatusMana": 0
  },
  "chess_aa11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 240,
    "AttackDamageMin": 120,
    "AttackRange": 800,
    "AttackRate": 1.5,
    "ChessAbility": "aa_ice_blast",
    "ChessName": "chess_aa11",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 2200,
    "StatusMana": 0
  },
  "chess_abaddon": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 55,
    "AttackDamageMin": 45,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "abaddon_aphotic_shield",
    "ChessName": "chess_abaddon",
    "Level": 1,
    "MagicalResistance": 20,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_abaddon1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 110,
    "AttackDamageMin": 90,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "abaddon_aphotic_shield",
    "ChessName": "chess_abaddon1",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_abaddon11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 220,
    "AttackDamageMin": 180,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "abaddon_aphotic_shield",
    "ChessName": "chess_abaddon11",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_am": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 110,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "am_mana_break",
    "ChessName": "chess_am",
    "Level": 4,
    "MagicalResistance": 30,
    "StatusHealth": 850,
    "StatusMana": 0
  },
  "chess_am1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 220,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "am_mana_break",
    "ChessName": "chess_am1",
    "Level": 6,
    "MagicalResistance": 30,
    "StatusHealth": 1700,
    "StatusMana": 0
  },
  "chess_am11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 440,
    "AttackDamageMin": 320,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "am_mana_break",
    "ChessName": "chess_am11",
    "Level": 8,
    "MagicalResistance": 30,
    "StatusHealth": 3400,
    "StatusMana": 0
  },
  "chess_au": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 160,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "au_portal",
    "ChessName": "chess_au",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1250,
    "StatusMana": 0
  },
  "chess_au1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 320,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "au_portal",
    "ChessName": "chess_au1",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2500,
    "StatusMana": 0
  },
  "chess_au11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 640,
    "AttackDamageMin": 400,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "au_portal",
    "ChessName": "chess_au11",
    "Level": 9,
    "MagicalResistance": 20,
    "StatusHealth": 5000,
    "StatusMana": 0
  },
  "chess_aw": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 150,
    "AttackDamageMin": 90,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "arc_double",
    "ChessName": "chess_aw",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 0
  },
  "chess_aw1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 300,
    "AttackDamageMin": 180,
    "AttackRange": 600,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "arc_double",
    "ChessName": "chess_aw1",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 1700,
    "StatusMana": 0
  },
  "chess_aw11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 600,
    "AttackDamageMin": 360,
    "AttackRange": 600,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "arc_double",
    "ChessName": "chess_aw11",
    "Level": 9,
    "MagicalResistance": 0,
    "StatusHealth": 3400,
    "StatusMana": 0
  },
  "chess_axe": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 70,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "axe_berserkers_call",
    "ChessName": "chess_axe",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 750,
    "StatusMana": 100
  },
  "chess_axe1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 140,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "axe_berserkers_call",
    "ChessName": "chess_axe1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1500,
    "StatusMana": 100
  },
  "chess_axe11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 280,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "axe_berserkers_call",
    "ChessName": "chess_axe11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 3000,
    "StatusMana": 100
  },
  "chess_bane": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 50,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "bane_fiends_grip",
    "ChessName": "chess_bane",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_bane1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 100,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "bane_fiends_grip",
    "ChessName": "chess_bane1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_bane11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 200,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "bane_fiends_grip",
    "ChessName": "chess_bane11",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_bat": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 55,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "batrider_firefly",
    "ChessName": "chess_bat",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_bat1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 110,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "batrider_firefly",
    "ChessName": "chess_bat1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_bat11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 220,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "batrider_firefly",
    "ChessName": "chess_bat11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_bh": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 70,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "bh_shuriken",
    "ChessName": "chess_bh",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 500,
    "StatusMana": 100
  },
  "chess_bh1": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 140,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "bh_shuriken",
    "ChessName": "chess_bh1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_bh11": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 280,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "bh_shuriken",
    "ChessName": "chess_bh11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_bm": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 70,
    "AttackDamageMin": 60,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "bm_beast",
    "ChessName": "chess_bm",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 650,
    "StatusMana": 100
  },
  "chess_bm1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 140,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "bm_beast",
    "ChessName": "chess_bm1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1300,
    "StatusMana": 100
  },
  "chess_bm11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 280,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "bm_beast",
    "ChessName": "chess_bm11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2600,
    "StatusMana": 100
  },
  "chess_br": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 110,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "br_web_new",
    "ChessName": "chess_br",
    "Level": 4,
    "MagicalResistance": 20,
    "StatusHealth": 950,
    "StatusMana": 0
  },
  "chess_br1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 220,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "br_web_new",
    "ChessName": "chess_br1",
    "Level": 6,
    "MagicalResistance": 20,
    "StatusHealth": 1900,
    "StatusMana": 0
  },
  "chess_br11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 440,
    "AttackDamageMin": 320,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "br_web_new",
    "ChessName": "chess_br11",
    "Level": 8,
    "MagicalResistance": 20,
    "StatusHealth": 3800,
    "StatusMana": 0
  },
  "chess_brew": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "brewmaster_cinder_brew",
    "ChessName": "chess_brew",
    "Level": 1,
    "MagicalResistance": 20,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_brew1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "brewmaster_cinder_brew",
    "ChessName": "chess_brew1",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_brew11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "brewmaster_cinder_brew",
    "ChessName": "chess_brew11",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_brew_ssr": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "brew_ssr_3_pandas",
    "ChessName": "chess_brew_ssr",
    "Level": 9,
    "MagicalResistance": 0,
    "StatusHealth": 3200,
    "StatusMana": 100
  },
  "chess_bs": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 60,
    "AttackDamageMin": 55,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "bloodseeker_blood_bath_lua",
    "ChessName": "chess_bs",
    "Level": 2,
    "MagicalResistance": 10,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_bs1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 120,
    "AttackDamageMin": 110,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "bloodseeker_blood_bath_lua",
    "ChessName": "chess_bs1",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_bs11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 240,
    "AttackDamageMin": 220,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "bloodseeker_blood_bath_lua",
    "ChessName": "chess_bs11",
    "Level": 6,
    "MagicalResistance": 10,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_chen": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 60,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "chen_fuhuo",
    "ChessName": "chess_chen",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_chen1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "chen_fuhuo",
    "ChessName": "chess_chen1",
    "Level": 6,
    "MagicalResistance": 10,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_chen11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "chen_fuhuo",
    "ChessName": "chess_chen11",
    "Level": 8,
    "MagicalResistance": 10,
    "StatusHealth": 3600,
    "StatusMana": 100
  },
  "chess_ck": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 160,
    "AttackDamageMin": 40,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "chaos_knight_chaos_strike",
    "ChessName": "chess_ck",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 650,
    "StatusMana": 0
  },
  "chess_ck1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 320,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "chaos_knight_chaos_strike",
    "ChessName": "chess_ck1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1300,
    "StatusMana": 0
  },
  "chess_ck11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 640,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "chaos_knight_chaos_strike",
    "ChessName": "chess_ck11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2600,
    "StatusMana": 0
  },
  "chess_ck_ssr": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 440,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "ck_illusion",
    "ChessName": "chess_ck_ssr",
    "Level": 9,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_ck_ssr_illusion": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 440,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessName": "chess_ck_ssr_illusion",
    "Level": 15,
    "MagicalResistance": 0,
    "StatusHealth": 3000,
    "StatusMana": 0
  },
  "chess_clinkz": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 60,
    "AttackDamageMin": 40,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "clinkz_burning_barrage",
    "ChessName": "chess_clinkz",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 500,
    "StatusMana": 100
  },
  "chess_clinkz1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "clinkz_burning_barrage",
    "ChessName": "chess_clinkz1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_clinkz11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "clinkz_burning_barrage",
    "ChessName": "chess_clinkz11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_clock": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 55,
    "AttackDamageMin": 45,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "rattletrap_battery_assault",
    "ChessName": "chess_clock",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_clock1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 110,
    "AttackDamageMin": 90,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "rattletrap_battery_assault",
    "ChessName": "chess_clock1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_clock11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 220,
    "AttackDamageMin": 180,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "rattletrap_battery_assault",
    "ChessName": "chess_clock11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_cm": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 45,
    "AttackDamageMin": 40,
    "AttackRange": 600,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "cm_mana_aura",
    "ChessName": "chess_cm",
    "Level": 1,
    "MagicalResistance": 5,
    "StatusHealth": 450,
    "StatusMana": 0
  },
  "chess_cm1": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 90,
    "AttackDamageMin": 80,
    "AttackRange": 600,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "cm_mana_aura",
    "ChessName": "chess_cm1",
    "Level": 3,
    "MagicalResistance": 5,
    "StatusHealth": 900,
    "StatusMana": 0
  },
  "chess_cm11": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 180,
    "AttackDamageMin": 160,
    "AttackRange": 600,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "cm_mana_aura",
    "ChessName": "chess_cm11",
    "Level": 5,
    "MagicalResistance": 5,
    "StatusHealth": 1800,
    "StatusMana": 0
  },
  "chess_ct": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 60,
    "AttackDamageMin": 55,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "ct_double_edge",
    "ChessName": "chess_ct",
    "Level": 2,
    "MagicalResistance": 15,
    "StatusHealth": 850,
    "StatusMana": 0
  },
  "chess_ct1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 120,
    "AttackDamageMin": 110,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "ct_double_edge",
    "ChessName": "chess_ct1",
    "Level": 4,
    "MagicalResistance": 15,
    "StatusHealth": 1700,
    "StatusMana": 0
  },
  "chess_ct11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 240,
    "AttackDamageMin": 220,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "ct_double_edge",
    "ChessName": "chess_ct11",
    "Level": 6,
    "MagicalResistance": 15,
    "StatusHealth": 3400,
    "StatusMana": 0
  },
  "chess_dazzle": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 60,
    "AttackDamageMin": 45,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "dazzle_bozang",
    "ChessName": "chess_dazzle",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 450,
    "StatusMana": 100
  },
  "chess_dazzle1": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 120,
    "AttackDamageMin": 90,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "dazzle_bozang",
    "ChessName": "chess_dazzle1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_dazzle11": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 240,
    "AttackDamageMin": 180,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "dazzle_bozang",
    "ChessName": "chess_dazzle11",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_db": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 110,
    "AttackDamageMin": 70,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "dawnbreaker_fire_wreath",
    "ChessName": "chess_db",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_db1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 220,
    "AttackDamageMin": 140,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "dawnbreaker_fire_wreath",
    "ChessName": "chess_db1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_db11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 440,
    "AttackDamageMin": 280,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "dawnbreaker_fire_wreath",
    "ChessName": "chess_db11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_disruptor": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 70,
    "AttackDamageMin": 50,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "ability_disruptor_static_storm",
    "ChessName": "chess_disruptor",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_disruptor1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 140,
    "AttackDamageMin": 100,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "ability_disruptor_static_storm",
    "ChessName": "chess_disruptor1",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_disruptor11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 280,
    "AttackDamageMin": 200,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "ability_disruptor_static_storm",
    "ChessName": "chess_disruptor11",
    "Level": 9,
    "MagicalResistance": 20,
    "StatusHealth": 4000,
    "StatusMana": 100
  },
  "chess_dk": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 90,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "dk_dragon_form",
    "ChessName": "chess_dk",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_dk1": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 180,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "dk_dragon_form",
    "ChessName": "chess_dk1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_dk11": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 360,
    "AttackDamageMin": 320,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "dk_dragon_form",
    "ChessName": "chess_dk11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 3600,
    "StatusMana": 100
  },
  "chess_dk11_dragon": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 430,
    "AttackDamageMin": 370,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessName": "chess_dk11_dragon",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 3600,
    "StatusMana": 0
  },
  "chess_dk1_dragon": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 320,
    "AttackDamageMin": 280,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessName": "chess_dk1_dragon",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 0
  },
  "chess_dk_dragon": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 210,
    "AttackDamageMin": 190,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessName": "chess_dk_dragon",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 0
  },
  "chess_doom": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 120,
    "AttackDamageMin": 110,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "doom_bringer_doom",
    "ChessName": "chess_doom",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1050,
    "StatusMana": 100
  },
  "chess_doom1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 240,
    "AttackDamageMin": 220,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "doom_bringer_doom",
    "ChessName": "chess_doom1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2100,
    "StatusMana": 100
  },
  "chess_doom11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 480,
    "AttackDamageMin": 440,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "doom_bringer_doom",
    "ChessName": "chess_doom11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 4200,
    "StatusMana": 100
  },
  "chess_dp": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "death_prophet_exorcism",
    "ChessName": "chess_dp",
    "Level": 4,
    "MagicalResistance": 30,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_dp1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "death_prophet_exorcism",
    "ChessName": "chess_dp1",
    "Level": 6,
    "MagicalResistance": 30,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_dp11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "death_prophet_exorcism",
    "ChessName": "chess_dp11",
    "Level": 8,
    "MagicalResistance": 30,
    "StatusHealth": 3600,
    "StatusMana": 100
  },
  "chess_dr": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 100,
    "AttackDamageMin": 70,
    "AttackRange": 600,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "ability_drow_ranger_wave_of_silence",
    "ChessName": "chess_dr",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_dr1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 200,
    "AttackDamageMin": 140,
    "AttackRange": 600,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "ability_drow_ranger_wave_of_silence",
    "ChessName": "chess_dr1",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_dr11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 400,
    "AttackDamageMin": 280,
    "AttackRange": 600,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "ability_drow_ranger_wave_of_silence",
    "ChessName": "chess_dr11",
    "Level": 7,
    "MagicalResistance": 10,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_ds": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 90,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "dark_seer_ion_shell",
    "ChessName": "chess_ds",
    "Level": 2,
    "MagicalResistance": 10,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_ds1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 180,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "dark_seer_ion_shell",
    "ChessName": "chess_ds1",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_ds11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 360,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "dark_seer_ion_shell",
    "ChessName": "chess_ds11",
    "Level": 6,
    "MagicalResistance": 10,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_dw": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 70,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "dw_flower",
    "ChessName": "chess_dw",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 450,
    "StatusMana": 0
  },
  "chess_dw1": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 140,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "dw_flower",
    "ChessName": "chess_dw1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 0
  },
  "chess_dw11": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 280,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "dw_flower",
    "ChessName": "chess_dw11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 0
  },
  "chess_earth": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 70,
    "AttackDamageMin": 40,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "earth_rock_roll",
    "ChessName": "chess_earth",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_earth1": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 140,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "earth_rock_roll",
    "ChessName": "chess_earth1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_earth11": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 320,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "earth_rock_roll",
    "ChessName": "chess_earth11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 3600,
    "StatusMana": 100
  },
  "chess_eh": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "eh_untouchable_aura",
    "ChessName": "chess_eh",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 400,
    "StatusMana": 0
  },
  "chess_eh1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "eh_untouchable_aura",
    "ChessName": "chess_eh1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 800,
    "StatusMana": 0
  },
  "chess_eh11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "eh_untouchable_aura",
    "ChessName": "chess_eh11",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 1500,
    "StatusMana": 0
  },
  "chess_ember": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 80,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "sleight_of_fist_datadriven",
    "ChessName": "chess_ember",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_ember1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 160,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "sleight_of_fist_datadriven",
    "ChessName": "chess_ember1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_ember11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 320,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "sleight_of_fist_datadriven",
    "ChessName": "chess_ember11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_enigma": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 55,
    "AttackDamageMin": 45,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "midnight_pulse_datadriven",
    "ChessName": "chess_enigma",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_enigma1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 110,
    "AttackDamageMin": 90,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "midnight_pulse_datadriven",
    "ChessName": "chess_enigma1",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_enigma11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 220,
    "AttackDamageMin": 180,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "midnight_pulse_datadriven",
    "ChessName": "chess_enigma11",
    "Level": 7,
    "MagicalResistance": 10,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_es": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "gouhe",
    "ChessName": "chess_es",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_es1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "gouhe",
    "ChessName": "chess_es1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_es11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 480,
    "AttackDamageMin": 320,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "gouhe",
    "ChessName": "chess_es11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_et": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 130,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "et_earth_splitter",
    "ChessName": "chess_et",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_et1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 260,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "et_earth_splitter",
    "ChessName": "chess_et1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_et11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 520,
    "AttackDamageMin": 400,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "et_earth_splitter",
    "ChessName": "chess_et11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 3100,
    "StatusMana": 100
  },
  "chess_fur": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 50,
    "AttackDamageMin": 45,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "fur_tree",
    "ChessName": "chess_fur",
    "Level": 2,
    "MagicalResistance": 5,
    "StatusHealth": 500,
    "StatusMana": 100
  },
  "chess_fur1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 100,
    "AttackDamageMin": 90,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "fur_tree",
    "ChessName": "chess_fur1",
    "Level": 4,
    "MagicalResistance": 5,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_fur11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 200,
    "AttackDamageMin": 180,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "fur_tree",
    "ChessName": "chess_fur11",
    "Level": 5,
    "MagicalResistance": 5,
    "StatusHealth": 1900,
    "StatusMana": 100
  },
  "chess_fv": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 80,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "fv_zhao_new",
    "ChessName": "chess_fv",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_fv1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 180,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "fv_zhao_new",
    "ChessName": "chess_fv1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_fv11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 360,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "fv_zhao_new",
    "ChessName": "chess_fv11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_ga": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 110,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "alchemist_chemical_rage",
    "ChessName": "chess_ga",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1050,
    "StatusMana": 100
  },
  "chess_ga1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 220,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "alchemist_chemical_rage",
    "ChessName": "chess_ga1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2100,
    "StatusMana": 100
  },
  "chess_ga11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 440,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "alchemist_chemical_rage",
    "ChessName": "chess_ga11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 4200,
    "StatusMana": 100
  },
  "chess_gs": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 60,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "gs_mingyunzhibi",
    "ChessName": "chess_gs",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 500,
    "StatusMana": 0
  },
  "chess_gs1": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "gs_mingyunzhibi",
    "ChessName": "chess_gs1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1000,
    "StatusMana": 0
  },
  "chess_gs11": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "gs_mingyunzhibi",
    "ChessName": "chess_gs11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2000,
    "StatusMana": 0
  },
  "chess_gyro": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 85,
    "AttackDamageMin": 65,
    "AttackRange": 400,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "gyro_flak_cannon",
    "ChessName": "chess_gyro",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 0
  },
  "chess_gyro1": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 170,
    "AttackDamageMin": 130,
    "AttackRange": 400,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "gyro_flak_cannon",
    "ChessName": "chess_gyro1",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 0
  },
  "chess_gyro11": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 340,
    "AttackDamageMin": 260,
    "AttackRange": 400,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "gyro_flak_cannon",
    "ChessName": "chess_gyro11",
    "Level": 9,
    "MagicalResistance": 0,
    "StatusHealth": 3600,
    "StatusMana": 0
  },
  "chess_huskar": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 100,
    "AttackDamageMin": 70,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "burning_spear_datadriven",
    "ChessName": "chess_huskar",
    "Level": 3,
    "MagicalResistance": 25,
    "StatusHealth": 700,
    "StatusMana": 0
  },
  "chess_huskar1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 200,
    "AttackDamageMin": 140,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "burning_spear_datadriven",
    "ChessName": "chess_huskar1",
    "Level": 5,
    "MagicalResistance": 25,
    "StatusHealth": 1400,
    "StatusMana": 0
  },
  "chess_huskar11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 400,
    "AttackDamageMin": 280,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "burning_spear_datadriven",
    "ChessName": "chess_huskar11",
    "Level": 7,
    "MagicalResistance": 25,
    "StatusHealth": 2800,
    "StatusMana": 0
  },
  "chess_hw": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 60,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "hoodwink_acorn_shot_datadriven",
    "ChessName": "chess_hw",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 550,
    "StatusMana": 0
  },
  "chess_hw1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "hoodwink_acorn_shot_datadriven",
    "ChessName": "chess_hw1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1100,
    "StatusMana": 0
  },
  "chess_hw11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "hoodwink_acorn_shot_datadriven",
    "ChessName": "chess_hw11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2200,
    "StatusMana": 0
  },
  "chess_io": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 60,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "wisp_tether_lua",
    "ChessName": "chess_io",
    "Level": 5,
    "MagicalResistance": 30,
    "StatusHealth": 700,
    "StatusMana": 0
  },
  "chess_io1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "wisp_tether_lua",
    "ChessName": "chess_io1",
    "Level": 7,
    "MagicalResistance": 30,
    "StatusHealth": 1400,
    "StatusMana": 0
  },
  "chess_io11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "wisp_tether_lua",
    "ChessName": "chess_io11",
    "Level": 9,
    "MagicalResistance": 30,
    "StatusHealth": 2800,
    "StatusMana": 0
  },
  "chess_jugg": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 70,
    "AttackDamageMin": 65,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "juggernaut_blade_fury_lua",
    "ChessName": "chess_jugg",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_jugg1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 140,
    "AttackDamageMin": 130,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "juggernaut_blade_fury_lua",
    "ChessName": "chess_jugg1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_jugg11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 280,
    "AttackDamageMin": 260,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "juggernaut_blade_fury_lua",
    "ChessName": "chess_jugg11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_kael": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 80,
    "AttackDamageMin": 70,
    "AttackRange": 600,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "invoke",
    "ChessName": "chess_kael",
    "Level": 5,
    "MagicalResistance": 30,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_kael1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 160,
    "AttackDamageMin": 140,
    "AttackRange": 600,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "invoke",
    "ChessName": "chess_kael1",
    "Level": 7,
    "MagicalResistance": 30,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_kael11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 320,
    "AttackDamageMin": 280,
    "AttackRange": 600,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "invoke",
    "ChessName": "chess_kael11",
    "Level": 9,
    "MagicalResistance": 30,
    "StatusHealth": 3600,
    "StatusMana": 100
  },
  "chess_kez": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 100,
    "AttackDamageMin": 60,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "kez_kazurai_katana_datadriven",
    "ChessName": "chess_kez",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 650,
    "StatusMana": 100
  },
  "chess_kez1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 200,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "kez_kazurai_katana_datadriven",
    "ChessName": "chess_kez1",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1300,
    "StatusMana": 100
  },
  "chess_kez11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 400,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "kez_kazurai_katana_datadriven",
    "ChessName": "chess_kez11",
    "Level": 7,
    "MagicalResistance": 10,
    "StatusHealth": 2600,
    "StatusMana": 100
  },
  "chess_kunkka": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 100,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "kunkka_ship",
    "ChessName": "chess_kunkka",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 950,
    "StatusMana": 100
  },
  "chess_kunkka1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 200,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "kunkka_ship",
    "ChessName": "chess_kunkka1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1900,
    "StatusMana": 100
  },
  "chess_kunkka11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 400,
    "AttackDamageMin": 320,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "kunkka_ship",
    "ChessName": "chess_kunkka11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 3800,
    "StatusMana": 100
  },
  "chess_largo": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "largo_frogstomp",
    "ChessName": "chess_largo",
    "Level": 2,
    "MagicalResistance": 20,
    "StatusHealth": 800,
    "StatusMana": 100
  },
  "chess_largo1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "largo_frogstomp",
    "ChessName": "chess_largo1",
    "Level": 4,
    "MagicalResistance": 20,
    "StatusHealth": 1600,
    "StatusMana": 100
  },
  "chess_largo11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "largo_frogstomp",
    "ChessName": "chess_largo11",
    "Level": 6,
    "MagicalResistance": 20,
    "StatusHealth": 3200,
    "StatusMana": 100
  },
  "chess_lc": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 100,
    "AttackDamageMin": 70,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "lc_qianggong",
    "ChessName": "chess_lc",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 800,
    "StatusMana": 0
  },
  "chess_lc1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 200,
    "AttackDamageMin": 140,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "lc_qianggong",
    "ChessName": "chess_lc1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1600,
    "StatusMana": 0
  },
  "chess_lc11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 400,
    "AttackDamageMin": 280,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "lc_qianggong",
    "ChessName": "chess_lc11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 3200,
    "StatusMana": 0
  },
  "chess_ld": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "ld_bear",
    "ChessName": "chess_ld",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 800,
    "StatusMana": 100
  },
  "chess_ld1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "ld_bear",
    "ChessName": "chess_ld1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1600,
    "StatusMana": 100
  },
  "chess_ld11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "ld_bear",
    "ChessName": "chess_ld11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_lich": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 70,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "lich_chain_frost",
    "ChessName": "chess_lich",
    "Level": 4,
    "MagicalResistance": 30,
    "StatusHealth": 800,
    "StatusMana": 100
  },
  "chess_lich1": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 140,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "lich_chain_frost",
    "ChessName": "chess_lich1",
    "Level": 6,
    "MagicalResistance": 30,
    "StatusHealth": 1600,
    "StatusMana": 100
  },
  "chess_lich11": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 280,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "lich_chain_frost",
    "ChessName": "chess_lich11",
    "Level": 8,
    "MagicalResistance": 30,
    "StatusHealth": 3200,
    "StatusMana": 100
  },
  "chess_light": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 45,
    "AttackDamageMin": 40,
    "AttackRange": 600,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "keeper_of_the_light_illuminate",
    "ChessName": "chess_light",
    "Level": 4,
    "MagicalResistance": 20,
    "StatusHealth": 650,
    "StatusMana": 100
  },
  "chess_light1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 90,
    "AttackDamageMin": 80,
    "AttackRange": 600,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "keeper_of_the_light_illuminate",
    "ChessName": "chess_light1",
    "Level": 6,
    "MagicalResistance": 20,
    "StatusHealth": 1300,
    "StatusMana": 100
  },
  "chess_light11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 180,
    "AttackDamageMin": 160,
    "AttackRange": 600,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "keeper_of_the_light_illuminate",
    "ChessName": "chess_light11",
    "Level": 8,
    "MagicalResistance": 20,
    "StatusHealth": 2600,
    "StatusMana": 100
  },
  "chess_lina": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 55,
    "AttackDamageMin": 50,
    "AttackRange": 600,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "lina_laguna_blade",
    "ChessName": "chess_lina",
    "Level": 2,
    "MagicalResistance": 10,
    "StatusHealth": 500,
    "StatusMana": 100
  },
  "chess_lina1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 110,
    "AttackDamageMin": 100,
    "AttackRange": 600,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "lina_laguna_blade",
    "ChessName": "chess_lina1",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_lina11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 220,
    "AttackDamageMin": 200,
    "AttackRange": 600,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "lina_laguna_blade",
    "ChessName": "chess_lina11",
    "Level": 6,
    "MagicalResistance": 10,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_lion": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 55,
    "AttackDamageMin": 45,
    "AttackRange": 400,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "lion_finger_of_death",
    "ChessName": "chess_lion",
    "Level": 4,
    "MagicalResistance": 20,
    "StatusHealth": 750,
    "StatusMana": 100
  },
  "chess_lion1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 110,
    "AttackDamageMin": 90,
    "AttackRange": 400,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "lion_finger_of_death",
    "ChessName": "chess_lion1",
    "Level": 6,
    "MagicalResistance": 20,
    "StatusHealth": 1500,
    "StatusMana": 100
  },
  "chess_lion11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 220,
    "AttackDamageMin": 180,
    "AttackRange": 400,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "lion_finger_of_death",
    "ChessName": "chess_lion11",
    "Level": 8,
    "MagicalResistance": 20,
    "StatusHealth": 3000,
    "StatusMana": 100
  },
  "chess_luna": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 70,
    "AttackDamageMin": 60,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "luna_moon_glaive",
    "ChessName": "chess_luna",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 600,
    "StatusMana": 0
  },
  "chess_luna1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 140,
    "AttackDamageMin": 120,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "luna_moon_glaive",
    "ChessName": "chess_luna1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 0
  },
  "chess_luna11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 280,
    "AttackDamageMin": 240,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "luna_moon_glaive",
    "ChessName": "chess_luna11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2400,
    "StatusMana": 0
  },
  "chess_lyc": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "lyc_wolf",
    "ChessName": "chess_lyc",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_lyc1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "lyc_wolf",
    "ChessName": "chess_lyc1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_lyc11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "lyc_wolf",
    "ChessName": "chess_lyc11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_lyc11_wolf": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 340,
    "AttackDamageMin": 300,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessName": "chess_lyc11_wolf",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 0
  },
  "chess_lyc1_wolf": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 195,
    "AttackDamageMin": 175,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessName": "chess_lyc1_wolf",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1400,
    "StatusMana": 0
  },
  "chess_lyc_wolf": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 110,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessName": "chess_lyc_wolf",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 700,
    "StatusMana": 0
  },
  "chess_mag": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 75,
    "AttackDamageMin": 65,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "mag_reverse_polarity",
    "ChessName": "chess_mag",
    "Level": 4,
    "MagicalResistance": 5,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_mag1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 150,
    "AttackDamageMin": 130,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "mag_reverse_polarity",
    "ChessName": "chess_mag1",
    "Level": 6,
    "MagicalResistance": 5,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_mag11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 300,
    "AttackDamageMin": 260,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "mag_reverse_polarity",
    "ChessName": "chess_mag11",
    "Level": 8,
    "MagicalResistance": 5,
    "StatusHealth": 3600,
    "StatusMana": 100
  },
  "chess_marci": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 90,
    "AttackDamageMin": 70,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "marci_unleash",
    "ChessName": "chess_marci",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_marci1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 180,
    "AttackDamageMin": 140,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "marci_unleash",
    "ChessName": "chess_marci1",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_marci11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 360,
    "AttackDamageMin": 280,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "marci_unleash",
    "ChessName": "chess_marci11",
    "Level": 7,
    "MagicalResistance": 10,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_mars": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 80,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.899999976158142,
    "ChessAbility": "mars_bulwark_attack",
    "ChessName": "chess_mars",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 700,
    "StatusMana": 0
  },
  "chess_mars1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 160,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.899999976158142,
    "ChessAbility": "mars_bulwark_attack",
    "ChessName": "chess_mars1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1400,
    "StatusMana": 0
  },
  "chess_mars11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 320,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.899999976158142,
    "ChessAbility": "mars_bulwark_attack",
    "ChessName": "chess_mars11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2800,
    "StatusMana": 0
  },
  "chess_medusa": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 40,
    "AttackDamageMin": 25,
    "AttackRange": 400,
    "AttackRate": 1,
    "ChessAbility": "medusa_stone_gaze",
    "ChessName": "chess_medusa",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 750,
    "StatusMana": 100
  },
  "chess_medusa1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 80,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1,
    "ChessAbility": "medusa_stone_gaze",
    "ChessName": "chess_medusa1",
    "Level": 6,
    "MagicalResistance": 10,
    "StatusHealth": 1500,
    "StatusMana": 100
  },
  "chess_medusa11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 160,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1,
    "ChessAbility": "medusa_stone_gaze",
    "ChessName": "chess_medusa11",
    "Level": 8,
    "MagicalResistance": 10,
    "StatusHealth": 3000,
    "StatusMana": 100
  },
  "chess_meepo": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "poof",
    "ChessName": "chess_meepo",
    "Level": 2,
    "MagicalResistance": 10,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_meepo1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "poof",
    "ChessName": "chess_meepo1",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_meepo11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "poof",
    "ChessName": "chess_meepo11",
    "Level": 6,
    "MagicalResistance": 10,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_mk": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 90,
    "AttackDamageMin": 70,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "mk_ruyibangfa",
    "ChessName": "chess_mk",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 0
  },
  "chess_mk1": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 180,
    "AttackDamageMin": 140,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "mk_ruyibangfa",
    "ChessName": "chess_mk1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 0
  },
  "chess_mk11": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 360,
    "AttackDamageMin": 280,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "mk_ruyibangfa",
    "ChessName": "chess_mk11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 3600,
    "StatusMana": 0
  },
  "chess_morph": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 80,
    "AttackDamageMin": 70,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "morphling_waveform",
    "ChessName": "chess_morph",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1000,
    "StatusMana": 0
  },
  "chess_morph1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 160,
    "AttackDamageMin": 140,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "morphling_waveform",
    "ChessName": "chess_morph1",
    "Level": 7,
    "MagicalResistance": 10,
    "StatusHealth": 2000,
    "StatusMana": 0
  },
  "chess_morph11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 320,
    "AttackDamageMin": 280,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "morphling_waveform",
    "ChessName": "chess_morph11",
    "Level": 9,
    "MagicalResistance": 10,
    "StatusHealth": 4000,
    "StatusMana": 0
  },
  "chess_muerta": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 100,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "muerta_pierce_the_veil",
    "ChessName": "chess_muerta",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_muerta1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 200,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "muerta_pierce_the_veil",
    "ChessName": "chess_muerta1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_muerta11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 400,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "muerta_pierce_the_veil",
    "ChessName": "chess_muerta11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_na": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 90,
    "AttackDamageMin": 45,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "nyx_assassin_spiked_carapace_datadriven",
    "ChessName": "chess_na",
    "Level": 4,
    "MagicalResistance": 20,
    "StatusHealth": 950,
    "StatusMana": 100
  },
  "chess_na1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 180,
    "AttackDamageMin": 90,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "nyx_assassin_spiked_carapace_datadriven",
    "ChessName": "chess_na1",
    "Level": 6,
    "MagicalResistance": 20,
    "StatusHealth": 1900,
    "StatusMana": 100
  },
  "chess_na11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 360,
    "AttackDamageMin": 180,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "nyx_assassin_spiked_carapace_datadriven",
    "ChessName": "chess_na11",
    "Level": 8,
    "MagicalResistance": 20,
    "StatusHealth": 3800,
    "StatusMana": 100
  },
  "chess_naga": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 90,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "siren_song",
    "ChessName": "chess_naga",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 650,
    "StatusMana": 100
  },
  "chess_naga1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 180,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "siren_song",
    "ChessName": "chess_naga1",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1300,
    "StatusMana": 100
  },
  "chess_naga11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 360,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "siren_song",
    "ChessName": "chess_naga11",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2600,
    "StatusMana": 100
  },
  "chess_naix": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 80,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "life_stealer_rage",
    "ChessName": "chess_naix",
    "Level": 2,
    "MagicalResistance": 50,
    "StatusHealth": 700,
    "StatusMana": 0
  },
  "chess_naix1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 160,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "life_stealer_rage",
    "ChessName": "chess_naix1",
    "Level": 4,
    "MagicalResistance": 30,
    "StatusHealth": 1400,
    "StatusMana": 0
  },
  "chess_naix11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 320,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "life_stealer_rage",
    "ChessName": "chess_naix11",
    "Level": 6,
    "MagicalResistance": 30,
    "StatusHealth": 2800,
    "StatusMana": 0
  },
  "chess_nec": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 100,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "nec_scythe",
    "ChessName": "chess_nec",
    "Level": 5,
    "MagicalResistance": 30,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_nec1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 200,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "nec_scythe",
    "ChessName": "chess_nec1",
    "Level": 7,
    "MagicalResistance": 30,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_nec11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 400,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "nec_scythe",
    "ChessName": "chess_nec11",
    "Level": 9,
    "MagicalResistance": 30,
    "StatusHealth": 4000,
    "StatusMana": 100
  },
  "chess_ok": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 120,
    "AttackDamageMin": 90,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "ok_angel",
    "ChessName": "chess_ok",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1100,
    "StatusMana": 0
  },
  "chess_ok1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 240,
    "AttackDamageMin": 180,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "ok_angel",
    "ChessName": "chess_ok1",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2200,
    "StatusMana": 0
  },
  "chess_ok11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 480,
    "AttackDamageMin": 360,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "ok_angel",
    "ChessName": "chess_ok11",
    "Level": 9,
    "MagicalResistance": 20,
    "StatusHealth": 4400,
    "StatusMana": 0
  },
  "chess_om": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 75,
    "AttackDamageMin": 55,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "om_multi_cast_aura",
    "ChessName": "chess_om",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 950,
    "StatusMana": 0
  },
  "chess_om1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 150,
    "AttackDamageMin": 110,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "om_multi_cast_aura",
    "ChessName": "chess_om1",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1900,
    "StatusMana": 0
  },
  "chess_om11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 300,
    "AttackDamageMin": 220,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "om_multi_cast_aura",
    "ChessName": "chess_om11",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 3800,
    "StatusMana": 0
  },
  "chess_om_ssr": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 300,
    "AttackDamageMin": 220,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "jakiro_dual_breath",
    "ChessName": "chess_om_ssr",
    "Level": 9,
    "MagicalResistance": 0,
    "StatusHealth": 3400,
    "StatusMana": 100
  },
  "chess_oracle": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 60,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "oracle_rain_of_destiny_datadriven",
    "ChessName": "chess_oracle",
    "Level": 2,
    "MagicalResistance": 10,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_oracle1": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "oracle_rain_of_destiny_datadriven",
    "ChessName": "chess_oracle1",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_oracle11": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "oracle_rain_of_destiny_datadriven",
    "ChessName": "chess_oracle11",
    "Level": 6,
    "MagicalResistance": 10,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_pa": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 100,
    "AttackDamageMin": 90,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "phantom_assassin_coup_de_grace",
    "ChessName": "chess_pa",
    "Level": 4,
    "MagicalResistance": 20,
    "StatusHealth": 800,
    "StatusMana": 0
  },
  "chess_pa1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 200,
    "AttackDamageMin": 180,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "phantom_assassin_coup_de_grace",
    "ChessName": "chess_pa1",
    "Level": 6,
    "MagicalResistance": 20,
    "StatusHealth": 1600,
    "StatusMana": 0
  },
  "chess_pa11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 400,
    "AttackDamageMin": 360,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "phantom_assassin_coup_de_grace",
    "ChessName": "chess_pa11",
    "Level": 8,
    "MagicalResistance": 20,
    "StatusHealth": 3200,
    "StatusMana": 0
  },
  "chess_pangolier": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 100,
    "AttackDamageMin": 60,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "pangolier_swashbuckle_datadriven",
    "ChessName": "chess_pangolier",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 850,
    "StatusMana": 100
  },
  "chess_pangolier1": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 200,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "pangolier_swashbuckle_datadriven",
    "ChessName": "chess_pangolier1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1700,
    "StatusMana": 100
  },
  "chess_pangolier11": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 400,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "pangolier_swashbuckle_datadriven",
    "ChessName": "chess_pangolier11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 3400,
    "StatusMana": 100
  },
  "chess_pb": {
    "ArmorPhysical": 11,
    "AttackDamageMax": 200,
    "AttackDamageMin": 150,
    "AttackRange": 205,
    "AttackRate": 1.7999999523162842,
    "ChessAbility": "primal_beast_pulverize_lua",
    "ChessName": "chess_pb",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1300,
    "StatusMana": 100
  },
  "chess_pb1": {
    "ArmorPhysical": 11,
    "AttackDamageMax": 400,
    "AttackDamageMin": 300,
    "AttackRange": 205,
    "AttackRate": 1.7999999523162842,
    "ChessAbility": "primal_beast_pulverize_lua",
    "ChessName": "chess_pb1",
    "Level": 7,
    "MagicalResistance": 10,
    "StatusHealth": 2600,
    "StatusMana": 100
  },
  "chess_pb11": {
    "ArmorPhysical": 11,
    "AttackDamageMax": 800,
    "AttackDamageMin": 600,
    "AttackRange": 205,
    "AttackRate": 1.7999999523162842,
    "ChessAbility": "primal_beast_pulverize_lua",
    "ChessName": "chess_pb11",
    "Level": 9,
    "MagicalResistance": 10,
    "StatusHealth": 5200,
    "StatusMana": 100
  },
  "chess_phx": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 90,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "phoenix_sun_ray",
    "ChessName": "chess_phx",
    "Level": 4,
    "MagicalResistance": 30,
    "StatusHealth": 850,
    "StatusMana": 0
  },
  "chess_phx1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 180,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "phoenix_sun_ray",
    "ChessName": "chess_phx1",
    "Level": 6,
    "MagicalResistance": 30,
    "StatusHealth": 1700,
    "StatusMana": 0
  },
  "chess_phx11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 360,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "phoenix_sun_ray",
    "ChessName": "chess_phx11",
    "Level": 8,
    "MagicalResistance": 30,
    "StatusHealth": 3400,
    "StatusMana": 0
  },
  "chess_pom": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 50,
    "AttackDamageMin": 40,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "pom_arrow_far",
    "ChessName": "chess_pom",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 450,
    "StatusMana": 100
  },
  "chess_pom1": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 100,
    "AttackDamageMin": 80,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "pom_arrow_far",
    "ChessName": "chess_pom1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_pom11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 200,
    "AttackDamageMin": 160,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "pom_arrow_far",
    "ChessName": "chess_pom11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_puck": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 50,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "puck_illusory_orb",
    "ChessName": "chess_puck",
    "Level": 2,
    "MagicalResistance": 50,
    "StatusHealth": 450,
    "StatusMana": 100
  },
  "chess_puck1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 100,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "puck_illusory_orb",
    "ChessName": "chess_puck1",
    "Level": 4,
    "MagicalResistance": 50,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_puck11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 200,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "puck_illusory_orb",
    "ChessName": "chess_puck11",
    "Level": 6,
    "MagicalResistance": 50,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_pudge": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 90,
    "AttackDamageMin": 60,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "pudge_meat_hook_lua",
    "ChessName": "chess_pudge",
    "Level": 3,
    "MagicalResistance": 30,
    "StatusHealth": 1000,
    "StatusMana": 0
  },
  "chess_pudge1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 180,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "pudge_meat_hook_lua",
    "ChessName": "chess_pudge1",
    "Level": 5,
    "MagicalResistance": 30,
    "StatusHealth": 2000,
    "StatusMana": 0
  },
  "chess_pudge11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 360,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "pudge_meat_hook_lua",
    "ChessName": "chess_pudge11",
    "Level": 7,
    "MagicalResistance": 30,
    "StatusHealth": 4000,
    "StatusMana": 0
  },
  "chess_qop": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 100,
    "AttackDamageMin": 75,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "queenofpain_sonic_wave_datadriven",
    "ChessName": "chess_qop",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 950,
    "StatusMana": 100
  },
  "chess_qop1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 200,
    "AttackDamageMin": 150,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "queenofpain_sonic_wave_datadriven",
    "ChessName": "chess_qop1",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 1900,
    "StatusMana": 100
  },
  "chess_qop11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 400,
    "AttackDamageMin": 300,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "queenofpain_sonic_wave_datadriven",
    "ChessName": "chess_qop11",
    "Level": 9,
    "MagicalResistance": 20,
    "StatusHealth": 3800,
    "StatusMana": 100
  },
  "chess_razor": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "razor_plasma_field",
    "ChessName": "chess_razor",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 650,
    "StatusMana": 100
  },
  "chess_razor1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "razor_plasma_field",
    "ChessName": "chess_razor1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1300,
    "StatusMana": 100
  },
  "chess_razor11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "razor_plasma_field",
    "ChessName": "chess_razor11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2600,
    "StatusMana": 100
  },
  "chess_riki": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 95,
    "AttackDamageMin": 45,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "smoke_screen_trigger",
    "ChessName": "chess_riki",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 500,
    "StatusMana": 0
  },
  "chess_riki1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 190,
    "AttackDamageMin": 90,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "smoke_screen_trigger",
    "ChessName": "chess_riki1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1000,
    "StatusMana": 0
  },
  "chess_riki11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 380,
    "AttackDamageMin": 180,
    "AttackRange": 205,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "smoke_screen_trigger",
    "ChessName": "chess_riki11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2000,
    "StatusMana": 0
  },
  "chess_rm": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 130,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "ringmaster_spotlight",
    "ChessName": "chess_rm",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1050,
    "StatusMana": 0
  },
  "chess_rm1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 260,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "ringmaster_spotlight",
    "ChessName": "chess_rm1",
    "Level": 7,
    "MagicalResistance": 10,
    "StatusHealth": 2100,
    "StatusMana": 0
  },
  "chess_rm11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 520,
    "AttackDamageMin": 320,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "ringmaster_spotlight",
    "ChessName": "chess_rm11",
    "Level": 9,
    "MagicalResistance": 10,
    "StatusHealth": 4200,
    "StatusMana": 0
  },
  "chess_rubick": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "rubick_qiequ",
    "ChessName": "chess_rubick",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_rubick1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "rubick_qiequ",
    "ChessName": "chess_rubick1",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_rubick11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "rubick_qiequ",
    "ChessName": "chess_rubick11",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_sb": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 60,
    "AttackDamageMin": 40,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "sb_julizhongji",
    "ChessName": "chess_sb",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 600,
    "StatusMana": 0
  },
  "chess_sb1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "sb_julizhongji",
    "ChessName": "chess_sb1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 0
  },
  "chess_sb11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "sb_julizhongji",
    "ChessName": "chess_sb11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2400,
    "StatusMana": 0
  },
  "chess_sd": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 70,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "sd_disseminate",
    "ChessName": "chess_sd",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 500,
    "StatusMana": 0
  },
  "chess_sd1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 140,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "sd_disseminate",
    "ChessName": "chess_sd1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 1000,
    "StatusMana": 0
  },
  "chess_sd11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 280,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "sd_disseminate",
    "ChessName": "chess_sd11",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 2000,
    "StatusMana": 0
  },
  "chess_sf": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 100,
    "AttackDamageMin": 70,
    "AttackRange": 600,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "shadow_fiend_requiem_of_souls_lua",
    "ChessName": "chess_sf",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_sf1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 200,
    "AttackDamageMin": 140,
    "AttackRange": 600,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "shadow_fiend_requiem_of_souls_lua",
    "ChessName": "chess_sf1",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_sf11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 400,
    "AttackDamageMin": 280,
    "AttackRange": 600,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "shadow_fiend_requiem_of_souls_lua",
    "ChessName": "chess_sf11",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_shredder": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 60,
    "AttackDamageMin": 55,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "shredder_whirling_death",
    "ChessName": "chess_shredder",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 750,
    "StatusMana": 100
  },
  "chess_shredder1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 120,
    "AttackDamageMin": 110,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "shredder_whirling_death",
    "ChessName": "chess_shredder1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1500,
    "StatusMana": 100
  },
  "chess_shredder11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 240,
    "AttackDamageMin": 220,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "shredder_whirling_death",
    "ChessName": "chess_shredder11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 3000,
    "StatusMana": 100
  },
  "chess_sk": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 60,
    "AttackDamageMin": 45,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "sandking_burrowstrike",
    "ChessName": "chess_sk",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_sk1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 120,
    "AttackDamageMin": 90,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "sandking_burrowstrike",
    "ChessName": "chess_sk1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_sk11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 240,
    "AttackDamageMin": 180,
    "AttackRange": 205,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "sandking_burrowstrike",
    "ChessName": "chess_sk11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_slardar": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 110,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "slardar_slithereen_crush",
    "ChessName": "chess_slardar",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 800,
    "StatusMana": 100
  },
  "chess_slardar1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 220,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "slardar_slithereen_crush",
    "ChessName": "chess_slardar1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1600,
    "StatusMana": 100
  },
  "chess_slardar11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 440,
    "AttackDamageMin": 320,
    "AttackRange": 205,
    "AttackRate": 1.5,
    "ChessAbility": "slardar_slithereen_crush",
    "ChessName": "chess_slardar11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 3200,
    "StatusMana": 100
  },
  "chess_slark": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 80,
    "AttackDamageMin": 60,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "slark_nengliangzhuanyi",
    "ChessName": "chess_slark",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 600,
    "StatusMana": 0
  },
  "chess_slark1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 160,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "slark_nengliangzhuanyi",
    "ChessName": "chess_slark1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 0
  },
  "chess_slark11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 320,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "slark_nengliangzhuanyi",
    "ChessName": "chess_slark11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2400,
    "StatusMana": 0
  },
  "chess_sm": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 60,
    "AttackDamageMin": 40,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "skywrath_mage_arcane_bolt_container",
    "ChessName": "chess_sm",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 550,
    "StatusMana": 0
  },
  "chess_sm1": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "skywrath_mage_arcane_bolt_container",
    "ChessName": "chess_sm1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 1100,
    "StatusMana": 0
  },
  "chess_sm11": {
    "ArmorPhysical": 1,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "skywrath_mage_arcane_bolt_container",
    "ChessName": "chess_sm11",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 2200,
    "StatusMana": 0
  },
  "chess_snap": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 110,
    "AttackDamageMin": 70,
    "AttackRange": 600,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "snapfire_lil_shredder",
    "ChessName": "chess_snap",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 800,
    "StatusMana": 100
  },
  "chess_snap1": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 220,
    "AttackDamageMin": 140,
    "AttackRange": 600,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "snapfire_lil_shredder",
    "ChessName": "chess_snap1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1600,
    "StatusMana": 100
  },
  "chess_snap11": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 440,
    "AttackDamageMin": 280,
    "AttackRange": 600,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "snapfire_lil_shredder",
    "ChessName": "chess_snap11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 3200,
    "StatusMana": 100
  },
  "chess_sniper": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 65,
    "AttackDamageMin": 55,
    "AttackRange": 600,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "sniper_assassinate",
    "ChessName": "chess_sniper",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 450,
    "StatusMana": 100
  },
  "chess_sniper1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 130,
    "AttackDamageMin": 110,
    "AttackRange": 600,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "sniper_assassinate",
    "ChessName": "chess_sniper1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_sniper11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 260,
    "AttackDamageMin": 220,
    "AttackRange": 600,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "sniper_assassinate",
    "ChessName": "chess_sniper11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_snk": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 200,
    "AttackDamageMin": 150,
    "AttackRange": 205,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "skeletonking_reincarnation",
    "ChessName": "chess_snk",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1300,
    "StatusMana": 0
  },
  "chess_snk1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 400,
    "AttackDamageMin": 300,
    "AttackRange": 205,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "skeletonking_reincarnation",
    "ChessName": "chess_snk1",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2600,
    "StatusMana": 0
  },
  "chess_snk11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 800,
    "AttackDamageMin": 600,
    "AttackRange": 205,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "skeletonking_reincarnation",
    "ChessName": "chess_snk11",
    "Level": 9,
    "MagicalResistance": 20,
    "StatusHealth": 5200,
    "StatusMana": 0
  },
  "chess_spe": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 120,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "spe_haunt",
    "ChessName": "chess_spe",
    "Level": 5,
    "MagicalResistance": 30,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_spe1": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 240,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "spe_haunt",
    "ChessName": "chess_spe1",
    "Level": 7,
    "MagicalResistance": 30,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_spe11": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 480,
    "AttackDamageMin": 320,
    "AttackRange": 205,
    "AttackRate": 1,
    "ChessAbility": "spe_haunt",
    "ChessName": "chess_spe11",
    "Level": 9,
    "MagicalResistance": 30,
    "StatusHealth": 4000,
    "StatusMana": 100
  },
  "chess_ss": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 50,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "lion_voodoo",
    "ChessName": "chess_ss",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_ss1": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 100,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "lion_voodoo",
    "ChessName": "chess_ss1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_ss11": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 200,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "lion_voodoo",
    "ChessName": "chess_ss11",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_ss_ssr": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 200,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "ss_ssr_wards",
    "ChessName": "chess_ss_ssr",
    "Level": 9,
    "MagicalResistance": 10,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_storm": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 70,
    "AttackDamageMin": 60,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "storm_spirit_ball_lightning_datadriven",
    "ChessName": "chess_storm",
    "Level": 4,
    "MagicalResistance": 10,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_storm1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 140,
    "AttackDamageMin": 120,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "storm_spirit_ball_lightning_datadriven",
    "ChessName": "chess_storm1",
    "Level": 6,
    "MagicalResistance": 10,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_storm11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 280,
    "AttackDamageMin": 240,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "storm_spirit_ball_lightning_datadriven",
    "ChessName": "chess_storm11",
    "Level": 8,
    "MagicalResistance": 10,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_sven": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 210,
    "AttackDamageMin": 150,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "sven_gods_strength",
    "ChessName": "chess_sven",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_sven1": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 420,
    "AttackDamageMin": 300,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "sven_gods_strength",
    "ChessName": "chess_sven1",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_sven11": {
    "ArmorPhysical": 12,
    "AttackDamageMax": 840,
    "AttackDamageMin": 600,
    "AttackRange": 205,
    "AttackRate": 1.600000023841858,
    "ChessAbility": "sven_gods_strength",
    "ChessName": "chess_sven11",
    "Level": 9,
    "MagicalResistance": 0,
    "StatusHealth": 4800,
    "StatusMana": 100
  },
  "chess_ta": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 120,
    "AttackDamageMin": 90,
    "AttackRange": 400,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "templar_assassin_refraction",
    "ChessName": "chess_ta",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 950,
    "StatusMana": 100
  },
  "chess_ta1": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 240,
    "AttackDamageMin": 180,
    "AttackRange": 400,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "templar_assassin_refraction",
    "ChessName": "chess_ta1",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 1900,
    "StatusMana": 100
  },
  "chess_ta11": {
    "ArmorPhysical": 8,
    "AttackDamageMax": 480,
    "AttackDamageMin": 360,
    "AttackRange": 400,
    "AttackRate": 0.8999999761581421,
    "ChessAbility": "templar_assassin_refraction",
    "ChessName": "chess_ta11",
    "Level": 9,
    "MagicalResistance": 0,
    "StatusHealth": 3800,
    "StatusMana": 100
  },
  "chess_tb": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 80,
    "AttackDamageMin": 40,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "tb_mohua_new",
    "ChessName": "chess_tb",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_tb1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 160,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "tb_mohua_new",
    "ChessName": "chess_tb1",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_tb11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 320,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.100000023841858,
    "ChessAbility": "tb_mohua_new",
    "ChessName": "chess_tb11",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_tb_mohua1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 80,
    "AttackDamageMin": 80,
    "AttackRange": 600,
    "AttackRate": 1.100000023841858,
    "ChessName": "chess_tb_mohua1",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 700,
    "StatusMana": 0
  },
  "chess_tb_mohua2": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 160,
    "AttackDamageMin": 160,
    "AttackRange": 600,
    "AttackRate": 1.100000023841858,
    "ChessName": "chess_tb_mohua2",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1400,
    "StatusMana": 0
  },
  "chess_tb_mohua3": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 320,
    "AttackDamageMin": 320,
    "AttackRange": 600,
    "AttackRate": 1.100000023841858,
    "ChessName": "chess_tb_mohua3",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2800,
    "StatusMana": 0
  },
  "chess_tech": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 55,
    "AttackDamageMin": 45,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "chess_tech_bomb",
    "ChessName": "chess_tech",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_tech1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 110,
    "AttackDamageMin": 90,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "chess_tech_bomb",
    "ChessName": "chess_tech1",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_tech11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 220,
    "AttackDamageMin": 180,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "chess_tech_bomb",
    "ChessName": "chess_tech11",
    "Level": 9,
    "MagicalResistance": 0,
    "StatusHealth": 4000,
    "StatusMana": 100
  },
  "chess_th": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 75,
    "AttackDamageMin": 65,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "tidehunter_ravage",
    "ChessName": "chess_th",
    "Level": 5,
    "MagicalResistance": 15,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_th1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 150,
    "AttackDamageMin": 130,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "tidehunter_ravage",
    "ChessName": "chess_th1",
    "Level": 7,
    "MagicalResistance": 15,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_th11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 300,
    "AttackDamageMin": 260,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "tidehunter_ravage",
    "ChessName": "chess_th11",
    "Level": 9,
    "MagicalResistance": 15,
    "StatusHealth": 4400,
    "StatusMana": 100
  },
  "chess_thd": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 100,
    "AttackDamageMin": 30,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "jakiro_macropyre",
    "ChessName": "chess_thd",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_thd1": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 200,
    "AttackDamageMin": 60,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "jakiro_macropyre",
    "ChessName": "chess_thd1",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_thd11": {
    "ArmorPhysical": 9,
    "AttackDamageMax": 400,
    "AttackDamageMin": 120,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "jakiro_macropyre",
    "ChessName": "chess_thd11",
    "Level": 9,
    "MagicalResistance": 20,
    "StatusHealth": 4000,
    "StatusMana": 100
  },
  "chess_tiny": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 100,
    "AttackDamageMin": 60,
    "AttackRange": 205,
    "AttackRate": 1.899999976158142,
    "ChessAbility": "tiny_touzhi",
    "ChessName": "chess_tiny",
    "Level": 2,
    "MagicalResistance": 20,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_tiny1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 200,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 1.899999976158142,
    "ChessAbility": "tiny_touzhi",
    "ChessName": "chess_tiny1",
    "Level": 4,
    "MagicalResistance": 20,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_tiny11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 400,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 1.899999976158142,
    "ChessAbility": "tiny_touzhi",
    "ChessName": "chess_tiny11",
    "Level": 6,
    "MagicalResistance": 20,
    "StatusHealth": 2800,
    "StatusMana": 100
  },
  "chess_tk": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 50,
    "AttackDamageMin": 40,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "a108",
    "ChessName": "chess_tk",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 500,
    "StatusMana": 100
  },
  "chess_tk1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 100,
    "AttackDamageMin": 80,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "a108",
    "ChessName": "chess_tk1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_tk11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 200,
    "AttackDamageMin": 160,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "a108",
    "ChessName": "chess_tk11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_tp": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 90,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "tp_seed",
    "ChessName": "chess_tp",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 700,
    "StatusMana": 100
  },
  "chess_tp1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 180,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "tp_seed",
    "ChessName": "chess_tp1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1400,
    "StatusMana": 100
  },
  "chess_tp11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 360,
    "AttackDamageMin": 320,
    "AttackRange": 205,
    "AttackRate": 2,
    "ChessAbility": "tp_seed",
    "ChessName": "chess_tp11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2450,
    "StatusMana": 100
  },
  "chess_troll": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 130,
    "AttackDamageMin": 90,
    "AttackRange": 400,
    "AttackRate": 0.800000011920929,
    "ChessAbility": "troll_axe",
    "ChessName": "chess_troll",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 1000,
    "StatusMana": 0
  },
  "chess_troll1": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 260,
    "AttackDamageMin": 180,
    "AttackRange": 400,
    "AttackRate": 0.800000011920929,
    "ChessAbility": "troll_axe",
    "ChessName": "chess_troll1",
    "Level": 7,
    "MagicalResistance": 10,
    "StatusHealth": 2000,
    "StatusMana": 0
  },
  "chess_troll11": {
    "ArmorPhysical": 10,
    "AttackDamageMax": 520,
    "AttackDamageMin": 360,
    "AttackRange": 400,
    "AttackRate": 0.800000011920929,
    "ChessAbility": "troll_axe",
    "ChessName": "chess_troll11",
    "Level": 9,
    "MagicalResistance": 10,
    "StatusHealth": 4000,
    "StatusMana": 0
  },
  "chess_ts": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 110,
    "AttackDamageMin": 60,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "leshrac_pulse_nova",
    "ChessName": "chess_ts",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_ts1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 220,
    "AttackDamageMin": 120,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "leshrac_pulse_nova",
    "ChessName": "chess_ts1",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_ts11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 440,
    "AttackDamageMin": 240,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "leshrac_pulse_nova",
    "ChessName": "chess_ts11",
    "Level": 8,
    "MagicalResistance": 20,
    "StatusHealth": 3150,
    "StatusMana": 100
  },
  "chess_tusk": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 100,
    "AttackDamageMin": 40,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "tusk_walrus_punch_lua",
    "ChessName": "chess_tusk",
    "Level": 1,
    "MagicalResistance": 0,
    "StatusHealth": 600,
    "StatusMana": 100
  },
  "chess_tusk1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 200,
    "AttackDamageMin": 80,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "tusk_walrus_punch_lua",
    "ChessName": "chess_tusk1",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 1200,
    "StatusMana": 100
  },
  "chess_tusk11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 400,
    "AttackDamageMin": 160,
    "AttackRange": 205,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "tusk_walrus_punch_lua",
    "ChessName": "chess_tusk11",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 2400,
    "StatusMana": 100
  },
  "chess_ud": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 90,
    "AttackDamageMin": 60,
    "AttackRange": 205,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "ud_decay",
    "ChessName": "chess_ud",
    "Level": 3,
    "MagicalResistance": 20,
    "StatusHealth": 900,
    "StatusMana": 100
  },
  "chess_ud1": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 180,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "ud_decay",
    "ChessName": "chess_ud1",
    "Level": 5,
    "MagicalResistance": 20,
    "StatusHealth": 1800,
    "StatusMana": 100
  },
  "chess_ud11": {
    "ArmorPhysical": 5,
    "AttackDamageMax": 360,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 1.7000000476837158,
    "ChessAbility": "ud_decay",
    "ChessName": "chess_ud11",
    "Level": 7,
    "MagicalResistance": 20,
    "StatusHealth": 3600,
    "StatusMana": 100
  },
  "chess_veno": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "veno_ward",
    "ChessName": "chess_veno",
    "Level": 3,
    "MagicalResistance": 30,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_veno1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "veno_ward",
    "ChessName": "chess_veno1",
    "Level": 5,
    "MagicalResistance": 30,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_veno11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.2000000476837158,
    "ChessAbility": "veno_ward",
    "ChessName": "chess_veno11",
    "Level": 7,
    "MagicalResistance": 30,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_viper": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 60,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1,
    "ChessAbility": "ability_viper_viper_strike",
    "ChessName": "chess_viper",
    "Level": 3,
    "MagicalResistance": 0,
    "StatusHealth": 650,
    "StatusMana": 100
  },
  "chess_viper1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 120,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1,
    "ChessAbility": "ability_viper_viper_strike",
    "ChessName": "chess_viper1",
    "Level": 5,
    "MagicalResistance": 0,
    "StatusHealth": 1300,
    "StatusMana": 100
  },
  "chess_viper11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 240,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1,
    "ChessAbility": "ability_viper_viper_strike",
    "ChessName": "chess_viper11",
    "Level": 7,
    "MagicalResistance": 0,
    "StatusHealth": 2600,
    "StatusMana": 100
  },
  "chess_visage": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 65,
    "AttackDamageMin": 45,
    "AttackRange": 600,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "baby_dragon",
    "ChessName": "chess_visage",
    "Level": 2,
    "MagicalResistance": 20,
    "StatusHealth": 500,
    "StatusMana": 100
  },
  "chess_visage1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 130,
    "AttackDamageMin": 90,
    "AttackRange": 600,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "baby_dragon",
    "ChessName": "chess_visage1",
    "Level": 4,
    "MagicalResistance": 20,
    "StatusHealth": 1000,
    "StatusMana": 100
  },
  "chess_visage11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 260,
    "AttackDamageMin": 180,
    "AttackRange": 600,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "baby_dragon",
    "ChessName": "chess_visage11",
    "Level": 6,
    "MagicalResistance": 20,
    "StatusHealth": 2000,
    "StatusMana": 100
  },
  "chess_void": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 70,
    "AttackDamageMin": 60,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "void_astralstep",
    "ChessName": "chess_void",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 750,
    "StatusMana": 100
  },
  "chess_void1": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 140,
    "AttackDamageMin": 120,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "void_astralstep",
    "ChessName": "chess_void1",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 1500,
    "StatusMana": 100
  },
  "chess_void11": {
    "ArmorPhysical": 4,
    "AttackDamageMax": 280,
    "AttackDamageMin": 240,
    "AttackRange": 205,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "void_astralstep",
    "ChessName": "chess_void11",
    "Level": 8,
    "MagicalResistance": 0,
    "StatusHealth": 3000,
    "StatusMana": 100
  },
  "chess_vs": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 80,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "vs_swap",
    "ChessName": "chess_vs",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 500,
    "StatusMana": 0
  },
  "chess_vs1": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 160,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "vs_swap",
    "ChessName": "chess_vs1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1000,
    "StatusMana": 0
  },
  "chess_vs11": {
    "ArmorPhysical": 2,
    "AttackDamageMax": 320,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.2999999523162842,
    "ChessAbility": "vs_swap",
    "ChessName": "chess_vs11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2000,
    "StatusMana": 0
  },
  "chess_wd": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 50,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "witch_doctor_paralyzing_cask",
    "ChessName": "chess_wd",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_wd1": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 100,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "witch_doctor_paralyzing_cask",
    "ChessName": "chess_wd1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_wd11": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 200,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.5,
    "ChessAbility": "witch_doctor_paralyzing_cask",
    "ChessName": "chess_wd11",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_wl": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 120,
    "AttackDamageMin": 60,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "wl_inferno",
    "ChessName": "chess_wl",
    "Level": 5,
    "MagicalResistance": 25,
    "StatusHealth": 850,
    "StatusMana": 100
  },
  "chess_wl1": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 240,
    "AttackDamageMin": 120,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "wl_inferno",
    "ChessName": "chess_wl1",
    "Level": 7,
    "MagicalResistance": 25,
    "StatusHealth": 1700,
    "StatusMana": 100
  },
  "chess_wl11": {
    "ArmorPhysical": 6,
    "AttackDamageMax": 480,
    "AttackDamageMin": 240,
    "AttackRange": 600,
    "AttackRate": 1.5,
    "ChessAbility": "wl_inferno",
    "ChessName": "chess_wl11",
    "Level": 9,
    "MagicalResistance": 25,
    "StatusHealth": 3400,
    "StatusMana": 100
  },
  "chess_wr": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 70,
    "AttackDamageMin": 50,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "windrunner_shackleshot",
    "ChessName": "chess_wr",
    "Level": 2,
    "MagicalResistance": 0,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_wr1": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 140,
    "AttackDamageMin": 100,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "windrunner_shackleshot",
    "ChessName": "chess_wr1",
    "Level": 4,
    "MagicalResistance": 0,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_wr11": {
    "ArmorPhysical": 3,
    "AttackDamageMax": 280,
    "AttackDamageMin": 200,
    "AttackRange": 600,
    "AttackRate": 1,
    "ChessAbility": "windrunner_shackleshot",
    "ChessName": "chess_wr11",
    "Level": 6,
    "MagicalResistance": 0,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_ww": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 55,
    "AttackDamageMin": 40,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "winter_wyvern_cold_embrace",
    "ChessName": "chess_ww",
    "Level": 1,
    "MagicalResistance": 10,
    "StatusHealth": 550,
    "StatusMana": 100
  },
  "chess_ww1": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 110,
    "AttackDamageMin": 80,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "winter_wyvern_cold_embrace",
    "ChessName": "chess_ww1",
    "Level": 3,
    "MagicalResistance": 10,
    "StatusHealth": 1100,
    "StatusMana": 100
  },
  "chess_ww11": {
    "ArmorPhysical": 0,
    "AttackDamageMax": 220,
    "AttackDamageMin": 160,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "winter_wyvern_cold_embrace",
    "ChessName": "chess_ww11",
    "Level": 5,
    "MagicalResistance": 10,
    "StatusHealth": 2200,
    "StatusMana": 100
  },
  "chess_zeus": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 70,
    "AttackDamageMin": 50,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "zeus_thunder",
    "ChessName": "chess_zeus",
    "Level": 5,
    "MagicalResistance": 40,
    "StatusHealth": 950,
    "StatusMana": 100
  },
  "chess_zeus1": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 140,
    "AttackDamageMin": 100,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "zeus_thunder",
    "ChessName": "chess_zeus1",
    "Level": 7,
    "MagicalResistance": 40,
    "StatusHealth": 1900,
    "StatusMana": 100
  },
  "chess_zeus11": {
    "ArmorPhysical": 7,
    "AttackDamageMax": 280,
    "AttackDamageMin": 200,
    "AttackRange": 400,
    "AttackRate": 1.399999976158142,
    "ChessAbility": "zeus_thunder",
    "ChessName": "chess_zeus11",
    "Level": 9,
    "MagicalResistance": 40,
    "StatusHealth": 3800,
    "StatusMana": 100
  },
  "model_chess_aa1": {
    "ChessName": "model_chess_aa1"
  },
  "model_chess_aa11": {
    "ChessName": "model_chess_aa11"
  },
  "model_chess_abaddon1": {
    "ChessName": "model_chess_abaddon1"
  },
  "model_chess_abaddon11": {
    "ChessName": "model_chess_abaddon11"
  },
  "model_chess_am1": {
    "ChessName": "model_chess_am1"
  },
  "model_chess_am11": {
    "ChessName": "model_chess_am11"
  },
  "model_chess_au1": {
    "ChessName": "model_chess_au1"
  },
  "model_chess_au11": {
    "ChessName": "model_chess_au11"
  },
  "model_chess_aw1": {
    "ChessName": "model_chess_aw1"
  },
  "model_chess_aw11": {
    "ChessName": "model_chess_aw11"
  },
  "model_chess_axe1": {
    "ChessName": "model_chess_axe1"
  },
  "model_chess_axe11": {
    "ChessName": "model_chess_axe11"
  },
  "model_chess_bane1": {
    "ChessName": "model_chess_bane1"
  },
  "model_chess_bane11": {
    "ChessName": "model_chess_bane11"
  },
  "model_chess_bat1": {
    "ChessName": "model_chess_bat1"
  },
  "model_chess_bat11": {
    "ChessName": "model_chess_bat11"
  },
  "model_chess_bh1": {
    "ChessName": "model_chess_bh1"
  },
  "model_chess_bh11": {
    "ChessName": "model_chess_bh11"
  },
  "model_chess_bm1": {
    "ChessName": "model_chess_bm1"
  },
  "model_chess_bm11": {
    "ChessName": "model_chess_bm11"
  },
  "model_chess_br1": {
    "ChessName": "model_chess_br1"
  },
  "model_chess_br11": {
    "ChessName": "model_chess_br11"
  },
  "model_chess_brew1": {
    "ChessName": "model_chess_brew1"
  },
  "model_chess_brew11": {
    "ChessName": "model_chess_brew11"
  },
  "model_chess_bs1": {
    "ChessName": "model_chess_bs1"
  },
  "model_chess_bs11": {
    "ChessName": "model_chess_bs11"
  },
  "model_chess_chen1": {
    "ChessName": "model_chess_chen1"
  },
  "model_chess_chen11": {
    "ChessName": "model_chess_chen11"
  },
  "model_chess_ck1": {
    "ChessName": "model_chess_ck1"
  },
  "model_chess_ck11": {
    "ChessName": "model_chess_ck11"
  },
  "model_chess_clinkz1": {
    "ChessName": "model_chess_clinkz1"
  },
  "model_chess_clinkz11": {
    "ChessName": "model_chess_clinkz11"
  },
  "model_chess_clock1": {
    "ChessName": "model_chess_clock1"
  },
  "model_chess_clock11": {
    "ChessName": "model_chess_clock11"
  },
  "model_chess_cm1": {
    "ChessName": "model_chess_cm1"
  },
  "model_chess_cm11": {
    "ChessName": "model_chess_cm11"
  },
  "model_chess_ct1": {
    "ChessName": "model_chess_ct1"
  },
  "model_chess_ct11": {
    "ChessName": "model_chess_ct11"
  },
  "model_chess_dazzle1": {
    "ChessName": "model_chess_dazzle1"
  },
  "model_chess_dazzle11": {
    "ChessName": "model_chess_dazzle11"
  },
  "model_chess_db1": {
    "ChessName": "model_chess_db1"
  },
  "model_chess_db11": {
    "ChessName": "model_chess_db11"
  },
  "model_chess_disruptor1": {
    "ChessName": "model_chess_disruptor1"
  },
  "model_chess_disruptor11": {
    "ChessName": "model_chess_disruptor11"
  },
  "model_chess_dk1": {
    "ChessName": "model_chess_dk1"
  },
  "model_chess_dk11": {
    "ChessName": "model_chess_dk11"
  },
  "model_chess_dk11_dragon": {
    "ChessName": "model_chess_dk11_dragon"
  },
  "model_chess_dk1_dragon": {
    "ChessName": "model_chess_dk1_dragon"
  },
  "model_chess_doom1": {
    "ChessName": "model_chess_doom1"
  },
  "model_chess_doom11": {
    "ChessName": "model_chess_doom11"
  },
  "model_chess_dp1": {
    "ChessName": "model_chess_dp1"
  },
  "model_chess_dp11": {
    "ChessName": "model_chess_dp11"
  },
  "model_chess_dr1": {
    "ChessName": "model_chess_dr1"
  },
  "model_chess_dr11": {
    "ChessName": "model_chess_dr11"
  },
  "model_chess_ds1": {
    "ChessName": "model_chess_ds1"
  },
  "model_chess_ds11": {
    "ChessName": "model_chess_ds11"
  },
  "model_chess_dw1": {
    "ChessName": "model_chess_dw1"
  },
  "model_chess_dw11": {
    "ChessName": "model_chess_dw11"
  },
  "model_chess_earth1": {
    "ChessName": "model_chess_earth1"
  },
  "model_chess_earth11": {
    "ChessName": "model_chess_earth11"
  },
  "model_chess_eh1": {
    "ChessName": "model_chess_eh1"
  },
  "model_chess_eh11": {
    "ChessName": "model_chess_eh11"
  },
  "model_chess_ember1": {
    "ChessName": "model_chess_ember1"
  },
  "model_chess_ember11": {
    "ChessName": "model_chess_ember11"
  },
  "model_chess_enigma1": {
    "ChessName": "model_chess_enigma1"
  },
  "model_chess_enigma11": {
    "ChessName": "model_chess_enigma11"
  },
  "model_chess_es1": {
    "ChessName": "model_chess_es1"
  },
  "model_chess_es11": {
    "ChessName": "model_chess_es11"
  },
  "model_chess_et1": {
    "ChessName": "model_chess_et1"
  },
  "model_chess_et11": {
    "ChessName": "model_chess_et11"
  },
  "model_chess_fur1": {
    "ChessName": "model_chess_fur1"
  },
  "model_chess_fur11": {
    "ChessName": "model_chess_fur11"
  },
  "model_chess_fv1": {
    "ChessName": "model_chess_fv1"
  },
  "model_chess_fv11": {
    "ChessName": "model_chess_fv11"
  },
  "model_chess_ga1": {
    "ChessName": "model_chess_ga1"
  },
  "model_chess_ga11": {
    "ChessName": "model_chess_ga11"
  },
  "model_chess_gs1": {
    "ChessName": "model_chess_gs1"
  },
  "model_chess_gs11": {
    "ChessName": "model_chess_gs11"
  },
  "model_chess_gyro1": {
    "ChessName": "model_chess_gyro1"
  },
  "model_chess_gyro11": {
    "ChessName": "model_chess_gyro11"
  },
  "model_chess_huskar1": {
    "ChessName": "model_chess_huskar1"
  },
  "model_chess_huskar11": {
    "ChessName": "model_chess_huskar11"
  },
  "model_chess_hw1": {
    "ChessName": "model_chess_hw1"
  },
  "model_chess_hw11": {
    "ChessName": "model_chess_hw11"
  },
  "model_chess_io1": {
    "ChessName": "model_chess_io1"
  },
  "model_chess_io11": {
    "ChessName": "model_chess_io11"
  },
  "model_chess_jugg1": {
    "ChessName": "model_chess_jugg1"
  },
  "model_chess_jugg11": {
    "ChessName": "model_chess_jugg11"
  },
  "model_chess_kael1": {
    "ChessName": "model_chess_kael1"
  },
  "model_chess_kael11": {
    "ChessName": "model_chess_kael11"
  },
  "model_chess_kez1": {
    "ChessName": "model_chess_kez1"
  },
  "model_chess_kez11": {
    "ChessName": "model_chess_kez11"
  },
  "model_chess_kunkka1": {
    "ChessName": "model_chess_kunkka1"
  },
  "model_chess_kunkka11": {
    "ChessName": "model_chess_kunkka11"
  },
  "model_chess_largo1": {
    "ChessName": "model_chess_largo1"
  },
  "model_chess_largo11": {
    "ChessName": "model_chess_largo11"
  },
  "model_chess_lc1": {
    "ChessName": "model_chess_lc1"
  },
  "model_chess_lc11": {
    "ChessName": "model_chess_lc11"
  },
  "model_chess_ld1": {
    "ChessName": "model_chess_ld1"
  },
  "model_chess_ld11": {
    "ChessName": "model_chess_ld11"
  },
  "model_chess_lich1": {
    "ChessName": "model_chess_lich1"
  },
  "model_chess_lich11": {
    "ChessName": "model_chess_lich11"
  },
  "model_chess_light1": {
    "ChessName": "model_chess_light1"
  },
  "model_chess_light11": {
    "ChessName": "model_chess_light11"
  },
  "model_chess_lina1": {
    "ChessName": "model_chess_lina1"
  },
  "model_chess_lina11": {
    "ChessName": "model_chess_lina11"
  },
  "model_chess_lion1": {
    "ChessName": "model_chess_lion1"
  },
  "model_chess_lion11": {
    "ChessName": "model_chess_lion11"
  },
  "model_chess_luna1": {
    "ChessName": "model_chess_luna1"
  },
  "model_chess_luna11": {
    "ChessName": "model_chess_luna11"
  },
  "model_chess_lyc1": {
    "ChessName": "model_chess_lyc1"
  },
  "model_chess_lyc11": {
    "ChessName": "model_chess_lyc11"
  },
  "model_chess_lyc11_wolf": {
    "ChessName": "model_chess_lyc11_wolf"
  },
  "model_chess_lyc1_wolf": {
    "ChessName": "model_chess_lyc1_wolf"
  },
  "model_chess_mag1": {
    "ChessName": "model_chess_mag1"
  },
  "model_chess_mag11": {
    "ChessName": "model_chess_mag11"
  },
  "model_chess_marci1": {
    "ChessName": "model_chess_marci1"
  },
  "model_chess_marci11": {
    "ChessName": "model_chess_marci11"
  },
  "model_chess_mars1": {
    "ChessName": "model_chess_mars1"
  },
  "model_chess_mars11": {
    "ChessName": "model_chess_mars11"
  },
  "model_chess_medusa1": {
    "ChessName": "model_chess_medusa1"
  },
  "model_chess_medusa11": {
    "ChessName": "model_chess_medusa11"
  },
  "model_chess_meepo1": {
    "ChessName": "model_chess_meepo1"
  },
  "model_chess_meepo11": {
    "ChessName": "model_chess_meepo11"
  },
  "model_chess_mk1": {
    "ChessName": "model_chess_mk1"
  },
  "model_chess_mk11": {
    "ChessName": "model_chess_mk11"
  },
  "model_chess_morph1": {
    "ChessName": "model_chess_morph1"
  },
  "model_chess_morph11": {
    "ChessName": "model_chess_morph11"
  },
  "model_chess_muerta1": {
    "ChessName": "model_chess_muerta1"
  },
  "model_chess_muerta11": {
    "ChessName": "model_chess_muerta11"
  },
  "model_chess_na1": {
    "ChessName": "model_chess_na1"
  },
  "model_chess_na11": {
    "ChessName": "model_chess_na11"
  },
  "model_chess_naga1": {
    "ChessName": "model_chess_naga1"
  },
  "model_chess_naga11": {
    "ChessName": "model_chess_naga11"
  },
  "model_chess_naix1": {
    "ChessName": "model_chess_naix1"
  },
  "model_chess_naix11": {
    "ChessName": "model_chess_naix11"
  },
  "model_chess_nec1": {
    "ChessName": "model_chess_nec1"
  },
  "model_chess_nec11": {
    "ChessName": "model_chess_nec11"
  },
  "model_chess_ok1": {
    "ChessName": "model_chess_ok1"
  },
  "model_chess_ok11": {
    "ChessName": "model_chess_ok11"
  },
  "model_chess_om1": {
    "ChessName": "model_chess_om1"
  },
  "model_chess_om11": {
    "ChessName": "model_chess_om11"
  },
  "model_chess_oracle1": {
    "ChessName": "model_chess_oracle1"
  },
  "model_chess_oracle11": {
    "ChessName": "model_chess_oracle11"
  },
  "model_chess_pa1": {
    "ChessName": "model_chess_pa1"
  },
  "model_chess_pa11": {
    "ChessName": "model_chess_pa11"
  },
  "model_chess_pangolier1": {
    "ChessName": "model_chess_pangolier1"
  },
  "model_chess_pangolier11": {
    "ChessName": "model_chess_pangolier11"
  },
  "model_chess_pb1": {
    "ChessName": "model_chess_pb1"
  },
  "model_chess_pb11": {
    "ChessName": "model_chess_pb11"
  },
  "model_chess_phx1": {
    "ChessName": "model_chess_phx1"
  },
  "model_chess_phx11": {
    "ChessName": "model_chess_phx11"
  },
  "model_chess_pom1": {
    "ChessName": "model_chess_pom1"
  },
  "model_chess_pom11": {
    "ChessName": "model_chess_pom11"
  },
  "model_chess_puck1": {
    "ChessName": "model_chess_puck1"
  },
  "model_chess_puck11": {
    "ChessName": "model_chess_puck11"
  },
  "model_chess_pudge1": {
    "ChessName": "model_chess_pudge1"
  },
  "model_chess_pudge11": {
    "ChessName": "model_chess_pudge11"
  },
  "model_chess_qop1": {
    "ChessName": "model_chess_qop1"
  },
  "model_chess_qop11": {
    "ChessName": "model_chess_qop11"
  },
  "model_chess_razor1": {
    "ChessName": "model_chess_razor1"
  },
  "model_chess_razor11": {
    "ChessName": "model_chess_razor11"
  },
  "model_chess_riki1": {
    "ChessName": "model_chess_riki1"
  },
  "model_chess_riki11": {
    "ChessName": "model_chess_riki11"
  },
  "model_chess_rm1": {
    "ChessName": "model_chess_rm1"
  },
  "model_chess_rm11": {
    "ChessName": "model_chess_rm11"
  },
  "model_chess_rubick1": {
    "ChessName": "model_chess_rubick1"
  },
  "model_chess_rubick11": {
    "ChessName": "model_chess_rubick11"
  },
  "model_chess_sb1": {
    "ChessName": "model_chess_sb1"
  },
  "model_chess_sb11": {
    "ChessName": "model_chess_sb11"
  },
  "model_chess_sd1": {
    "ChessName": "model_chess_sd1"
  },
  "model_chess_sd11": {
    "ChessName": "model_chess_sd11"
  },
  "model_chess_sf1": {
    "ChessName": "model_chess_sf1"
  },
  "model_chess_sf11": {
    "ChessName": "model_chess_sf11"
  },
  "model_chess_shredder1": {
    "ChessName": "model_chess_shredder1"
  },
  "model_chess_shredder11": {
    "ChessName": "model_chess_shredder11"
  },
  "model_chess_sk1": {
    "ChessName": "model_chess_sk1"
  },
  "model_chess_sk11": {
    "ChessName": "model_chess_sk11"
  },
  "model_chess_slardar1": {
    "ChessName": "model_chess_slardar1"
  },
  "model_chess_slardar11": {
    "ChessName": "model_chess_slardar11"
  },
  "model_chess_slark1": {
    "ChessName": "model_chess_slark1"
  },
  "model_chess_slark11": {
    "ChessName": "model_chess_slark11"
  },
  "model_chess_sm1": {
    "ChessName": "model_chess_sm1"
  },
  "model_chess_sm11": {
    "ChessName": "model_chess_sm11"
  },
  "model_chess_snap1": {
    "ChessName": "model_chess_snap1"
  },
  "model_chess_snap11": {
    "ChessName": "model_chess_snap11"
  },
  "model_chess_sniper1": {
    "ChessName": "model_chess_sniper1"
  },
  "model_chess_sniper11": {
    "ChessName": "model_chess_sniper11"
  },
  "model_chess_snk1": {
    "ChessName": "model_chess_snk1"
  },
  "model_chess_snk11": {
    "ChessName": "model_chess_snk11"
  },
  "model_chess_spe1": {
    "ChessName": "model_chess_spe1"
  },
  "model_chess_spe11": {
    "ChessName": "model_chess_spe11"
  },
  "model_chess_ss1": {
    "ChessName": "model_chess_ss1"
  },
  "model_chess_ss11": {
    "ChessName": "model_chess_ss11"
  },
  "model_chess_storm1": {
    "ChessName": "model_chess_storm1"
  },
  "model_chess_storm11": {
    "ChessName": "model_chess_storm11"
  },
  "model_chess_sven1": {
    "ChessName": "model_chess_sven1"
  },
  "model_chess_sven11": {
    "ChessName": "model_chess_sven11"
  },
  "model_chess_ta1": {
    "ChessName": "model_chess_ta1"
  },
  "model_chess_ta11": {
    "ChessName": "model_chess_ta11"
  },
  "model_chess_tb1": {
    "ChessName": "model_chess_tb1"
  },
  "model_chess_tb11": {
    "ChessName": "model_chess_tb11"
  },
  "model_chess_tb_mohua1": {
    "ChessName": "model_chess_tb_mohua1"
  },
  "model_chess_tb_mohua2": {
    "ChessName": "model_chess_tb_mohua2"
  },
  "model_chess_tb_mohua3": {
    "ChessName": "model_chess_tb_mohua3"
  },
  "model_chess_tech1": {
    "ChessName": "model_chess_tech1"
  },
  "model_chess_tech11": {
    "ChessName": "model_chess_tech11"
  },
  "model_chess_th1": {
    "ChessName": "model_chess_th1"
  },
  "model_chess_th11": {
    "ChessName": "model_chess_th11"
  },
  "model_chess_thd1": {
    "ChessName": "model_chess_thd1"
  },
  "model_chess_thd11": {
    "ChessName": "model_chess_thd11"
  },
  "model_chess_tiny1": {
    "ChessName": "model_chess_tiny1"
  },
  "model_chess_tiny11": {
    "ChessName": "model_chess_tiny11"
  },
  "model_chess_tk1": {
    "ChessName": "model_chess_tk1"
  },
  "model_chess_tk11": {
    "ChessName": "model_chess_tk11"
  },
  "model_chess_tp1": {
    "ChessName": "model_chess_tp1"
  },
  "model_chess_tp11": {
    "ChessName": "model_chess_tp11"
  },
  "model_chess_troll1": {
    "ChessName": "model_chess_troll1"
  },
  "model_chess_troll11": {
    "ChessName": "model_chess_troll11"
  },
  "model_chess_ts1": {
    "ChessName": "model_chess_ts1"
  },
  "model_chess_ts11": {
    "ChessName": "model_chess_ts11"
  },
  "model_chess_tusk1": {
    "ChessName": "model_chess_tusk1"
  },
  "model_chess_tusk11": {
    "ChessName": "model_chess_tusk11"
  },
  "model_chess_ud1": {
    "ChessName": "model_chess_ud1"
  },
  "model_chess_ud11": {
    "ChessName": "model_chess_ud11"
  },
  "model_chess_veno1": {
    "ChessName": "model_chess_veno1"
  },
  "model_chess_veno11": {
    "ChessName": "model_chess_veno11"
  },
  "model_chess_viper1": {
    "ChessName": "model_chess_viper1"
  },
  "model_chess_viper11": {
    "ChessName": "model_chess_viper11"
  },
  "model_chess_visage1": {
    "ChessName": "model_chess_visage1"
  },
  "model_chess_visage11": {
    "ChessName": "model_chess_visage11"
  },
  "model_chess_void1": {
    "ChessName": "model_chess_void1"
  },
  "model_chess_void11": {
    "ChessName": "model_chess_void11"
  },
  "model_chess_vs1": {
    "ChessName": "model_chess_vs1"
  },
  "model_chess_vs11": {
    "ChessName": "model_chess_vs11"
  },
  "model_chess_wd1": {
    "ChessName": "model_chess_wd1"
  },
  "model_chess_wd11": {
    "ChessName": "model_chess_wd11"
  },
  "model_chess_wl1": {
    "ChessName": "model_chess_wl1"
  },
  "model_chess_wl11": {
    "ChessName": "model_chess_wl11"
  },
  "model_chess_wr1": {
    "ChessName": "model_chess_wr1"
  },
  "model_chess_wr11": {
    "ChessName": "model_chess_wr11"
  },
  "model_chess_ww1": {
    "ChessName": "model_chess_ww1"
  },
  "model_chess_ww11": {
    "ChessName": "model_chess_ww11"
  },
  "model_chess_zeus1": {
    "ChessName": "model_chess_zeus1"
  },
  "model_chess_zeus11": {
    "ChessName": "model_chess_zeus11"
  }
}
```

#### `CustomNetTable_chess_pool_table`

```json
{
  "ban_info": {
    "is_aqir": {
      "ban_price": 6,
      "chess_list": {
        "1": "chess_veno",
        "2": "chess_sk",
        "3": "chess_br"
      }
    },
    "is_assassin": {
      "ban_price": 20,
      "chess_list": {
        "1": "chess_sb",
        "10": "chess_mag",
        "2": "chess_slark",
        "3": "chess_fv",
        "4": "chess_riki",
        "5": "chess_viper",
        "6": "chess_kez",
        "7": "chess_sk",
        "8": "chess_pangolier",
        "9": "chess_pa"
      }
    },
    "is_beast": {
      "ban_price": 16,
      "chess_list": {
        "1": "chess_tusk",
        "2": "chess_eh",
        "3": "chess_hw",
        "4": "chess_veno",
        "5": "chess_lyc",
        "6": "chess_pangolier",
        "7": "chess_mk",
        "8": "chess_ld"
      }
    },
    "is_centaur": {
      "ban_price": 6,
      "chess_list": {
        "1": "chess_eh",
        "2": "chess_ct",
        "3": "chess_mag"
      }
    },
    "is_demon": {
      "ban_price": 14,
      "chess_list": {
        "1": "chess_sd",
        "2": "chess_ck",
        "3": "chess_tb",
        "4": "chess_sf",
        "5": "chess_doom",
        "6": "chess_lion",
        "7": "chess_sven"
      }
    },
    "is_demonhunter": {
      "ban_price": 4,
      "chess_list": {
        "1": "chess_tb",
        "2": "chess_am"
      }
    },
    "is_draenei": {
      "ban_price": 8,
      "chess_list": {
        "1": "chess_bh",
        "2": "chess_sd",
        "3": "chess_ds",
        "4": "chess_db"
      }
    },
    "is_dragon": {
      "ban_price": 6,
      "chess_list": {
        "1": "chess_puck",
        "2": "chess_viper",
        "3": "chess_dk"
      }
    },
    "is_druid": {
      "ban_price": 10,
      "chess_list": {
        "1": "chess_eh",
        "2": "chess_fur",
        "3": "chess_tp",
        "4": "chess_ld",
        "5": "chess_et"
      }
    },
    "is_dwarf": {
      "ban_price": 2,
      "chess_list": {
        "1": "chess_sniper"
      }
    },
    "is_element": {
      "ban_price": 10,
      "chess_list": {
        "1": "chess_aa",
        "2": "chess_tiny",
        "3": "chess_razor",
        "4": "chess_enigma",
        "5": "chess_phx"
      }
    },
    "is_elf": {
      "ban_price": 20,
      "chess_list": {
        "1": "chess_dw",
        "10": "chess_am",
        "2": "chess_pom",
        "3": "chess_luna",
        "4": "chess_fur",
        "5": "chess_puck",
        "6": "chess_wr",
        "7": "chess_tp",
        "8": "chess_marci",
        "9": "chess_pa"
      }
    },
    "is_goblin": {
      "ban_price": 12,
      "chess_list": {
        "1": "chess_clock",
        "2": "chess_tk",
        "3": "chess_bh",
        "4": "chess_shredder",
        "5": "chess_snap",
        "6": "chess_ga"
      }
    },
    "is_god": {
      "ban_price": 8,
      "chess_list": {
        "1": "chess_mars",
        "2": "chess_oracle",
        "3": "chess_rubick",
        "4": "chess_et"
      }
    },
    "is_harpy": {
      "ban_price": 4,
      "chess_list": {
        "1": "chess_sm",
        "2": "chess_kez"
      }
    },
    "is_human": {
      "ban_price": 16,
      "chess_list": {
        "1": "chess_cm",
        "2": "chess_lina",
        "3": "chess_lyc",
        "4": "chess_lc",
        "5": "chess_light",
        "6": "chess_kunkka",
        "7": "chess_dk",
        "8": "chess_ok"
      }
    },
    "is_hunter": {
      "ban_price": 16,
      "chess_list": {
        "1": "chess_bh",
        "2": "chess_hw",
        "3": "chess_pom",
        "4": "chess_wr",
        "5": "chess_sniper",
        "6": "chess_bm",
        "7": "chess_medusa",
        "8": "chess_br"
      }
    },
    "is_knight": {
      "ban_price": 16,
      "chess_list": {
        "1": "chess_bat",
        "2": "chess_ck",
        "3": "chess_luna",
        "4": "chess_db",
        "5": "chess_lc",
        "6": "chess_dk",
        "7": "chess_snap",
        "8": "chess_ok"
      }
    },
    "is_kobold": {
      "ban_price": 4,
      "chess_list": {
        "1": "chess_meepo",
        "2": "chess_aw"
      }
    },
    "is_mage": {
      "ban_price": 16,
      "chess_list": {
        "1": "chess_cm",
        "2": "chess_sm",
        "3": "chess_aa",
        "4": "chess_lina",
        "5": "chess_puck",
        "6": "chess_om",
        "7": "chess_light",
        "8": "chess_phx"
      }
    },
    "is_mech": {
      "ban_price": 8,
      "chess_list": {
        "1": "chess_clock",
        "2": "chess_tk",
        "3": "chess_shredder",
        "4": "chess_meepo"
      }
    },
    "is_monk": {
      "ban_price": 8,
      "chess_list": {
        "1": "chess_brew",
        "2": "chess_largo",
        "3": "chess_marci",
        "4": "chess_mk"
      }
    },
    "is_naga": {
      "ban_price": 10,
      "chess_list": {
        "1": "chess_slark",
        "2": "chess_largo",
        "3": "chess_naga",
        "4": "chess_slardar",
        "5": "chess_medusa"
      }
    },
    "is_nraqi": {
      "ban_price": 4,
      "chess_list": {
        "1": "chess_bane",
        "2": "chess_fv"
      }
    },
    "is_ogre": {
      "ban_price": 4,
      "chess_list": {
        "1": "chess_om",
        "2": "chess_ga"
      }
    },
    "is_orc": {
      "ban_price": 12,
      "chess_list": {
        "1": "chess_axe",
        "2": "chess_bs",
        "3": "chess_bm",
        "4": "chess_jugg",
        "5": "chess_chen",
        "6": "chess_disruptor"
      }
    },
    "is_pandaman": {
      "ban_price": 2,
      "chess_list": {
        "1": "chess_brew"
      }
    },
    "is_priest": {
      "ban_price": 8,
      "chess_list": {
        "1": "chess_dazzle",
        "2": "chess_sd",
        "3": "chess_oracle",
        "4": "chess_chen"
      }
    },
    "is_satyr": {
      "ban_price": 4,
      "chess_list": {
        "1": "chess_bane",
        "2": "chess_riki"
      }
    },
    "is_shaman": {
      "ban_price": 12,
      "chess_list": {
        "1": "chess_ss",
        "2": "chess_bs",
        "3": "chess_razor",
        "4": "chess_es",
        "5": "chess_disruptor",
        "6": "chess_aw"
      }
    },
    "is_tauren": {
      "ban_price": 6,
      "chess_list": {
        "1": "chess_sb",
        "2": "chess_es",
        "3": "chess_et"
      }
    },
    "is_troll": {
      "ban_price": 12,
      "chess_list": {
        "1": "chess_dazzle",
        "2": "chess_ss",
        "3": "chess_wd",
        "4": "chess_bat",
        "5": "chess_huskar",
        "6": "chess_troll"
      }
    },
    "is_undead": {
      "ban_price": 0,
      "chess_list": {}
    },
    "is_warlock": {
      "ban_price": 14,
      "chess_list": {
        "1": "chess_bane",
        "2": "chess_wd",
        "3": "chess_ds",
        "4": "chess_veno",
        "5": "chess_enigma",
        "6": "chess_sf",
        "7": "chess_ga"
      }
    },
    "is_warrior": {
      "ban_price": 26,
      "chess_list": {
        "1": "chess_axe",
        "10": "chess_kunkka",
        "11": "chess_doom",
        "12": "chess_troll",
        "13": "chess_sven",
        "2": "chess_mars",
        "3": "chess_tusk",
        "4": "chess_jugg",
        "5": "chess_ct",
        "6": "chess_tiny",
        "7": "chess_huskar",
        "8": "chess_lyc",
        "9": "chess_slardar"
      }
    },
    "is_wizard": {
      "ban_price": 8,
      "chess_list": {
        "1": "chess_dw",
        "2": "chess_rubick",
        "3": "chess_naga",
        "4": "chess_lion"
      }
    }
  },
  "ban_info_6": {
    "banned_synergy": "is_assassin"
  },
  "chess_list_by_mana": {
    "1": {
      "1": "chess_bane",
      "10": "chess_clock",
      "11": "chess_ss",
      "12": "chess_tk",
      "13": "chess_mars",
      "14": "chess_wd",
      "15": "chess_sb",
      "16": "chess_hw",
      "17": "chess_bh",
      "18": "chess_sd",
      "19": "chess_sm",
      "2": "chess_tusk",
      "20": "chess_brew",
      "3": "chess_dw",
      "4": "chess_pom",
      "5": "chess_dazzle",
      "6": "chess_cm",
      "7": "chess_aa",
      "8": "chess_axe",
      "9": "chess_eh"
    },
    "2": {
      "1": "chess_luna",
      "10": "chess_ck",
      "11": "chess_fur",
      "12": "chess_bat",
      "13": "chess_meepo",
      "14": "chess_sniper",
      "15": "chess_largo",
      "16": "chess_puck",
      "17": "chess_tiny",
      "18": "chess_oracle",
      "19": "chess_ct",
      "2": "chess_lina",
      "20": "chess_ds",
      "3": "chess_bs",
      "4": "chess_wr",
      "5": "chess_fv",
      "6": "chess_bm",
      "7": "chess_jugg",
      "8": "chess_shredder",
      "9": "chess_slark"
    },
    "3": {
      "1": "chess_lyc",
      "10": "chess_naga",
      "11": "chess_rubick",
      "12": "chess_lc",
      "13": "chess_huskar",
      "14": "chess_marci",
      "15": "chess_riki",
      "16": "chess_sf",
      "17": "chess_tb",
      "18": "chess_db",
      "19": "chess_om",
      "2": "chess_slardar",
      "20": "chess_kez",
      "3": "chess_viper",
      "4": "chess_razor",
      "5": "chess_enigma",
      "6": "chess_tp",
      "7": "chess_es",
      "8": "chess_veno",
      "9": "chess_sk"
    },
    "4": {
      "1": "chess_am",
      "10": "chess_ld",
      "11": "chess_pangolier",
      "12": "chess_chen",
      "13": "chess_kunkka",
      "14": "chess_snap",
      "15": "chess_mk",
      "16": "chess_mag",
      "17": "chess_br",
      "18": "chess_lion",
      "2": "chess_pa",
      "3": "chess_dk",
      "4": "chess_phx",
      "5": "chess_doom",
      "6": "chess_medusa",
      "7": "chess_et",
      "8": "chess_ga",
      "9": "chess_light"
    },
    "5": {
      "1": "chess_ok",
      "10": "chess_wl",
      "11": "chess_troll",
      "12": "chess_aw",
      "13": "chess_disruptor",
      "14": "chess_th",
      "15": "chess_pb",
      "16": "chess_kael",
      "17": "chess_sven",
      "18": "chess_rm",
      "19": "chess_au",
      "2": "chess_ta",
      "3": "chess_morph",
      "4": "chess_gyro",
      "5": "chess_thd",
      "6": "chess_tech",
      "7": "chess_zeus",
      "8": "chess_ts",
      "9": "chess_qop"
    }
  },
  "chess_list_by_mana_black": {
    "1": {
      "1": "chess_ww",
      "2": "chess_clinkz",
      "3": "chess_abaddon"
    },
    "2": {
      "1": "chess_vs",
      "2": "chess_muerta",
      "3": "chess_naix"
    },
    "3": {
      "1": "chess_pudge",
      "2": "chess_ud",
      "3": "chess_dr"
    },
    "4": {
      "1": "chess_lich",
      "2": "chess_na",
      "3": "chess_dp"
    },
    "5": {
      "1": "chess_snk",
      "2": "chess_spe",
      "3": "chess_nec"
    }
  },
  "chess_list_by_mana_special": {
    "1": {},
    "2": {},
    "3": {},
    "4": {
      "1": "chess_ember",
      "2": "chess_storm",
      "3": "chess_earth",
      "4": "chess_void"
    },
    "5": {
      "1": "chess_io"
    }
  },
  "chess_list_by_synergy": {
    "is_aqir": {
      "1": "chess_veno",
      "2": "chess_sk",
      "3": "chess_br"
    },
    "is_assassin": {
      "1": "chess_sb",
      "10": "chess_mag",
      "11": "chess_ta",
      "2": "chess_slark",
      "3": "chess_fv",
      "4": "chess_riki",
      "5": "chess_viper",
      "6": "chess_kez",
      "7": "chess_sk",
      "8": "chess_pangolier",
      "9": "chess_pa"
    },
    "is_beast": {
      "1": "chess_tusk",
      "2": "chess_eh",
      "3": "chess_hw",
      "4": "chess_veno",
      "5": "chess_lyc",
      "6": "chess_pangolier",
      "7": "chess_mk",
      "8": "chess_ld"
    },
    "is_centaur": {
      "1": "chess_eh",
      "2": "chess_ct",
      "3": "chess_mag",
      "4": "chess_ts"
    },
    "is_demon": {
      "1": "chess_sd",
      "2": "chess_ck",
      "3": "chess_tb",
      "4": "chess_sf",
      "5": "chess_doom",
      "6": "chess_lion",
      "7": "chess_sven",
      "8": "chess_au"
    },
    "is_demonhunter": {
      "1": "chess_tb",
      "2": "chess_am"
    },
    "is_draenei": {
      "1": "chess_bh",
      "2": "chess_sd",
      "3": "chess_ds",
      "4": "chess_db"
    },
    "is_dragon": {
      "1": "chess_puck",
      "2": "chess_viper",
      "3": "chess_dk",
      "4": "chess_thd"
    },
    "is_druid": {
      "1": "chess_eh",
      "2": "chess_fur",
      "3": "chess_tp",
      "4": "chess_ld",
      "5": "chess_et",
      "6": "chess_ts"
    },
    "is_dwarf": {
      "1": "chess_sniper"
    },
    "is_element": {
      "1": "chess_aa",
      "2": "chess_tiny",
      "3": "chess_razor",
      "4": "chess_enigma",
      "5": "chess_phx"
    },
    "is_elf": {
      "1": "chess_dw",
      "10": "chess_am",
      "11": "chess_kael",
      "12": "chess_ta",
      "2": "chess_pom",
      "3": "chess_luna",
      "4": "chess_fur",
      "5": "chess_puck",
      "6": "chess_wr",
      "7": "chess_tp",
      "8": "chess_marci",
      "9": "chess_pa"
    },
    "is_goblin": {
      "1": "chess_clock",
      "2": "chess_tk",
      "3": "chess_bh",
      "4": "chess_shredder",
      "5": "chess_snap",
      "6": "chess_ga"
    },
    "is_god": {
      "1": "chess_mars",
      "2": "chess_oracle",
      "3": "chess_rubick",
      "4": "chess_et",
      "5": "chess_ts"
    },
    "is_harpy": {
      "1": "chess_sm",
      "2": "chess_kez"
    },
    "is_human": {
      "1": "chess_cm",
      "2": "chess_lina",
      "3": "chess_lyc",
      "4": "chess_lc",
      "5": "chess_light",
      "6": "chess_kunkka",
      "7": "chess_dk",
      "8": "chess_ok"
    },
    "is_hunter": {
      "1": "chess_bh",
      "2": "chess_hw",
      "3": "chess_pom",
      "4": "chess_wr",
      "5": "chess_sniper",
      "6": "chess_bm",
      "7": "chess_medusa",
      "8": "chess_br"
    },
    "is_knight": {
      "1": "chess_bat",
      "2": "chess_ck",
      "3": "chess_luna",
      "4": "chess_db",
      "5": "chess_lc",
      "6": "chess_dk",
      "7": "chess_snap",
      "8": "chess_ok"
    },
    "is_kobold": {
      "1": "chess_meepo",
      "2": "chess_aw"
    },
    "is_mage": {
      "1": "chess_cm",
      "10": "chess_kael",
      "2": "chess_sm",
      "3": "chess_aa",
      "4": "chess_lina",
      "5": "chess_puck",
      "6": "chess_om",
      "7": "chess_light",
      "8": "chess_phx",
      "9": "chess_thd"
    },
    "is_mech": {
      "1": "chess_clock",
      "2": "chess_tk",
      "3": "chess_shredder",
      "4": "chess_meepo"
    },
    "is_monk": {
      "1": "chess_brew",
      "2": "chess_largo",
      "3": "chess_marci",
      "4": "chess_mk"
    },
    "is_naga": {
      "1": "chess_slark",
      "2": "chess_largo",
      "3": "chess_naga",
      "4": "chess_slardar",
      "5": "chess_medusa"
    },
    "is_nraqi": {
      "1": "chess_bane",
      "2": "chess_fv"
    },
    "is_ogre": {
      "1": "chess_om",
      "2": "chess_ga"
    },
    "is_orc": {
      "1": "chess_axe",
      "2": "chess_bs",
      "3": "chess_bm",
      "4": "chess_jugg",
      "5": "chess_chen",
      "6": "chess_disruptor"
    },
    "is_pandaman": {
      "1": "chess_brew"
    },
    "is_priest": {
      "1": "chess_dazzle",
      "2": "chess_sd",
      "3": "chess_oracle",
      "4": "chess_chen"
    },
    "is_satyr": {
      "1": "chess_bane",
      "2": "chess_riki"
    },
    "is_shaman": {
      "1": "chess_ss",
      "2": "chess_bs",
      "3": "chess_razor",
      "4": "chess_es",
      "5": "chess_disruptor",
      "6": "chess_aw"
    },
    "is_tauren": {
      "1": "chess_sb",
      "2": "chess_es",
      "3": "chess_et"
    },
    "is_troll": {
      "1": "chess_dazzle",
      "2": "chess_ss",
      "3": "chess_wd",
      "4": "chess_bat",
      "5": "chess_huskar",
      "6": "chess_troll"
    },
    "is_undead": {},
    "is_warlock": {
      "1": "chess_bane",
      "2": "chess_wd",
      "3": "chess_ds",
      "4": "chess_veno",
      "5": "chess_enigma",
      "6": "chess_sf",
      "7": "chess_ga",
      "8": "chess_au"
    },
    "is_warrior": {
      "1": "chess_axe",
      "10": "chess_kunkka",
      "11": "chess_doom",
      "12": "chess_troll",
      "13": "chess_sven",
      "2": "chess_mars",
      "3": "chess_tusk",
      "4": "chess_jugg",
      "5": "chess_ct",
      "6": "chess_tiny",
      "7": "chess_huskar",
      "8": "chess_lyc",
      "9": "chess_slardar"
    },
    "is_wizard": {
      "1": "chess_dw",
      "2": "chess_rubick",
      "3": "chess_naga",
      "4": "chess_lion"
    }
  },
  "chess_list_by_synergy_ban_unavailable": {
    "is_aqir": {},
    "is_assassin": {
      "1": "chess_morph",
      "2": "chess_qop"
    },
    "is_beast": {
      "1": "chess_pb"
    },
    "is_centaur": {},
    "is_demon": {
      "1": "chess_qop",
      "2": "chess_ck_ssr"
    },
    "is_demonhunter": {},
    "is_draenei": {},
    "is_dragon": {
      "1": "chess_om_ssr"
    },
    "is_druid": {},
    "is_dwarf": {
      "1": "chess_gyro"
    },
    "is_element": {
      "1": "chess_morph"
    },
    "is_elf": {
      "1": "chess_morph"
    },
    "is_goblin": {
      "1": "chess_tech"
    },
    "is_god": {
      "1": "chess_zeus"
    },
    "is_harpy": {},
    "is_human": {},
    "is_hunter": {
      "1": "chess_th"
    },
    "is_knight": {
      "1": "chess_ck_ssr"
    },
    "is_kobold": {},
    "is_mage": {
      "1": "chess_zeus",
      "2": "chess_om_ssr"
    },
    "is_mech": {
      "1": "chess_gyro",
      "2": "chess_tech"
    },
    "is_monk": {
      "1": "chess_brew_ssr"
    },
    "is_naga": {
      "1": "chess_th"
    },
    "is_nraqi": {},
    "is_ogre": {
      "1": "chess_om_ssr"
    },
    "is_orc": {
      "1": "chess_wl"
    },
    "is_pandaman": {
      "1": "chess_brew_ssr"
    },
    "is_priest": {},
    "is_satyr": {},
    "is_shaman": {
      "1": "chess_ss_ssr"
    },
    "is_tauren": {},
    "is_troll": {
      "1": "chess_ss_ssr"
    },
    "is_undead": {},
    "is_warlock": {
      "1": "chess_wl"
    },
    "is_warrior": {
      "1": "chess_pb"
    },
    "is_wizard": {}
  },
  "chess_list_by_synergy_black_and_pandaman": {
    "is_aqir": {
      "1": "chess_na"
    },
    "is_assassin": {
      "1": "chess_na",
      "2": "chess_ember"
    },
    "is_beast": {},
    "is_centaur": {},
    "is_demon": {},
    "is_demonhunter": {
      "1": "chess_vs",
      "2": "chess_spe"
    },
    "is_draenei": {},
    "is_dragon": {
      "1": "chess_ww"
    },
    "is_druid": {},
    "is_dwarf": {},
    "is_element": {},
    "is_elf": {},
    "is_goblin": {},
    "is_god": {},
    "is_harpy": {
      "1": "chess_vs"
    },
    "is_human": {},
    "is_hunter": {
      "1": "chess_clinkz",
      "2": "chess_muerta",
      "3": "chess_dr"
    },
    "is_knight": {
      "1": "chess_abaddon"
    },
    "is_kobold": {
      "1": "chess_naix"
    },
    "is_mage": {
      "1": "chess_ww",
      "2": "chess_lich",
      "3": "chess_storm"
    },
    "is_mech": {},
    "is_monk": {
      "1": "chess_void"
    },
    "is_naga": {},
    "is_nraqi": {},
    "is_ogre": {},
    "is_orc": {},
    "is_pandaman": {
      "1": "chess_ember",
      "2": "chess_earth",
      "3": "chess_storm",
      "4": "chess_void"
    },
    "is_priest": {
      "1": "chess_ud"
    },
    "is_satyr": {},
    "is_shaman": {
      "1": "chess_earth"
    },
    "is_tauren": {},
    "is_troll": {},
    "is_undead": {
      "1": "chess_abaddon",
      "10": "chess_na",
      "11": "chess_lich",
      "12": "chess_dp",
      "13": "chess_spe",
      "14": "chess_snk",
      "15": "chess_nec",
      "2": "chess_ww",
      "3": "chess_clinkz",
      "4": "chess_muerta",
      "5": "chess_naix",
      "6": "chess_vs",
      "7": "chess_dr",
      "8": "chess_ud",
      "9": "chess_pudge"
    },
    "is_warlock": {
      "1": "chess_naix",
      "2": "chess_dp",
      "3": "chess_nec"
    },
    "is_warrior": {
      "1": "chess_pudge",
      "2": "chess_snk"
    },
    "is_wizard": {}
  },
  "chess_rm_class": {
    "1": "is_demonhunter",
    "2": "is_assassin",
    "3": "is_druid"
  },
  "food_list": {
    "1": "item_qinwangduandao",
    "10": "item_fushizhiqiu",
    "11": "item_yongqizhiguang",
    "12": "item_xingyunguazhui",
    "13": "item_linglichangbian",
    "14": "item_dianjinshou",
    "15": "item_yuanlifazhang",
    "16": "item_tiaodao",
    "17": "item_wuzhixiaomao",
    "2": "item_lilianghuwan",
    "3": "item_yuanlingxidai",
    "4": "item_konglingguajian",
    "5": "item_shuijingjian",
    "6": "item_suiluchui",
    "7": "item_xuanmingdunpai",
    "8": "item_zhusidoupeng",
    "9": "item_wangzhezhijie"
  },
  "item_level_list": {
    "item_ahalimumojing": 2,
    "item_ahalimushenzhang": 5,
    "item_aiweinazhiyu": 2,
    "item_anmie": 3,
    "item_aoshuxie": 3,
    "item_bingyan": 5,
    "item_bkb": 4,
    "item_buxiuzhishouhu": 3,
    "item_cantie": 3,
    "item_changdun": 2,
    "item_chihongjia": 3,
    "item_dadianchui": 5,
    "item_dapao": 5,
    "item_dayunchui": 4,
    "item_dianjinshou": 1,
    "item_dongchayandou": 3,
    "item_fashulengjing": 3,
    "item_feijiangxiaomao": 2,
    "item_fengkuangmianju": 2,
    "item_fulingsuo": 4,
    "item_fushizhiqiu": 1,
    "item_goutourenjiubei": 3,
    "item_gulonghaojiao": 4,
    "item_haojie": 5,
    "item_hongzhang": 4,
    "item_huanyingfu": 4,
    "item_hudie": 4,
    "item_huiguang": 2,
    "item_huiyao": 4,
    "item_jinghunzhiren": 3,
    "item_jingmixie": 2,
    "item_jingubang": 4,
    "item_jipin": 2,
    "item_jurenzhijie": 4,
    "item_konglingguajian": 1,
    "item_kuangzhanfu": 4,
    "item_lilianghuwan": 1,
    "item_linglichangbian": 1,
    "item_linkenfaqiu": 3,
    "item_meiken": 3,
    "item_minglingshu": 4,
    "item_moping": 2,
    "item_qiangxi": 5,
    "item_qinwangduandao": 1,
    "item_qishijian": 3,
    "item_rengu": 2,
    "item_renjia": 2,
    "item_sadan": 5,
    "item_sanchaji": 3,
    "item_shengjian": 5,
    "item_shenjingdun": 5,
    "item_shirenmozhimao": 5,
    "item_shuaxinqiu": 4,
    "item_shuijingjian": 1,
    "item_suiluchui": 1,
    "item_tiantangzhiji": 3,
    "item_tiaodao": 1,
    "item_tiaozhantoujin": 2,
    "item_wangchongtui": 2,
    "item_wangyuanjing": 2,
    "item_wangzhezhijie": 1,
    "item_weishijingjia": 4,
    "item_wuzhixiaomao": 1,
    "item_xianfengdun": 2,
    "item_xingyunguazhui": 1,
    "item_xiwa": 3,
    "item_xuanmingdunpai": 1,
    "item_xuanwo": 2,
    "item_xueji": 4,
    "item_xuejingshi": 3,
    "item_yangdao": 5,
    "item_yinyuezhijing": 3,
    "item_yonghengzhipan": 5,
    "item_yongqizhiguang": 1,
    "item_yuanlifazhang": 1,
    "item_yuanlingxidai": 1,
    "item_zhusidoupeng": 1
  },
  "item_list_by_mana": {
    "1": {
      "1": "item_qinwangduandao",
      "10": "item_fushizhiqiu",
      "11": "item_yongqizhiguang",
      "12": "item_xingyunguazhui",
      "13": "item_linglichangbian",
      "14": "item_dianjinshou",
      "15": "item_yuanlifazhang",
      "16": "item_tiaodao",
      "17": "item_wuzhixiaomao",
      "2": "item_lilianghuwan",
      "3": "item_yuanlingxidai",
      "4": "item_konglingguajian",
      "5": "item_shuijingjian",
      "6": "item_suiluchui",
      "7": "item_xuanmingdunpai",
      "8": "item_zhusidoupeng",
      "9": "item_wangzhezhijie"
    },
    "2": {
      "1": "item_rengu",
      "10": "item_jipin",
      "11": "item_moping",
      "12": "item_wangyuanjing",
      "13": "item_wangchongtui",
      "14": "item_feijiangxiaomao",
      "15": "item_jingmixie",
      "16": "item_aiweinazhiyu",
      "17": "item_cantie",
      "2": "item_xuanwo",
      "3": "item_huiguang",
      "4": "item_ahalimumojing",
      "5": "item_fengkuangmianju",
      "6": "item_renjia",
      "7": "item_xianfengdun",
      "8": "item_changdun",
      "9": "item_tiaozhantoujin"
    },
    "3": {
      "1": "item_yinyuezhijing",
      "10": "item_xiwa",
      "11": "item_linkenfaqiu",
      "12": "item_xuejingshi",
      "13": "item_buxiuzhishouhu",
      "14": "item_goutourenjiubei",
      "15": "item_fashulengjing",
      "16": "item_aoshuxie",
      "2": "item_anmie",
      "3": "item_jinghunzhiren",
      "4": "item_tiantangzhiji",
      "5": "item_sanchaji",
      "6": "item_qishijian",
      "7": "item_meiken",
      "8": "item_chihongjia",
      "9": "item_dongchayandou"
    },
    "4": {
      "1": "item_huiyao",
      "10": "item_huanyingfu",
      "11": "item_hongzhang",
      "12": "item_shuaxinqiu",
      "13": "item_gulonghaojiao",
      "14": "item_minglingshu",
      "15": "item_weishijingjia",
      "2": "item_jingubang",
      "3": "item_hudie",
      "4": "item_xueji",
      "5": "item_bkb",
      "6": "item_jurenzhijie",
      "7": "item_dayunchui",
      "8": "item_fulingsuo",
      "9": "item_kuangzhanfu"
    },
    "5": {
      "1": "item_shengjian",
      "10": "item_yonghengzhipan",
      "11": "item_shenjingdun",
      "12": "item_shirenmozhimao",
      "2": "item_dapao",
      "3": "item_dadianchui",
      "4": "item_haojie",
      "5": "item_bingyan",
      "6": "item_ahalimushenzhang",
      "7": "item_yangdao",
      "8": "item_sadan",
      "9": "item_qiangxi"
    }
  },
  "legendary_info": {
    "chess_active": {
      "1": "chess_ok",
      "10": "chess_au",
      "2": "chess_ta",
      "3": "chess_thd",
      "4": "chess_ts",
      "5": "chess_troll",
      "6": "chess_aw",
      "7": "chess_disruptor",
      "8": "chess_kael",
      "9": "chess_sven"
    },
    "chess_banned": {
      "1": "chess_qop",
      "2": "chess_gyro",
      "3": "chess_tech",
      "4": "chess_rm",
      "5": "chess_zeus",
      "6": "chess_wl",
      "7": "chess_morph",
      "8": "chess_th",
      "9": "chess_pb"
    },
    "hehe": 379,
    "relic_active": {
      "1": "item_streak_plus",
      "10": "item_free_draw",
      "2": "item_free_ban",
      "3": "item_second_chance",
      "4": "item_egg",
      "5": "item_bench_contract",
      "6": "item_more_creep",
      "7": "item_malefic_rapture",
      "8": "item_both_leaves",
      "9": "item_repeat_relic"
    },
    "relic_banned": {
      "1": "item_super_uprank",
      "2": "item_rank_damage",
      "3": "item_rm_wheel_of_wonder",
      "4": "item_upgrade_lootbox",
      "5": "item_magic_box",
      "6": "item_double_coin",
      "7": "item_mangotree"
    }
  },
  "relic_list": {
    "1": "item_upgrade_lootbox",
    "10": "item_rm_wheel_of_wonder",
    "11": "item_both_leaves",
    "12": "item_magic_box",
    "13": "item_double_coin",
    "14": "item_repeat_relic",
    "15": "item_free_draw",
    "16": "item_super_uprank",
    "17": "item_rank_damage",
    "2": "item_streak_plus",
    "3": "item_free_ban",
    "4": "item_second_chance",
    "5": "item_egg",
    "6": "item_bench_contract",
    "7": "item_mangotree",
    "8": "item_more_creep",
    "9": "item_malefic_rapture"
  },
  "revealed_legendary_chess_list": {
    "1": "chess_aw",
    "2": "chess_sven",
    "3": "chess_ok",
    "4": "chess_troll",
    "5": "chess_disruptor"
  },
  "synergy_info": {
    "is_aqir": {
      "1": "chess_veno",
      "2": "chess_sk",
      "3": "chess_br"
    },
    "is_assassin": {
      "1": "chess_sb",
      "10": "chess_mag",
      "2": "chess_slark",
      "3": "chess_fv",
      "4": "chess_riki",
      "5": "chess_viper",
      "6": "chess_kez",
      "7": "chess_sk",
      "8": "chess_pangolier",
      "9": "chess_pa"
    },
    "is_beast": {
      "1": "chess_tusk",
      "2": "chess_eh",
      "3": "chess_hw",
      "4": "chess_veno",
      "5": "chess_lyc",
      "6": "chess_pangolier",
      "7": "chess_mk",
      "8": "chess_ld"
    },
    "is_centaur": {
      "1": "chess_eh",
      "2": "chess_ct",
      "3": "chess_mag"
    },
    "is_demon": {
      "1": "chess_sd",
      "2": "chess_ck",
      "3": "chess_tb",
      "4": "chess_sf",
      "5": "chess_doom",
      "6": "chess_lion",
      "7": "chess_sven"
    },
    "is_demonhunter": {
      "1": "chess_tb",
      "2": "chess_am"
    },
    "is_draenei": {
      "1": "chess_bh",
      "2": "chess_sd",
      "3": "chess_ds",
      "4": "chess_db"
    },
    "is_dragon": {
      "1": "chess_puck",
      "2": "chess_viper",
      "3": "chess_dk"
    },
    "is_druid": {
      "1": "chess_eh",
      "2": "chess_fur",
      "3": "chess_tp",
      "4": "chess_ld",
      "5": "chess_et"
    },
    "is_dwarf": {
      "1": "chess_sniper"
    },
    "is_element": {
      "1": "chess_aa",
      "2": "chess_tiny",
      "3": "chess_razor",
      "4": "chess_enigma",
      "5": "chess_phx"
    },
    "is_elf": {
      "1": "chess_dw",
      "10": "chess_am",
      "2": "chess_pom",
      "3": "chess_luna",
      "4": "chess_fur",
      "5": "chess_puck",
      "6": "chess_wr",
      "7": "chess_tp",
      "8": "chess_marci",
      "9": "chess_pa"
    },
    "is_goblin": {
      "1": "chess_clock",
      "2": "chess_tk",
      "3": "chess_bh",
      "4": "chess_shredder",
      "5": "chess_snap",
      "6": "chess_ga"
    },
    "is_god": {
      "1": "chess_mars",
      "2": "chess_oracle",
      "3": "chess_rubick",
      "4": "chess_et"
    },
    "is_harpy": {
      "1": "chess_sm",
      "2": "chess_kez"
    },
    "is_human": {
      "1": "chess_cm",
      "2": "chess_lina",
      "3": "chess_lyc",
      "4": "chess_lc",
      "5": "chess_light",
      "6": "chess_kunkka",
      "7": "chess_dk",
      "8": "chess_ok"
    },
    "is_hunter": {
      "1": "chess_bh",
      "2": "chess_hw",
      "3": "chess_pom",
      "4": "chess_wr",
      "5": "chess_sniper",
      "6": "chess_bm",
      "7": "chess_medusa",
      "8": "chess_br"
    },
    "is_knight": {
      "1": "chess_bat",
      "2": "chess_ck",
      "3": "chess_luna",
      "4": "chess_db",
      "5": "chess_lc",
      "6": "chess_dk",
      "7": "chess_snap",
      "8": "chess_ok"
    },
    "is_kobold": {
      "1": "chess_meepo",
      "2": "chess_aw"
    },
    "is_mage": {
      "1": "chess_cm",
      "2": "chess_sm",
      "3": "chess_aa",
      "4": "chess_lina",
      "5": "chess_puck",
      "6": "chess_om",
      "7": "chess_light",
      "8": "chess_phx"
    },
    "is_mech": {
      "1": "chess_clock",
      "2": "chess_tk",
      "3": "chess_shredder",
      "4": "chess_meepo"
    },
    "is_monk": {
      "1": "chess_brew",
      "2": "chess_largo",
      "3": "chess_marci",
      "4": "chess_mk"
    },
    "is_naga": {
      "1": "chess_slark",
      "2": "chess_largo",
      "3": "chess_naga",
      "4": "chess_slardar",
      "5": "chess_medusa"
    },
    "is_nraqi": {
      "1": "chess_bane",
      "2": "chess_fv"
    },
    "is_ogre": {
      "1": "chess_om",
      "2": "chess_ga"
    },
    "is_orc": {
      "1": "chess_axe",
      "2": "chess_bs",
      "3": "chess_bm",
      "4": "chess_jugg",
      "5": "chess_chen",
      "6": "chess_disruptor"
    },
    "is_pandaman": {
      "1": "chess_brew"
    },
    "is_priest": {
      "1": "chess_dazzle",
      "2": "chess_sd",
      "3": "chess_oracle",
      "4": "chess_chen"
    },
    "is_satyr": {
      "1": "chess_bane",
      "2": "chess_riki"
    },
    "is_shaman": {
      "1": "chess_ss",
      "2": "chess_bs",
      "3": "chess_razor",
      "4": "chess_es",
      "5": "chess_disruptor",
      "6": "chess_aw"
    },
    "is_tauren": {
      "1": "chess_sb",
      "2": "chess_es",
      "3": "chess_et"
    },
    "is_troll": {
      "1": "chess_dazzle",
      "2": "chess_ss",
      "3": "chess_wd",
      "4": "chess_bat",
      "5": "chess_huskar",
      "6": "chess_troll"
    },
    "is_undead": {},
    "is_warlock": {
      "1": "chess_bane",
      "2": "chess_wd",
      "3": "chess_ds",
      "4": "chess_veno",
      "5": "chess_enigma",
      "6": "chess_sf",
      "7": "chess_ga"
    },
    "is_warrior": {
      "1": "chess_axe",
      "10": "chess_kunkka",
      "11": "chess_doom",
      "12": "chess_troll",
      "13": "chess_sven",
      "2": "chess_mars",
      "3": "chess_tusk",
      "4": "chess_jugg",
      "5": "chess_ct",
      "6": "chess_tiny",
      "7": "chess_huskar",
      "8": "chess_lyc",
      "9": "chess_slardar"
    },
    "is_wizard": {
      "1": "chess_dw",
      "2": "chess_rubick",
      "3": "chess_naga",
      "4": "chess_lion"
    }
  },
  "unrevealed_legendary_chess_list": {
    "1": "chess_ta",
    "2": "chess_au",
    "3": "chess_kael",
    "4": "chess_thd",
    "5": "chess_ts"
  }
}
```

#### `CustomNetTable_dac_table`

```json
{
  "player_info": {
    "hehe": 524,
    "info": {
      "steam_id_7": {
        "biscuit": 0,
        "block_team": {},
        "buff": "",
        "candy": 205,
        "candy_award": 0,
        "chess_hand": "",
        "chess_lineup": "",
        "deaths": 0,
        "draw_round": 0,
        "duration": 0,
        "hero_damage": 0,
        "hero_damaged": 0,
        "hero_level": 0,
        "hp": 100,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 0,
        "lose_round": 0,
        "max_lineup_value": 0,
        "max_lineup_value_lineup": "",
        "mmr_level": 20,
        "mvp_chess_damage": 0,
        "mvp_chess_items": "",
        "mvp_chess_name": "",
        "pandaman_getlist": {},
        "player_id": 0,
        "rank": 0,
        "relic_history": {},
        "round": 0,
        "show_buff": "",
        "steam_id": "steam_id_7",
        "talent_tree": {},
        "team_id": 9,
        "total_money": 0,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82195,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h421",
        "zhugong_effect": "e000",
        "zhugong_model": "models/items/courier/onibi_lvl_21/onibi_lvl_21.vmdl"
      },
      "steam_id_6": {
        "biscuit": 0,
        "block_team": {},
        "buff": "",
        "candy": 64,
        "candy_award": 0,
        "chess_hand": "",
        "chess_lineup": "",
        "deaths": 0,
        "draw_round": 0,
        "duration": 0,
        "hero_damage": 0,
        "hero_damaged": 0,
        "hero_level": 0,
        "hp": 100,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 0,
        "lose_round": 0,
        "max_lineup_value": 0,
        "max_lineup_value_lineup": "",
        "mmr_level": 17,
        "mvp_chess_damage": 0,
        "mvp_chess_items": "",
        "mvp_chess_name": "",
        "pandaman_getlist": {},
        "player_id": 6,
        "rank": 0,
        "relic_history": {},
        "round": 0,
        "show_buff": "",
        "steam_id": "steam_id_6",
        "talent_tree": {},
        "team_id": 6,
        "total_money": 0,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82251,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h221",
        "zhugong_effect": "e000",
        "zhugong_model": "models/items/courier/bajie_pig/bajie_pig.vmdl"
      },
      "steam_id_5": {
        "biscuit": 0,
        "block_team": {},
        "buff": "",
        "candy": 24,
        "candy_award": 0,
        "chess_hand": "",
        "chess_lineup": "",
        "deaths": 0,
        "draw_round": 0,
        "duration": 0,
        "hero_damage": 0,
        "hero_damaged": 0,
        "hero_level": 0,
        "hp": 100,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 0,
        "lose_round": 0,
        "max_lineup_value": 0,
        "max_lineup_value_lineup": "",
        "mmr_level": 0,
        "mvp_chess_damage": 0,
        "mvp_chess_items": "",
        "mvp_chess_name": "",
        "pandaman_getlist": {},
        "player_id": 1,
        "rank": 0,
        "relic_history": {},
        "round": 0,
        "show_buff": "",
        "steam_id": "steam_id_5",
        "talent_tree": {},
        "team_id": 10,
        "total_money": 0,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82265,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h215",
        "zhugong_effect": "e000",
        "zhugong_model": "models/items/courier/boooofus_courier/boooofus_courier.vmdl"
      },
      "steam_id_4": {
        "biscuit": 0,
        "block_team": {},
        "buff": "",
        "candy": 879,
        "candy_award": 0,
        "chess_hand": "",
        "chess_lineup": "",
        "deaths": 0,
        "draw_round": 0,
        "duration": 0,
        "hero_damage": 0,
        "hero_damaged": 0,
        "hero_level": 0,
        "hp": 100,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 0,
        "lose_round": 0,
        "max_lineup_value": 0,
        "max_lineup_value_lineup": "",
        "mmr_level": 21,
        "mvp_chess_damage": 0,
        "mvp_chess_items": "",
        "mvp_chess_name": "",
        "pandaman_getlist": {},
        "player_id": 2,
        "rank": 0,
        "relic_history": {},
        "round": 0,
        "show_buff": "",
        "steam_id": "steam_id_4",
        "talent_tree": {},
        "team_id": 11,
        "total_money": 0,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82305,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h318",
        "zhugong_effect": "e000",
        "zhugong_model": "models/courier/baby_rosh/babyroshan.vmdl"
      },
      "steam_id_3": {
        "biscuit": 0,
        "block_team": {},
        "buff": "",
        "candy": 793,
        "candy_award": 0,
        "chess_hand": "",
        "chess_lineup": "",
        "deaths": 0,
        "draw_round": 0,
        "duration": 0,
        "hero_damage": 0,
        "hero_damaged": 0,
        "hero_level": 0,
        "hp": 100,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 0,
        "lose_round": 0,
        "max_lineup_value": 0,
        "max_lineup_value_lineup": "",
        "mmr_level": 17,
        "mvp_chess_damage": 0,
        "mvp_chess_items": "",
        "mvp_chess_name": "",
        "pandaman_getlist": {},
        "player_id": 7,
        "rank": 0,
        "relic_history": {},
        "round": 0,
        "show_buff": "",
        "steam_id": "steam_id_3",
        "talent_tree": {},
        "team_id": 13,
        "total_money": 0,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82199,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h290",
        "zhugong_effect": "e000",
        "zhugong_model": "models/nanguashenshi/nanguashenshi.vmdl"
      },
      "steam_id_2": {
        "biscuit": 0,
        "block_team": {},
        "buff": "",
        "candy": 153,
        "candy_award": 0,
        "chess_hand": "",
        "chess_lineup": "",
        "deaths": 0,
        "draw_round": 0,
        "duration": 0,
        "hero_damage": 0,
        "hero_damaged": 0,
        "hero_level": 0,
        "hp": 100,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 0,
        "lose_round": 0,
        "max_lineup_value": 0,
        "max_lineup_value_lineup": "",
        "mmr_level": 18,
        "mvp_chess_damage": 0,
        "mvp_chess_items": "",
        "mvp_chess_name": "",
        "pandaman_getlist": {},
        "player_id": 5,
        "rank": 0,
        "relic_history": {},
        "round": 0,
        "show_buff": "",
        "steam_id": "steam_id_2",
        "talent_tree": {},
        "team_id": 7,
        "total_money": 0,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82260,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h202",
        "zhugong_effect": "e000",
        "zhugong_model": "models/courier/huntling/huntling.vmdl"
      },
      "steam_id_1": {
        "biscuit": 0,
        "block_team": {},
        "buff": "",
        "candy": 125,
        "candy_award": 0,
        "chess_hand": "",
        "chess_lineup": "",
        "deaths": 0,
        "draw_round": 0,
        "duration": 0,
        "hero_damage": 0,
        "hero_damaged": 0,
        "hero_level": 0,
        "hp": 100,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 0,
        "lose_round": 0,
        "max_lineup_value": 0,
        "max_lineup_value_lineup": "",
        "mmr_level": 17,
        "mvp_chess_damage": 0,
        "mvp_chess_items": "",
        "mvp_chess_name": "",
        "pandaman_getlist": {},
        "player_id": 4,
        "rank": 0,
        "relic_history": {},
        "round": 0,
        "show_buff": "",
        "steam_id": "steam_id_1",
        "talent_tree": {},
        "team_id": 8,
        "total_money": 0,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82262,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h002",
        "zhugong_effect": "e000",
        "zhugong_model": "models/props_gameplay/donkey_dire.vmdl"
      },
      "steam_id_0": {
        "biscuit": 0,
        "block_team": {},
        "buff": "",
        "candy": 0,
        "candy_award": 0,
        "chess_hand": "",
        "chess_lineup": "",
        "deaths": 0,
        "draw_round": 0,
        "duration": 0,
        "hero_damage": 0,
        "hero_damaged": 0,
        "hero_level": 0,
        "hp": 100,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 0,
        "lose_round": 0,
        "max_lineup_value": 0,
        "max_lineup_value_lineup": "",
        "mmr_level": 12,
        "mvp_chess_damage": 0,
        "mvp_chess_items": "",
        "mvp_chess_name": "",
        "pandaman_getlist": {},
        "player_id": 3,
        "rank": 0,
        "relic_history": {},
        "round": 0,
        "show_buff": "",
        "steam_id": "steam_id_0",
        "talent_tree": {},
        "team_id": 12,
        "total_money": 0,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82296,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h001",
        "zhugong_effect": "e000",
        "zhugong_model": "models/props_gameplay/donkey.vmdl"
      }
    }
  },
  "show_all_player_connect_status": {
    "hehe": 11680,
    "table": {
      "0": 1,
      "1": 1,
      "2": 1,
      "3": 1,
      "4": 1,
      "5": 1,
      "6": 1,
      "7": 1
    }
  },
  "user_panel_ranking": {
    "hehe": 871,
    "table": {
      "steam_id_7": {
        "curr_rank": 8
      },
      "steam_id_6": {
        "curr_rank": 2
      },
      "steam_id_5": {
        "curr_rank": 7
      },
      "steam_id_4": {
        "curr_rank": 6
      },
      "steam_id_3": {
        "curr_rank": 1
      },
      "steam_id_2": {
        "curr_rank": 3
      },
      "steam_id_1": {
        "curr_rank": 4
      },
      "steam_id_0": {
        "curr_rank": 5
      }
    }
  }
}
```

#### `CustomNetTable_game_info`

```json
{
  "death_team": {
    "10": 0,
    "11": 0,
    "12": 0,
    "13": 0,
    "6": 0,
    "7": 0,
    "8": 0,
    "9": 0
  },
  "game_version": {
    "version": "dist"
  },
  "quest": {
    "biscuit_quest": "q029"
  },
  "round_info": {
    "round": 3
  }
}
```

#### `CustomNetTable_hp_bar_table`

```json
{
  "hp_bar": {
    "208": {
      "is_hero": 1,
      "unit_index": 208,
      "unit_name": "npc_dota_hero_wisp"
    },
    "240": {
      "is_hero": 1,
      "unit_index": 240,
      "unit_name": "npc_dota_hero_wisp"
    },
    "272": {
      "is_hero": 1,
      "unit_index": 272,
      "unit_name": "npc_dota_hero_wisp"
    },
    "304": {
      "is_hero": 1,
      "unit_index": 304,
      "unit_name": "npc_dota_hero_wisp"
    },
    "336": {
      "is_hero": 1,
      "unit_index": 336,
      "unit_name": "npc_dota_hero_wisp"
    },
    "368": {
      "is_hero": 1,
      "unit_index": 368,
      "unit_name": "npc_dota_hero_wisp"
    },
    "400": {
      "is_hero": 1,
      "unit_index": 400,
      "unit_name": "npc_dota_hero_wisp"
    },
    "432": {
      "is_hero": 1,
      "unit_index": 432,
      "unit_name": "npc_dota_hero_wisp"
    }
  }
}
```

#### `CustomNetTable_player_id_table`

```json
{
  "chessboard_0": {
    "chessboard": "b106"
  },
  "chessboard_1": {
    "chessboard": "b101"
  },
  "chessboard_2": {
    "chessboard": "b101"
  },
  "chessboard_3": {
    "chessboard": "b106"
  },
  "chessboard_4": {
    "chessboard": "b103"
  },
  "chessboard_5": {
    "chessboard": "b101"
  },
  "chessboard_6": {
    "chessboard": "b103"
  },
  "chessboard_7": {
    "chessboard": "b101"
  },
  "courier_0": {
    "courier": "h421",
    "level": 5,
    "win_streak": 1
  },
  "courier_1": {
    "courier": "h215",
    "level": 5,
    "win_streak": 0
  },
  "courier_2": {
    "courier": "h318",
    "level": 5,
    "win_streak": 0
  },
  "courier_3": {
    "courier": "h001",
    "level": 5,
    "win_streak": 0
  },
  "courier_4": {
    "courier": "h002",
    "level": 5,
    "win_streak": 1
  },
  "courier_5": {
    "courier": "h202",
    "level": 5,
    "win_streak": 3
  },
  "courier_6": {
    "courier": "h221",
    "level": 5,
    "win_streak": 0
  },
  "courier_7": {
    "courier": "h290",
    "level": 5,
    "win_streak": 1
  },
  "mmr_level_0": {
    "candy": 205,
    "mmr_level": 20
  },
  "mmr_level_1": {
    "candy": 24,
    "mmr_level": 0
  },
  "mmr_level_2": {
    "candy": 879,
    "mmr_level": 21
  },
  "mmr_level_3": {
    "candy": 0,
    "mmr_level": 12
  },
  "mmr_level_4": {
    "candy": 125,
    "mmr_level": 17
  },
  "mmr_level_5": {
    "candy": 153,
    "mmr_level": 18
  },
  "mmr_level_6": {
    "candy": 64,
    "mmr_level": 17
  },
  "mmr_level_7": {
    "candy": 793,
    "mmr_level": 17
  },
  "player_0": {
    "hero_index": 432,
    "player_id": 0,
    "player_index": 3,
    "team_id": 9
  },
  "player_1": {
    "hero_index": 400,
    "player_id": 1,
    "player_index": 4,
    "team_id": 10
  },
  "player_2": {
    "hero_index": 208,
    "player_id": 2,
    "player_index": 5,
    "team_id": 11
  },
  "player_3": {
    "hero_index": 240,
    "player_id": 3,
    "player_index": 6,
    "team_id": 12
  },
  "player_4": {
    "hero_index": 272,
    "player_id": 4,
    "player_index": 2,
    "team_id": 8
  },
  "player_5": {
    "hero_index": 304,
    "player_id": 5,
    "player_index": 1,
    "team_id": 7
  },
  "player_6": {
    "hero_index": 368,
    "player_id": 6,
    "player_index": 0,
    "team_id": 6
  },
  "player_7": {
    "hero_index": 336,
    "player_id": 7,
    "player_index": 7,
    "team_id": 13
  },
  "relic_ttl_0": {
    "relic_name": "item_more_creep",
    "ttl": 10
  },
  "relic_ttl_2": {
    "relic_name": "item_malefic_rapture",
    "ttl": 10
  },
  "relic_ttl_3": {
    "relic_name": "item_egg",
    "ttl": 10
  },
  "relic_ttl_5": {
    "relic_name": "item_malefic_rapture",
    "ttl": 10
  },
  "relic_ttl_6": {
    "relic_name": "item_free_ban",
    "ttl": 10
  },
  "relic_ttl_7": {
    "relic_name": "item_egg",
    "ttl": 10
  },
  "vchess_0": {
    "1_1": {
      "buy_price": 2,
      "chess": "chess_earth",
      "index": 1874,
      "item": {},
      "lastitem": {
        "1": "item_xingyunguazhui"
      },
      "water_id": 18,
      "x": 1,
      "y": 1
    },
    "1_3": {
      "buy_price": 2,
      "chess": "chess_lina",
      "index": 1283,
      "item": {},
      "lastitem": {},
      "water_id": 15,
      "x": 3,
      "y": 1
    },
    "1_5": {
      "buy_price": 1,
      "chess": "chess_cm",
      "index": 1098,
      "item": {},
      "lastitem": {},
      "water_id": 16,
      "x": 5,
      "y": 1
    },
    "4_2": {
      "buy_price": 1,
      "chess": "chess_brew",
      "index": 2037,
      "item": {},
      "lastitem": {},
      "water_id": 1,
      "x": 2,
      "y": 4
    },
    "4_6": {
      "buy_price": 3,
      "chess": "chess_lc",
      "index": 1378,
      "item": {},
      "lastitem": {
        "1": "item_jingmixie",
        "2": "item_tiaodao"
      },
      "press_count": 1,
      "water_id": 17,
      "x": 6,
      "y": 4
    }
  },
  "vchess_1": {
    "1_1": {
      "buy_price": 2,
      "chess": "chess_oracle",
      "index": 638,
      "item": {},
      "lastitem": {
        "1": "item_ahalimumojing"
      },
      "mojing_ability": "fv_zhao_new",
      "mojing_ability_level": 1,
      "water_id": 6,
      "x": 1,
      "y": 1
    },
    "1_2": {
      "buy_price": 1,
      "chess": "chess_dazzle",
      "index": 1700,
      "item": {},
      "lastitem": {},
      "water_id": 3,
      "x": 2,
      "y": 1
    },
    "3_3": {
      "buy_price": 1,
      "chess": "chess_brew",
      "index": 1587,
      "item": {},
      "lastitem": {
        "1": "item_yongqizhiguang",
        "2": "item_zhusidoupeng"
      },
      "water_id": 5,
      "x": 3,
      "y": 3
    },
    "3_4": {
      "buy_price": 3,
      "changdun_count": 0,
      "chess": "chess_clock1",
      "grow_count": 0,
      "index": 570,
      "item": {},
      "lastitem": {},
      "press_count": 0,
      "x": 4,
      "xuejingshi_count": 0,
      "y": 3
    },
    "3_5": {
      "buy_price": 1,
      "chess": "chess_mars",
      "index": 556,
      "item": {},
      "lastitem": {},
      "water_id": 13,
      "x": 5,
      "y": 3
    }
  },
  "vchess_2": {
    "1_7": {
      "buy_price": 1,
      "chess": "chess_sd",
      "index": 1108,
      "item": {},
      "water_id": 15,
      "x": 7,
      "y": 1
    },
    "1_8": {
      "buy_price": 1,
      "chess": "chess_dazzle",
      "index": 854,
      "item": {},
      "water_id": 9,
      "x": 8,
      "y": 1
    }
  },
  "vchess_3": {
    "2_3": {
      "buy_price": 1,
      "chess": "chess_sm",
      "index": 1531,
      "item": {},
      "lastitem": {},
      "water_id": 6,
      "x": 3,
      "y": 2
    },
    "2_4": {
      "buy_price": 2,
      "chess": "chess_lina",
      "index": 599,
      "item": {},
      "lastitem": {},
      "water_id": 7,
      "x": 4,
      "y": 2
    },
    "3_4": {
      "buy_price": 2,
      "changdun_count": 0,
      "chess": "chess_tk1",
      "grow_count": 0,
      "index": 949,
      "item": {},
      "lastitem": {
        "1": "item_wangzhezhijie"
      },
      "press_count": 0,
      "water_id": 11,
      "x": 4,
      "xuejingshi_count": 0,
      "y": 3
    },
    "3_5": {
      "buy_price": 1,
      "chess": "chess_aa",
      "index": 1771,
      "item": {},
      "lastitem": {
        "1": "item_fengkuangmianju"
      },
      "water_id": 1,
      "x": 5,
      "y": 3
    },
    "4_5": {
      "buy_price": 3,
      "chess": "chess_tp",
      "index": 1820,
      "item": {},
      "lastitem": {
        "1": "item_shuijingjian"
      },
      "water_id": 5,
      "x": 5,
      "y": 4
    }
  },
  "vchess_4": {
    "1_5": {
      "buy_price": 2,
      "chess": "chess_sniper",
      "index": 1025,
      "item": {},
      "lastitem": {},
      "water_id": 18,
      "x": 5,
      "y": 1
    },
    "1_6": {
      "buy_price": 2,
      "chess": "chess_wr",
      "index": 1629,
      "item": {},
      "lastitem": {},
      "water_id": 20,
      "x": 6,
      "y": 1
    },
    "1_8": {
      "buy_price": 1,
      "chess": "chess_bh",
      "index": 1663,
      "item": {},
      "lastitem": {},
      "water_id": 19,
      "x": 8,
      "y": 1
    },
    "4_4": {
      "buy_price": 4,
      "changdun_count": 0,
      "chess": "chess_shredder1",
      "grow_count": 0,
      "index": 1220,
      "item": {},
      "lastitem": {
        "1": "item_jingmixie",
        "2": "item_yuanlingxidai",
        "3": "item_dianjinshou"
      },
      "press_count": 0,
      "water_id": 16,
      "x": 4,
      "xuejingshi_count": 0,
      "y": 4
    },
    "4_6": {
      "buy_price": 4,
      "chess": "chess_br",
      "index": 2041,
      "item": {},
      "lastitem": {},
      "water_id": 14,
      "x": 6,
      "y": 4
    }
  },
  "vchess_5": {
    "1_4": {
      "buy_price": 3,
      "changdun_count": 0,
      "chess": "chess_bane1",
      "grow_count": 0,
      "index": 1581,
      "item": {},
      "press_count": 0,
      "x": 4,
      "xuejingshi_count": 0,
      "y": 1
    },
    "2_5": {
      "buy_price": 1,
      "chess": "chess_sm",
      "index": 698,
      "item": {},
      "lastitem": {},
      "water_id": 5,
      "x": 5,
      "y": 2
    },
    "3_3": {
      "buy_price": 6,
      "changdun_count": 0,
      "chess": "chess_void1",
      "grow_count": 0,
      "index": 1348,
      "item": {},
      "press_count": 0,
      "water_id": 17,
      "x": 3,
      "xuejingshi_count": 0,
      "y": 3
    },
    "4_4": {
      "buy_price": 3,
      "changdun_count": 0,
      "chess": "chess_brew1",
      "grow_count": 0,
      "index": 1072,
      "item": {},
      "lastitem": {
        "1": "item_xingyunguazhui",
        "2": "item_wuzhixiaomao",
        "3": "item_jipin"
      },
      "press_count": 0,
      "water_id": 13,
      "x": 4,
      "xuejingshi_count": 0,
      "y": 4
    },
    "4_5": {
      "buy_price": 2,
      "chess": "chess_ct",
      "index": 2016,
      "item": {},
      "water_id": 9,
      "x": 5,
      "y": 4
    }
  },
  "vchess_6": {
    "3_4": {
      "buy_price": 3,
      "changdun_count": 0,
      "chess": "chess_dw1",
      "grow_count": 0,
      "index": 1692,
      "item": {},
      "lastitem": {
        "1": "item_wangzhezhijie",
        "2": "item_shuijingjian",
        "3": "item_jingmixie"
      },
      "press_count": 0,
      "water_id": 8,
      "x": 4,
      "xuejingshi_count": 0,
      "y": 3
    },
    "3_5": {
      "buy_price": 1,
      "chess": "chess_tk",
      "index": 1476,
      "item": {},
      "lastitem": {},
      "water_id": 18,
      "x": 5,
      "y": 3
    },
    "4_3": {
      "buy_price": 2,
      "chess": "chess_shredder",
      "index": 1806,
      "item": {},
      "lastitem": {},
      "water_id": 9,
      "x": 3,
      "y": 4
    },
    "4_4": {
      "buy_price": 2,
      "changdun_count": 0,
      "chess": "chess_clock1",
      "grow_count": 0,
      "index": 367,
      "item": {},
      "lastitem": {},
      "press_count": 0,
      "water_id": 14,
      "x": 4,
      "xuejingshi_count": 0,
      "y": 4
    },
    "4_5": {
      "buy_price": 3,
      "chess": "chess_naga",
      "index": 1150,
      "item": {},
      "lastitem": {},
      "water_id": 17,
      "x": 5,
      "y": 4
    }
  },
  "vchess_7": {
    "1_1": {
      "buy_price": 2,
      "chess": "chess_fv",
      "index": 559,
      "item": {},
      "lastitem": {},
      "water_id": 5,
      "x": 1,
      "y": 1
    },
    "1_2": {
      "buy_price": 3,
      "chess": "chess_viper",
      "index": 951,
      "item": {},
      "lastitem": {
        "1": "item_konglingguajian",
        "2": "item_konglingguajian"
      },
      "water_id": 11,
      "x": 2,
      "y": 1
    },
    "1_3": {
      "buy_price": 2,
      "chess": "chess_slark",
      "index": 1641,
      "item": {},
      "lastitem": {},
      "water_id": 12,
      "x": 3,
      "y": 1
    },
    "1_4": {
      "buy_price": 3,
      "chess": "chess_sk",
      "index": 926,
      "item": {},
      "water_id": 13,
      "x": 4,
      "y": 1
    },
    "1_5": {
      "buy_price": 3,
      "chess": "chess_sk",
      "index": 1705,
      "item": {},
      "lastitem": {},
      "water_id": 9,
      "x": 5,
      "y": 1
    },
    "2_1": {
      "buy_price": 1,
      "chess": "chess_sb",
      "index": 831,
      "item": {},
      "lastitem": {},
      "water_id": 2,
      "x": 1,
      "y": 2
    }
  }
}
```

#### `CustomNetTable_player_info_table`

```json
{
  "player_info": {
    "data": {
      "steam_id_7": {
        "biscuit": 0,
        "block_team": {},
        "buff": "is_human:3,is_mage:2,is_pandaman:2,is_monk:1,is_shaman:1,is_knight:1,",
        "candy": 205,
        "candy_award": 0,
        "chess_hand": "chess_brew,chess_earth,chess_dazzle,chess_sd,",
        "chess_lineup": "chess_earth,chess_cm,chess_lc,chess_brew,chess_lina,",
        "chess_synergies": {
          "1": "is_human",
          "2": "is_pandaman",
          "3": "is_pandaman1"
        },
        "curr_rank": 7,
        "deaths": 0,
        "draw_round": 0,
        "duration": 613.566650390625,
        "hero_damage": 9,
        "hero_damaged": 23,
        "hero_level": 5,
        "hp": 77,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 11,
        "lose_round": 4,
        "max_lineup_value": 11,
        "max_lineup_value_lineup": "chess_earth,chess_cm,chess_lc,chess_brew,chess_lina,",
        "mmr_level": 20,
        "mvp_chess_damage": 800.6500244140625,
        "mvp_chess_items": "",
        "mvp_chess_name": "chess_ck",
        "pandaman_getlist": {
          "1": "chess_earth_10",
          "2": "chess_earth_11"
        },
        "player_id": 0,
        "rank": 0,
        "relic": "item_more_creep",
        "relic_history": {
          "1": {
            "relic": "item_more_creep",
            "round": 11
          }
        },
        "round": 12,
        "show_buff": "is_priest:2,is_demon:1",
        "steam_id": "steam_id_7",
        "talent_tree": {
          "1": "talent_1b_losebonus"
        },
        "team_id": 9,
        "total_money": 73,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82195,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 3,
        "zhugong": "h421",
        "zhugong_effect": "e000",
        "zhugong_model": "models/items/courier/onibi_lvl_21/onibi_lvl_21.vmdl"
      },
      "steam_id_6": {
        "ban_synergy": "is_assassin",
        "biscuit": 0,
        "block_team": {},
        "buff": "is_mech:3,is_goblin:3,is_wizard:2,is_naga:1,is_elf:1,",
        "candy": 64,
        "candy_award": 0,
        "chess_hand": "chess_puck1,chess_sd1,chess_ck,chess_ss,chess_lina,chess_dazzle,chess_meepo,chess_bat,",
        "chess_lineup": "chess_naga,chess_shredder,chess_dw1,chess_clock1,chess_tk,",
        "chess_synergies": {
          "1": "is_goblin",
          "2": "is_mech",
          "3": "is_wizard"
        },
        "curr_rank": 2,
        "deaths": 0,
        "draw_round": 0,
        "duration": 620.566650390625,
        "hero_damage": 30,
        "hero_damaged": 11,
        "hero_level": 5,
        "hp": 89,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 12,
        "lose_round": 2,
        "max_lineup_value": 12,
        "max_lineup_value_lineup": "chess_naga,chess_shredder,chess_dw1,chess_clock1,chess_tk,",
        "mmr_level": 17,
        "mvp_chess_damage": 1165.5692138671875,
        "mvp_chess_items": "",
        "mvp_chess_name": "chess_shredder",
        "pandaman_getlist": {},
        "player_id": 6,
        "rank": 0,
        "relic": "item_free_ban",
        "relic_history": {
          "1": {
            "relic": "item_free_ban",
            "round": 11
          }
        },
        "round": 12,
        "show_buff": "is_priest:2,is_demon:1",
        "steam_id": "steam_id_6",
        "talent_tree": {
          "1": "talent_1b_losebonus"
        },
        "team_id": 6,
        "total_money": 61,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82251,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 5,
        "zhugong": "h221",
        "zhugong_effect": "e000",
        "zhugong_model": "models/items/courier/bajie_pig/bajie_pig.vmdl"
      },
      "steam_id_5": {
        "biscuit": 0,
        "block_team": {},
        "buff": "is_priest:2,is_god:2,is_monk:1,is_mech:1,is_warrior:1,is_pandaman:1,is_goblin:1,is_troll:1,",
        "candy": 24,
        "candy_award": 0,
        "chess_hand": "chess_sd,chess_oracle,",
        "chess_lineup": "chess_brew,chess_dazzle,chess_clock1,chess_oracle,chess_mars,",
        "chess_synergies": {
          "1": "is_god",
          "2": "is_pandaman",
          "3": "is_priest"
        },
        "curr_rank": 6,
        "deaths": 0,
        "draw_round": 0,
        "duration": 620.9666748046875,
        "hero_damage": 13,
        "hero_damaged": 22,
        "hero_level": 5,
        "hp": 78,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 8,
        "lose_round": 6,
        "max_lineup_value": 8,
        "max_lineup_value_lineup": "chess_brew,chess_dazzle,chess_clock1,chess_oracle,chess_mars,",
        "mmr_level": 0,
        "mvp_chess_damage": 765.4237670898438,
        "mvp_chess_items": "",
        "mvp_chess_name": "chess_clock1",
        "pandaman_getlist": {
          "1": "chess_wd_5"
        },
        "player_id": 1,
        "rank": 0,
        "relic_history": {},
        "round": 12,
        "show_buff": "is_priest:2,is_demon:1",
        "steam_id": "steam_id_5",
        "talent_tree": {
          "1": "talent_1b_losebonus"
        },
        "team_id": 10,
        "total_money": 71,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82265,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 1,
        "zhugong": "h215",
        "zhugong_effect": "e000",
        "zhugong_model": "models/items/courier/boooofus_courier/boooofus_courier.vmdl"
      },
      "steam_id_4": {
        "biscuit": 0,
        "block_team": {},
        "buff": "is_priest:2,is_draenei:1,is_demon:1,is_troll:1,",
        "candy": 879,
        "candy_award": 0,
        "chess_hand": "chess_sb,chess_io,chess_cm,",
        "chess_lineup": "chess_dazzle,chess_sd,",
        "chess_synergies": {
          "1": "is_demon",
          "2": "is_priest"
        },
        "curr_rank": 8,
        "deaths": 0,
        "draw_round": 0,
        "duration": 607.7000732421875,
        "hero_damage": 5,
        "hero_damaged": 32,
        "hero_level": 6,
        "hp": 68,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 2,
        "lose_round": 7,
        "max_lineup_value": 8,
        "max_lineup_value_lineup": "chess_es,chess_sm,chess_sb1,chess_sm,",
        "mmr_level": 21,
        "mvp_chess_damage": 1365.07421875,
        "mvp_chess_items": "item_xianfengdun,item_wuzhixiaomao,item_lilianghuwan",
        "mvp_chess_name": "chess_sb1",
        "pandaman_getlist": {},
        "player_id": 2,
        "rank": 0,
        "relic": "item_malefic_rapture",
        "relic_history": {
          "1": {
            "relic": "item_malefic_rapture",
            "round": 12
          }
        },
        "round": 12,
        "show_buff": "is_priest:2,is_demon:1",
        "steam_id": "steam_id_4",
        "talent_tree": {
          "1": "talent_1b_losebonus"
        },
        "team_id": 11,
        "total_money": 77,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82305,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 0,
        "zhugong": "h318",
        "zhugong_effect": "e000",
        "zhugong_model": "models/courier/baby_rosh/babyroshan.vmdl"
      },
      "steam_id_3": {
        "biscuit": 0,
        "block_team": {},
        "buff": "is_assassin:5,is_nraqi:1,is_tauren:1,is_aqir:1,is_dragon:1,is_naga:1,",
        "candy": 793,
        "candy_award": 0,
        "chess_hand": "chess_io,chess_sb,chess_fv,",
        "chess_lineup": "chess_sk,chess_viper,chess_sk,chess_slark,chess_fv,chess_sb,",
        "chess_synergies": {
          "1": "is_assassin"
        },
        "curr_rank": 1,
        "deaths": 0,
        "draw_round": 0,
        "duration": 496.5333557128906,
        "hero_damage": 23,
        "hero_damaged": 10,
        "hero_level": 6,
        "hp": 90,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 14,
        "lose_round": 3,
        "max_lineup_value": 14,
        "max_lineup_value_lineup": "chess_sk,chess_viper,chess_sk,chess_slark,chess_fv,chess_sb,",
        "mmr_level": 17,
        "mvp_chess_damage": 859.308349609375,
        "mvp_chess_items": "",
        "mvp_chess_name": "chess_slark",
        "pandaman_getlist": {},
        "player_id": 7,
        "rank": 0,
        "relic": "item_egg",
        "relic_history": {
          "1": {
            "relic": "item_egg",
            "round": 11
          }
        },
        "round": 10,
        "show_buff": "is_priest:2,is_demon:1",
        "steam_id": "steam_id_3",
        "talent_tree": {
          "1": "talent_1a_winbonus"
        },
        "team_id": 13,
        "total_money": 56,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82199,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 3,
        "zhugong": "h290",
        "zhugong_effect": "e000",
        "zhugong_model": "models/nanguashenshi/nanguashenshi.vmdl"
      },
      "steam_id_2": {
        "biscuit": 0,
        "block_team": {},
        "buff": "is_monk:2,is_pandaman:2,is_warlock:1,is_mage:1,is_warrior:1,is_harpy:1,is_centaur:1,is_nraqi:1,is_satyr:1,",
        "candy": 153,
        "candy_award": 0,
        "chess_hand": "chess_puck,chess_ct,",
        "chess_lineup": "chess_sm,chess_ct,chess_brew1,chess_void1,chess_bane1,",
        "chess_synergies": {
          "1": "is_pandaman",
          "2": "is_monk",
          "3": "is_pandaman1"
        },
        "curr_rank": 4,
        "deaths": 0,
        "draw_round": 0,
        "duration": 622.566650390625,
        "hero_damage": 22,
        "hero_damaged": 14,
        "hero_level": 5,
        "hp": 86,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 21,
        "lose_round": 3,
        "max_lineup_value": 21,
        "max_lineup_value_lineup": "chess_sm,chess_ct,chess_brew1,chess_void1,chess_bane1,",
        "mmr_level": 18,
        "mvp_chess_damage": 3277.704833984375,
        "mvp_chess_items": "",
        "mvp_chess_name": "chess_void",
        "pandaman_getlist": {
          "1": "chess_void_8",
          "2": "chess_void_9",
          "3": "chess_void_10"
        },
        "player_id": 5,
        "rank": 0,
        "relic": "item_malefic_rapture",
        "relic_history": {
          "1": {
            "relic": "item_malefic_rapture",
            "round": 11
          }
        },
        "round": 12,
        "show_buff": "is_priest:2,is_demon:1",
        "steam_id": "steam_id_2",
        "talent_tree": {
          "1": "talent_1a_winbonus"
        },
        "team_id": 7,
        "total_money": 68,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82260,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 4,
        "zhugong": "h202",
        "zhugong_effect": "e000",
        "zhugong_model": "models/courier/huntling/huntling.vmdl"
      },
      "steam_id_1": {
        "biscuit": 0,
        "block_team": {},
        "buff": "is_hunter:4,is_goblin:2,is_mech:1,is_draenei:1,is_aqir:1,is_dwarf:1,is_elf:1,",
        "candy": 125,
        "candy_award": 0,
        "chess_hand": "chess_hw,chess_bane1,chess_wd,chess_dazzle,chess_sm,chess_kez,",
        "chess_lineup": "chess_br,chess_shredder1,chess_bh,chess_sniper,chess_wr,",
        "chess_synergies": {
          "1": "is_hunter"
        },
        "curr_rank": 5,
        "deaths": 0,
        "draw_round": 0,
        "duration": 615.566650390625,
        "hero_damage": 24,
        "hero_damaged": 16,
        "hero_level": 5,
        "hp": 84,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 15,
        "lose_round": 3,
        "max_lineup_value": 15,
        "max_lineup_value_lineup": "chess_br,chess_shredder1,chess_bh,chess_sniper,chess_wr,",
        "mmr_level": 17,
        "mvp_chess_damage": 1382.0006103515625,
        "mvp_chess_items": "item_jingmixie,item_yuanlingxidai,item_dianjinshou",
        "mvp_chess_name": "chess_shredder",
        "pandaman_getlist": {},
        "player_id": 4,
        "rank": 0,
        "relic_history": {},
        "round": 12,
        "show_buff": "is_priest:2,is_demon:1",
        "steam_id": "steam_id_1",
        "talent_tree": {
          "1": "talent_1a_winbonus"
        },
        "team_id": 8,
        "total_money": 60,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82262,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 4,
        "zhugong": "h002",
        "zhugong_effect": "e000",
        "zhugong_model": "models/props_gameplay/donkey_dire.vmdl"
      },
      "steam_id_0": {
        "biscuit": 0,
        "block_team": {},
        "buff": "is_mage:3,is_druid:1,is_mech:1,is_harpy:1,is_element:1,is_goblin:1,is_human:1,is_elf:1,",
        "candy": 0,
        "candy_award": 0,
        "chess_hand": "chess_aa,chess_cm,chess_tp,chess_cm,chess_sm,chess_sm,",
        "chess_lineup": "chess_aa,chess_lina,chess_tk1,chess_tp,chess_sm,",
        "chess_synergies": {
          "1": "is_mage"
        },
        "curr_rank": 3,
        "deaths": 0,
        "draw_round": 0,
        "duration": 617.6334228515625,
        "hero_damage": 15,
        "hero_damaged": 13,
        "hero_level": 5,
        "hp": 87,
        "is_author": 0,
        "is_vip": 0,
        "kills": 0,
        "lineup_value": 10,
        "lose_round": 2,
        "max_lineup_value": 10,
        "max_lineup_value_lineup": "chess_aa,chess_lina,chess_tk1,chess_tp,chess_sm,",
        "mmr_level": 12,
        "mvp_chess_damage": 907.309326171875,
        "mvp_chess_items": "item_wangzhezhijie",
        "mvp_chess_name": "chess_tk",
        "pandaman_getlist": {},
        "player_id": 3,
        "rank": 0,
        "relic": "item_egg",
        "relic_history": {
          "1": {
            "relic": "item_egg",
            "round": 11
          }
        },
        "round": 12,
        "show_buff": "is_priest:2,is_demon:1",
        "steam_id": "steam_id_0",
        "talent_tree": {
          "1": "talent_1a_winbonus"
        },
        "team_id": 12,
        "total_money": 72,
        "vip_info": {
          "biscuit_quest": "q029",
          "biscuit_quest_level": 2,
          "biscuit_ttl": 82296,
          "candy_added_limit": 0,
          "candy_added_limit_total": 10,
          "casino_count": 0,
          "casino_count_total": 5,
          "got_h318": 0,
          "got_top1_today": 0,
          "got_top3_today": 0,
          "is_vip": 0,
          "vip_vote_info": {}
        },
        "win_round": 5,
        "zhugong": "h001",
        "zhugong_effect": "e000",
        "zhugong_model": "models/props_gameplay/donkey.vmdl"
      }
    },
    "hehe": 96730
  }
}
```

#### `CustomNetTable_quest_table`

```json
{
  "show_quest": {
    "hehe": 8405.57421875,
    "quest": "q029",
    "status": {
      "10": -1,
      "11": -1,
      "12": -1,
      "13": -1,
      "6": -1,
      "7": -1,
      "8": -1,
      "9": -1
    }
  }
}
```

#### `CustomNetTable_ranking_top_table`

```json
{
  "ranking_top": {
    "hehe": 348,
    "leaderboard_info": {
      "leaderboard_chicken": {
        "1": {
          "chicken": 252,
          "is_vip": 0,
          "steam_id": "steam_id_8"
        },
        "10": {
          "chicken": 158,
          "is_vip": 0,
          "steam_id": "steam_id_9"
        },
        "11": {
          "chicken": 154,
          "is_vip": 0,
          "steam_id": "steam_id_10"
        },
        "12": {
          "chicken": 149,
          "is_vip": 0,
          "steam_id": "steam_id_11"
        },
        "13": {
          "chicken": 146,
          "is_vip": 0,
          "steam_id": "steam_id_12"
        },
        "14": {
          "chicken": 146,
          "is_vip": 0,
          "steam_id": "steam_id_13"
        },
        "15": {
          "chicken": 145,
          "is_vip": 1,
          "steam_id": "steam_id_14"
        },
        "16": {
          "chicken": 143,
          "is_vip": 1,
          "steam_id": "steam_id_15"
        },
        "17": {
          "chicken": 140,
          "is_vip": 0,
          "steam_id": "steam_id_16"
        },
        "18": {
          "chicken": 140,
          "is_vip": 0,
          "steam_id": "steam_id_17"
        },
        "19": {
          "chicken": 136,
          "is_vip": 0,
          "steam_id": "steam_id_18"
        },
        "2": {
          "chicken": 235,
          "is_vip": 0,
          "steam_id": "steam_id_19"
        },
        "20": {
          "chicken": 136,
          "is_vip": 1,
          "steam_id": "steam_id_20"
        },
        "21": {
          "chicken": 133,
          "is_vip": 0,
          "steam_id": "steam_id_21"
        },
        "22": {
          "chicken": 132,
          "is_vip": 0,
          "steam_id": "steam_id_22"
        },
        "23": {
          "chicken": 129,
          "is_vip": 0,
          "steam_id": "steam_id_23"
        },
        "24": {
          "chicken": 128,
          "is_vip": 0,
          "steam_id": "steam_id_24"
        },
        "25": {
          "chicken": 126,
          "is_vip": 0,
          "steam_id": "steam_id_25"
        },
        "26": {
          "chicken": 125,
          "is_vip": 0,
          "steam_id": "steam_id_26"
        },
        "27": {
          "chicken": 124,
          "is_vip": 0,
          "steam_id": "steam_id_27"
        },
        "28": {
          "chicken": 122,
          "is_vip": 0,
          "steam_id": "steam_id_28"
        },
        "29": {
          "chicken": 121,
          "is_vip": 0,
          "steam_id": "steam_id_29"
        },
        "3": {
          "chicken": 222,
          "is_vip": 0,
          "steam_id": "steam_id_30"
        },
        "30": {
          "chicken": 120,
          "is_vip": 0,
          "steam_id": "steam_id_31"
        },
        "31": {
          "chicken": 119,
          "is_vip": 0,
          "steam_id": "steam_id_32"
        },
        "32": {
          "chicken": 117,
          "is_vip": 0,
          "steam_id": "steam_id_33"
        },
        "33": {
          "chicken": 117,
          "is_vip": 0,
          "steam_id": "steam_id_34"
        },
        "34": {
          "chicken": 114,
          "is_vip": 0,
          "steam_id": "steam_id_35"
        },
        "35": {
          "chicken": 114,
          "is_vip": 0,
          "steam_id": "steam_id_36"
        },
        "36": {
          "chicken": 114,
          "is_vip": 0,
          "steam_id": "steam_id_37"
        },
        "37": {
          "chicken": 113,
          "is_vip": 1,
          "steam_id": "steam_id_38"
        },
        "38": {
          "chicken": 113,
          "is_vip": 0,
          "steam_id": "steam_id_39"
        },
        "39": {
          "chicken": 111,
          "is_vip": 0,
          "steam_id": "steam_id_40"
        },
        "4": {
          "chicken": 209,
          "is_vip": 0,
          "steam_id": "steam_id_41"
        },
        "40": {
          "chicken": 111,
          "is_vip": 0,
          "steam_id": "steam_id_42"
        },
        "41": {
          "chicken": 110,
          "is_vip": 0,
          "steam_id": "steam_id_43"
        },
        "42": {
          "chicken": 110,
          "is_vip": 0,
          "steam_id": "steam_id_44"
        },
        "43": {
          "chicken": 110,
          "is_vip": 0,
          "steam_id": "steam_id_45"
        },
        "44": {
          "chicken": 110,
          "is_vip": 0,
          "steam_id": "steam_id_46"
        },
        "45": {
          "chicken": 110,
          "is_vip": 0,
          "steam_id": "steam_id_47"
        },
        "46": {
          "chicken": 109,
          "is_vip": 0,
          "steam_id": "steam_id_48"
        },
        "47": {
          "chicken": 109,
          "is_vip": 0,
          "steam_id": "steam_id_49"
        },
        "48": {
          "chicken": 108,
          "is_vip": 0,
          "steam_id": "steam_id_50"
        },
        "49": {
          "chicken": 108,
          "is_vip": 0,
          "steam_id": "steam_id_51"
        },
        "5": {
          "chicken": 198,
          "is_vip": 0,
          "steam_id": "steam_id_52"
        },
        "50": {
          "chicken": 107,
          "is_vip": 1,
          "steam_id": "steam_id_53"
        },
        "51": {
          "chicken": 107,
          "is_vip": 1,
          "steam_id": "steam_id_54"
        },
        "6": {
          "chicken": 187,
          "is_vip": 0,
          "steam_id": "steam_id_55"
        },
        "7": {
          "chicken": 184,
          "is_vip": 0,
          "steam_id": "steam_id_56"
        },
        "8": {
          "chicken": 163,
          "is_vip": 0,
          "steam_id": "steam_id_57"
        },
        "9": {
          "chicken": 159,
          "is_vip": 0,
          "steam_id": "steam_id_58"
        }
      },
      "leaderboard_lineup_value": {
        "1": {
          "is_vip": 0,
          "lineup": "chess_fv,chess_gyro11,chess_pb11,chess_th11,chess_tech11,chess_ok11,chess_disruptor11,chess_bane,chess_thd11,chess_kael11,",
          "lineup_value": 363,
          "steam_id": "steam_id_59"
        },
        "10": {
          "is_vip": 0,
          "lineup": "chess_chen11,chess_medusa11,chess_kael11,chess_lion11,chess_pb11,chess_fv1,chess_snap11,chess_bane,chess_doom11,chess_am11,",
          "lineup_value": 313,
          "steam_id": "steam_id_60"
        },
        "11": {
          "is_vip": 0,
          "lineup": "chess_light11,chess_puck1,chess_sven11,chess_kunkka1,chess_ok1,chess_disruptor,chess_thd11,chess_zeus11,chess_tech11,chess_dk11,chess_lina1,chess_cm1,chess_viper1,",
          "lineup_value": 308,
          "steam_id": "steam_id_61"
        },
        "12": {
          "is_vip": 0,
          "lineup": "chess_mag11,chess_disruptor1,chess_lion11,chess_tech11,chess_gyro11,chess_fv11,chess_ok1,chess_doom11,chess_mk11,chess_th1,chess_bane1,chess_ga,",
          "lineup_value": 304,
          "steam_id": "steam_id_62"
        },
        "13": {
          "is_vip": 0,
          "lineup": "chess_pangolier11,chess_mag11,chess_qop1,chess_ember11,chess_ta11,chess_th1,chess_pa11,chess_sk11,chess_qop1,chess_morph1,chess_riki11,",
          "lineup_value": 303,
          "steam_id": "steam_id_63"
        },
        "14": {
          "is_vip": 0,
          "lineup": "chess_au11,chess_rm11,chess_qop11,chess_tb,chess_wl1,chess_disruptor11,chess_am11,chess_sven11,chess_lion1,chess_doom1,",
          "lineup_value": 303,
          "steam_id": "steam_id_64"
        },
        "15": {
          "is_vip": 0,
          "lineup": "chess_tech11,chess_pb1,chess_dw1,chess_meepo11,chess_disruptor11,chess_gyro11,chess_wl1,chess_aw11,chess_naga11,chess_qop11,",
          "lineup_value": 303,
          "steam_id": "steam_id_65"
        },
        "16": {
          "is_vip": 0,
          "lineup": "chess_doom1,chess_sven11,chess_rm,chess_snk1,chess_ok1,chess_aw11,chess_gyro11,chess_wl1,chess_tech11,chess_disruptor11,chess_ok1,",
          "lineup_value": 302,
          "steam_id": "steam_id_66"
        },
        "17": {
          "is_vip": 0,
          "lineup": "chess_chen11,chess_medusa11,chess_mk11,chess_phx11,chess_br11,chess_bane1,chess_lion11,chess_fv1,chess_snap11,chess_doom11,chess_qop,",
          "lineup_value": 302,
          "steam_id": "steam_id_67"
        },
        "18": {
          "is_vip": 0,
          "lineup": "chess_qop1,chess_shredder1,chess_tech11,chess_snap11,chess_sven11,chess_th1,chess_th,chess_ok11,chess_gyro11,chess_pb11,",
          "lineup_value": 302,
          "steam_id": "steam_id_68"
        },
        "19": {
          "is_vip": 0,
          "lineup": "chess_sven11,chess_aw,chess_rm1,chess_rm1,chess_doom11,chess_au11,chess_aw,chess_tech11,chess_kael11,chess_gyro11,",
          "lineup_value": 301,
          "steam_id": "steam_id_69"
        },
        "2": {
          "is_vip": 0,
          "lineup": "chess_aw,chess_pb11,chess_tech11,chess_rm11,chess_troll11,chess_snap11,chess_gyro11,chess_morph,chess_disruptor11,chess_ga1,chess_snk1,",
          "lineup_value": 343,
          "steam_id": "steam_id_70"
        },
        "20": {
          "is_vip": 0,
          "lineup": "chess_disruptor1,chess_rm11,chess_ok1,chess_snk11,chess_qop11,chess_ok1,chess_gyro11,chess_disruptor1,chess_wl1,chess_tech11,",
          "lineup_value": 300,
          "steam_id": "steam_id_71"
        },
        "21": {
          "is_vip": 0,
          "lineup": "chess_phx1,chess_mk11,chess_chen1,chess_doom11,chess_am11,chess_om1,chess_snap11,chess_sven11,chess_chen1,chess_th11,chess_bane1,chess_fv11,",
          "lineup_value": 300,
          "steam_id": "steam_id_72"
        },
        "22": {
          "is_vip": 0,
          "lineup": "chess_phx11,chess_kunkka11,chess_troll11,chess_sven1,chess_rm,chess_chen11,chess_am11,chess_th1,chess_rm1,chess_ok11,chess_rm1,",
          "lineup_value": 299,
          "steam_id": "steam_id_73"
        },
        "23": {
          "is_vip": 0,
          "lineup": "chess_sven1,chess_au1,chess_wl11,chess_aw11,chess_gyro11,chess_au1,chess_ok11,chess_sven1,chess_tech11,chess_ga1,",
          "lineup_value": 297,
          "steam_id": "steam_id_24"
        },
        "24": {
          "is_vip": 1,
          "lineup": "chess_phx11,chess_thd1,chess_snap11,chess_light11,chess_viper1,chess_kunkka11,chess_zeus11,chess_dk11,chess_thd1,chess_ok1,chess_disruptor1,",
          "lineup_value": 294,
          "steam_id": "steam_id_74"
        },
        "25": {
          "is_vip": 0,
          "lineup": "chess_cm1,chess_light11,chess_ok1,chess_kunkka11,chess_dk11,chess_th1,chess_zeus1,chess_phx1,chess_ok1,chess_kael1,chess_lina1,chess_tech11,chess_wl11,",
          "lineup_value": 294,
          "steam_id": "steam_id_75"
        },
        "26": {
          "is_vip": 0,
          "lineup": "chess_ta,chess_wl1,chess_th1,chess_th,chess_storm11,chess_morph11,chess_kael11,chess_ember11,chess_th1,chess_pb11,chess_ta1,chess_sven1,",
          "lineup_value": 292,
          "steam_id": "steam_id_76"
        },
        "27": {
          "is_vip": 0,
          "lineup": "chess_sven1,chess_wl1,chess_th11,chess_kael1,chess_phx11,chess_rm11,chess_sven1,chess_tech11,chess_wl1,chess_disruptor11,",
          "lineup_value": 291,
          "steam_id": "steam_id_77"
        },
        "28": {
          "is_vip": 0,
          "lineup": "chess_ga1,chess_doom11,chess_morph11,chess_ok1,chess_sf11,chess_sven11,chess_ok1,chess_am11,chess_rm11,chess_wl1,",
          "lineup_value": 291,
          "steam_id": "steam_id_49"
        },
        "29": {
          "is_vip": 0,
          "lineup": "chess_chen11,chess_disruptor1,chess_th1,chess_cm1,chess_ok11,chess_kunkka1,chess_disruptor1,chess_phx11,chess_light11,chess_snap11,chess_lina1,chess_dk11,",
          "lineup_value": 291,
          "steam_id": "steam_id_78"
        },
        "3": {
          "is_vip": 0,
          "lineup": "chess_rm11,chess_meepo1,chess_troll11,chess_aw11,chess_riki1,chess_disruptor11,chess_bane,chess_sven11,chess_tech11,chess_ok11,",
          "lineup_value": 331,
          "steam_id": "steam_id_79"
        },
        "30": {
          "is_vip": 0,
          "lineup": "chess_qop11,chess_pb11,chess_dk11,chess_aw1,chess_tech1,chess_kunkka1,chess_wl11,chess_aw,chess_rm11,chess_ta,chess_aw1,chess_ts11,chess_kunkka1,",
          "lineup_value": 290,
          "steam_id": "steam_id_80"
        },
        "31": {
          "is_vip": 0,
          "lineup": "chess_tech,chess_troll11,chess_bane1,chess_fv,chess_morph11,chess_chen11,chess_br11,chess_lion11,chess_snap11,chess_sven11,",
          "lineup_value": 289,
          "steam_id": "steam_id_27"
        },
        "32": {
          "is_vip": 0,
          "lineup": "chess_pb11,chess_lion1,chess_sven11,chess_ta11,chess_tech11,chess_fv1,chess_gyro11,chess_bane,chess_th11,",
          "lineup_value": 289,
          "steam_id": "steam_id_81"
        },
        "33": {
          "is_vip": 1,
          "lineup": "chess_rm11,chess_meepo,chess_ga11,chess_snap11,chess_wl1,chess_aw1,chess_gyro11,chess_disruptor11,chess_tech11,chess_wl,",
          "lineup_value": 289,
          "steam_id": "steam_id_82"
        },
        "34": {
          "is_vip": 0,
          "lineup": "chess_sb1,chess_pangolier11,chess_pa11,chess_kez11,chess_ember11,chess_sk11,chess_mag11,chess_disruptor1,chess_riki11,chess_ta11,",
          "lineup_value": 288,
          "steam_id": "steam_id_83"
        },
        "35": {
          "is_vip": 0,
          "lineup": "chess_dk1,chess_pb1,chess_snap11,chess_phx1,chess_cm1,chess_ok11,chess_qop1,chess_lc,chess_tech11,chess_th1,chess_light11,chess_kael1,chess_kunkka11,",
          "lineup_value": 288,
          "steam_id": "steam_id_84"
        },
        "36": {
          "is_vip": 0,
          "lineup": "chess_ember11,chess_sk1,chess_slark11,chess_pangolier11,chess_ts11,chess_mag11,chess_fv1,chess_pa11,chess_morph11,chess_ta11,",
          "lineup_value": 287,
          "steam_id": "steam_id_85"
        },
        "37": {
          "is_vip": 0,
          "lineup": "chess_am11,chess_gyro11,chess_chen11,chess_ta11,chess_wl1,chess_rm1,chess_sniper,chess_ga11,chess_pb11,chess_doom1,",
          "lineup_value": 287,
          "steam_id": "steam_id_86"
        },
        "38": {
          "is_vip": 0,
          "lineup": "chess_thd11,chess_kunkka11,chess_ok,chess_dk11,chess_lion11,chess_puck1,chess_wl11,chess_viper1,chess_disruptor1,chess_cm1,chess_naga1,chess_lina1,chess_light11,",
          "lineup_value": 287,
          "steam_id": "steam_id_87"
        },
        "39": {
          "is_vip": 0,
          "lineup": "chess_gyro11,chess_morph11,chess_tk1,chess_ta11,chess_pa,chess_rm11,chess_clock1,chess_qop11,chess_shredder1,chess_tech11,",
          "lineup_value": 286,
          "steam_id": "steam_id_88"
        },
        "4": {
          "is_vip": 0,
          "lineup": "chess_pb1,chess_kael11,chess_ok1,chess_kunkka11,chess_pb1,chess_disruptor1,chess_phx11,chess_lina1,chess_dk11,chess_lc11,chess_light11,chess_rubick,chess_zeus11,",
          "lineup_value": 330,
          "steam_id": "steam_id_89"
        },
        "40": {
          "is_vip": 0,
          "lineup": "chess_tech1,chess_am11,chess_mk11,chess_snap11,chess_doom11,chess_fv1,chess_bane1,chess_chen11,chess_qop11,chess_phx11,",
          "lineup_value": 285,
          "steam_id": "steam_id_90"
        },
        "41": {
          "is_vip": 0,
          "lineup": "chess_zeus1,chess_ok1,chess_sven11,chess_kunkka1,chess_chen11,chess_au1,chess_morph11,chess_au1,chess_dk1,chess_disruptor1,chess_qop11,chess_wl1,",
          "lineup_value": 285,
          "steam_id": "steam_id_91"
        },
        "42": {
          "is_vip": 0,
          "lineup": "chess_kael11,chess_tech11,chess_zeus11,chess_puck1,chess_ts11,chess_dk11,chess_light1,chess_mag1,chess_viper,chess_cm,chess_qop1,chess_thd11,",
          "lineup_value": 285,
          "steam_id": "steam_id_92"
        },
        "43": {
          "is_vip": 0,
          "lineup": "chess_tk1,chess_clock1,chess_ok11,chess_rm11,chess_ga1,chess_snap11,chess_tech11,chess_shredder1,chess_wl11,chess_gyro11,",
          "lineup_value": 285,
          "steam_id": "steam_id_93"
        },
        "44": {
          "is_vip": 0,
          "lineup": "chess_fv,chess_qop1,chess_tech11,chess_bane1,chess_gyro11,chess_snap11,chess_th11,chess_kael11,chess_phx1,chess_doom11,",
          "lineup_value": 284,
          "steam_id": "steam_id_94"
        },
        "45": {
          "is_vip": 0,
          "lineup": "chess_gyro11,chess_wl11,chess_meepo,chess_sven1,chess_tech11,chess_disruptor1,chess_disruptor1,chess_spe1,chess_am11,chess_doom11,chess_aw1,",
          "lineup_value": 284,
          "steam_id": "steam_id_95"
        },
        "46": {
          "is_vip": 0,
          "lineup": "chess_thd1,chess_snap1,chess_wl11,chess_zeus1,chess_ok1,chess_kunkka11,chess_thd1,chess_dk11,chess_rm11,chess_light11,chess_lina,chess_chen11,chess_cm,",
          "lineup_value": 284,
          "steam_id": "steam_id_96"
        },
        "47": {
          "is_vip": 0,
          "lineup": "chess_phx11,chess_cm,chess_lina,chess_storm1,chess_disruptor1,chess_tech,chess_kael11,chess_ok1,chess_kunkka11,chess_light11,chess_dk11,chess_zeus11,",
          "lineup_value": 284,
          "steam_id": "steam_id_97"
        },
        "48": {
          "is_vip": 0,
          "lineup": "chess_qop,chess_morph1,chess_qop1,chess_wl1,chess_kunkka1,chess_snap11,chess_rm1,chess_disruptor11,chess_lina1,chess_gyro1,chess_cm1,chess_dk11,chess_ok1,chess_light11,chess_morph1,",
          "lineup_value": 284,
          "steam_id": "steam_id_98"
        },
        "49": {
          "is_vip": 0,
          "lineup": "chess_am11,chess_qop11,chess_au,chess_chen11,chess_troll11,chess_th1,chess_rm1,chess_doom11,chess_snap11,chess_sven1,",
          "lineup_value": 284,
          "steam_id": "steam_id_99"
        },
        "5": {
          "is_vip": 0,
          "lineup": "chess_kunkka1,chess_void11,chess_kunkka1,chess_ok1,chess_pb1,chess_snap11,chess_marci11,chess_ok1,chess_mk11,chess_light1,chess_lc11,chess_brew11,chess_dk11,chess_kael,chess_lyc11,",
          "lineup_value": 320,
          "steam_id": "steam_id_100"
        },
        "50": {
          "is_vip": 0,
          "lineup": "chess_tech11,chess_morph1,chess_kael1,chess_mag1,chess_mag1,chess_qop11,chess_ts11,chess_morph1,chess_kael1,chess_ok11,chess_th11,",
          "lineup_value": 284,
          "steam_id": "steam_id_101"
        },
        "51": {
          "is_vip": 0,
          "lineup": "chess_ok11,chess_sven1,chess_snk1,chess_tk,chess_tech11,chess_th11,chess_wl11,chess_rm1,chess_gyro11,chess_ga1,",
          "lineup_value": 283,
          "steam_id": "steam_id_102"
        },
        "6": {
          "is_vip": 0,
          "lineup": "chess_medusa11,chess_bane,chess_sven11,chess_snap11,chess_phx1,chess_kael11,chess_phx1,chess_troll11,chess_fv1,chess_qop11,chess_chen11,",
          "lineup_value": 319,
          "steam_id": "steam_id_103"
        },
        "7": {
          "is_vip": 0,
          "lineup": "chess_ok11,chess_gyro11,chess_snk11,chess_aw1,chess_ga1,chess_kael11,chess_lion1,chess_tech11,chess_naga1,chess_au11,",
          "lineup_value": 318,
          "steam_id": "steam_id_104"
        },
        "8": {
          "is_vip": 0,
          "lineup": "chess_kunkka11,chess_aw1,chess_ok11,chess_zeus11,chess_wl1,chess_naga,chess_th11,chess_dk1,chess_phx1,chess_rm11,chess_morph11,",
          "lineup_value": 318,
          "steam_id": "steam_id_105"
        },
        "9": {
          "is_vip": 0,
          "lineup": "chess_thd,chess_cm11,chess_lina11,chess_ok1,chess_puck11,chess_thd1,chess_kunkka11,chess_phx11,chess_light11,chess_disruptor11,chess_pb11,chess_dk11,",
          "lineup_value": 314,
          "steam_id": "steam_id_106"
        }
      },
      "leaderboard_mvp_chess": {
        "1": {
          "damage": 95983,
          "is_vip": 0,
          "item": "item_yonghengzhipan,item_aoshuxie,item_xueji,item_gulonghaojiao,item_meiken,item_jurenzhijie",
          "name": "chess_sven11",
          "steam_id": "steam_id_107"
        },
        "10": {
          "damage": 76072,
          "is_vip": 0,
          "item": "item_weishijingjia,item_bkb,item_zhusidoupeng,item_linkenfaqiu,item_dongchayandou,item_yuanlingxidai",
          "name": "chess_sven11",
          "steam_id": "steam_id_108"
        },
        "11": {
          "damage": 75506,
          "is_vip": 0,
          "item": "item_sanchaji,item_dapao,item_shenjingdun,item_wangyuanjing,item_dadianchui,item_qishijian",
          "name": "chess_luna11",
          "steam_id": "steam_id_109"
        },
        "12": {
          "damage": 75207,
          "is_vip": 0,
          "item": "item_tiaodao,item_jipin,item_xueji,item_anmie,item_qinwangduandao,item_bkb",
          "name": "chess_gyro11",
          "steam_id": "steam_id_110"
        },
        "13": {
          "damage": 75125,
          "is_vip": 0,
          "item": "item_sanchaji,item_dadianchui,item_fengkuangmianju,item_shuijingjian,item_shenjingdun,item_jurenzhijie",
          "name": "chess_luna11",
          "steam_id": "steam_id_111"
        },
        "14": {
          "damage": 75024,
          "is_vip": 0,
          "item": "item_sanchaji,item_dadianchui,item_weishijingjia,item_sadan,item_yuanlingxidai",
          "name": "chess_morph1",
          "steam_id": "steam_id_112"
        },
        "15": {
          "damage": 74814,
          "is_vip": 0,
          "item": "item_weishijingjia,item_tiaodao,item_shirenmozhimao,item_dapao,item_sadan,item_wuzhixiaomao",
          "name": "chess_troll11",
          "steam_id": "steam_id_113"
        },
        "16": {
          "damage": 74410,
          "is_vip": 0,
          "item": "item_huanyingfu,item_shirenmozhimao,item_shenjingdun,item_huiyao,item_jingubang,item_zhusidoupeng",
          "name": "chess_gyro1",
          "steam_id": "steam_id_114"
        },
        "17": {
          "damage": 74342,
          "is_vip": 0,
          "item": "item_qishijian,item_shuaxinqiu,item_kuangzhanfu,item_shuijingjian,item_xuanwo,item_linkenfaqiu",
          "name": "chess_ember1",
          "steam_id": "steam_id_115"
        },
        "18": {
          "damage": 74214,
          "is_vip": 0,
          "item": "item_shirenmozhimao,item_huanyingfu,item_bkb,item_huiyao,item_zhusidoupeng,item_shengjian",
          "name": "chess_gyro1",
          "steam_id": "steam_id_116"
        },
        "19": {
          "damage": 74015,
          "is_vip": 0,
          "item": "item_dapao,item_qiangxi,item_bkb,item_jingubang,item_sadan,item_fulingsuo",
          "name": "chess_luna11",
          "steam_id": "steam_id_117"
        },
        "2": {
          "damage": 84354,
          "is_vip": 0,
          "item": "item_qishijian,item_shirenmozhimao,item_jurenzhijie,item_bingyan,item_yuanlingxidai,item_hudie",
          "name": "chess_troll1",
          "steam_id": "steam_id_118"
        },
        "20": {
          "damage": 73693,
          "is_vip": 0,
          "item": "item_shuaxinqiu,item_xuejingshi,item_hongzhang,item_konglingguajian,item_yuanlifazhang,item_bkb",
          "name": "chess_storm11",
          "steam_id": "steam_id_119"
        },
        "21": {
          "damage": 73475,
          "is_vip": 0,
          "item": "item_bkb,item_qishijian,item_qiangxi,item_dapao,item_yonghengzhipan,item_sadan",
          "name": "chess_luna11",
          "steam_id": "steam_id_120"
        },
        "22": {
          "damage": 73429,
          "is_vip": 0,
          "item": "item_bingyan,item_linkenfaqiu,item_fulingsuo,item_weishijingjia,item_hudie,item_qishijian",
          "name": "chess_gyro11",
          "steam_id": "steam_id_121"
        },
        "23": {
          "damage": 73178,
          "is_vip": 0,
          "item": "item_buxiuzhishouhu,item_yangdao,item_fulingsuo,item_xuejingshi,item_huiguang",
          "name": "chess_storm11",
          "steam_id": "steam_id_122"
        },
        "24": {
          "damage": 73172,
          "is_vip": 0,
          "item": "item_tiaodao,item_huanyingfu,item_dapao,item_yinyuezhijing,item_dadianchui,item_sadan",
          "name": "chess_gyro11",
          "steam_id": "steam_id_123"
        },
        "25": {
          "damage": 72119,
          "is_vip": 0,
          "item": "item_hudie,item_yonghengzhipan,item_dadianchui,item_rengu,item_bkb,item_suiluchui",
          "name": "chess_sven1",
          "steam_id": "steam_id_124"
        },
        "26": {
          "damage": 71981,
          "is_vip": 0,
          "item": "item_shirenmozhimao,item_hudie,item_fulingsuo,item_bingyan,item_qishijian,item_tiaodao",
          "name": "chess_troll11",
          "steam_id": "steam_id_125"
        },
        "27": {
          "damage": 71928,
          "is_vip": 0,
          "item": "item_fulingsuo,item_shenjingdun,item_linkenfaqiu,item_bkb,item_rengu,item_aoshuxie",
          "name": "chess_sven1",
          "steam_id": "steam_id_126"
        },
        "28": {
          "damage": 71576,
          "is_vip": 0,
          "item": "item_qishijian,item_shenjingdun,item_huiyao,item_linkenfaqiu,item_huanyingfu,item_dongchayandou",
          "name": "chess_spe11",
          "steam_id": "steam_id_127"
        },
        "29": {
          "damage": 71182,
          "is_vip": 0,
          "item": "item_bingyan,item_yuanlingxidai,item_jinghunzhiren,item_jurenzhijie,item_shuijingjian,item_haojie",
          "name": "chess_gyro11",
          "steam_id": "steam_id_128"
        },
        "3": {
          "damage": 83582,
          "is_vip": 0,
          "item": "item_kuangzhanfu,item_dapao,item_qishijian,item_fushizhiqiu,item_xiwa,item_jingmixie",
          "name": "chess_ember11",
          "steam_id": "steam_id_129"
        },
        "30": {
          "damage": 71045,
          "is_vip": 0,
          "item": "item_sanchaji,item_shirenmozhimao,item_bkb,item_bingyan,item_anmie,item_suiluchui",
          "name": "chess_gyro11",
          "steam_id": "steam_id_130"
        },
        "31": {
          "damage": 70512,
          "is_vip": 0,
          "item": "item_huanyingfu,item_fulingsuo,item_yuanlingxidai,item_shuijingjian,item_bkb,item_cantie",
          "name": "chess_gyro11",
          "steam_id": "steam_id_131"
        },
        "32": {
          "damage": 70379,
          "is_vip": 0,
          "item": "item_shirenmozhimao,item_huiyao,item_tiaodao,item_shenjingdun,item_jipin,item_yongqizhiguang",
          "name": "chess_troll11",
          "steam_id": "steam_id_132"
        },
        "33": {
          "damage": 70200,
          "is_vip": 1,
          "item": "item_sanchaji,item_dadianchui,item_jinghunzhiren,item_jipin,item_sadan,item_wangzhezhijie",
          "name": "chess_ta1",
          "steam_id": "steam_id_133"
        },
        "34": {
          "damage": 70107,
          "is_vip": 0,
          "item": "item_qishijian,item_huanyingfu,item_xiwa,item_hudie,item_tiaodao",
          "name": "chess_sven11",
          "steam_id": "steam_id_134"
        },
        "35": {
          "damage": 70047,
          "is_vip": 0,
          "item": "item_dayunchui,item_xueji,item_huanyingfu,item_buxiuzhishouhu,item_hudie,item_qishijian",
          "name": "chess_troll1",
          "steam_id": "steam_id_135"
        },
        "36": {
          "damage": 70041,
          "is_vip": 0,
          "item": "item_shirenmozhimao,item_huiyao,item_yuanlingxidai,item_hudie,item_wuzhixiaomao",
          "name": "chess_troll1",
          "steam_id": "steam_id_136"
        },
        "37": {
          "damage": 69665,
          "is_vip": 0,
          "item": "item_huanyingfu,item_haojie,item_shirenmozhimao,item_hudie,item_sanchaji,item_tiaodao",
          "name": "chess_gyro1",
          "steam_id": "steam_id_137"
        },
        "38": {
          "damage": 69473,
          "is_vip": 0,
          "item": "item_huanyingfu,item_yonghengzhipan,item_weishijingjia,item_tiaozhantoujin,item_haojie",
          "name": "chess_troll11",
          "steam_id": "steam_id_138"
        },
        "39": {
          "damage": 69340,
          "is_vip": 0,
          "item": "item_kuangzhanfu,item_gulonghaojiao,item_buxiuzhishouhu,item_linkenfaqiu,item_hudie,item_bkb",
          "name": "chess_ember11",
          "steam_id": "steam_id_139"
        },
        "4": {
          "damage": 83289,
          "is_vip": 0,
          "item": "item_yinyuezhijing,item_qishijian,item_hudie,item_dadianchui,item_bkb",
          "name": "chess_morph11",
          "steam_id": "steam_id_140"
        },
        "40": {
          "damage": 69273,
          "is_vip": 1,
          "item": "item_xuejingshi,item_hongzhang,item_moping,item_aoshuxie",
          "name": "chess_storm11",
          "steam_id": "steam_id_141"
        },
        "41": {
          "damage": 69175,
          "is_vip": 0,
          "item": "item_weishijingjia,item_bkb,item_qishijian,item_jingubang,item_yuanlingxidai,item_shengjian",
          "name": "chess_morph11",
          "steam_id": "steam_id_142"
        },
        "42": {
          "damage": 69083,
          "is_vip": 0,
          "item": "item_shirenmozhimao,item_jipin,item_yinyuezhijing,item_sadan",
          "name": "chess_troll1",
          "steam_id": "steam_id_143"
        },
        "43": {
          "damage": 68975,
          "is_vip": 0,
          "item": "item_tiaodao,item_haojie,item_huanyingfu,item_dadianchui,item_qishijian,item_yuanlingxidai",
          "name": "chess_gyro11",
          "steam_id": "steam_id_144"
        },
        "44": {
          "damage": 68875,
          "is_vip": 0,
          "item": "item_fulingsuo,item_xiwa,item_dongchayandou,item_shenjingdun,item_sanchaji,item_dadianchui",
          "name": "chess_sven1",
          "steam_id": "steam_id_145"
        },
        "45": {
          "damage": 68667,
          "is_vip": 0,
          "item": "item_kuangzhanfu,item_bingyan,item_fulingsuo,item_shenjingdun",
          "name": "chess_pangolier11",
          "steam_id": "steam_id_146"
        },
        "46": {
          "damage": 68549,
          "is_vip": 0,
          "item": "item_sanchaji,item_dadianchui,item_bingyan,item_anmie,item_hudie,item_dapao",
          "name": "chess_morph1",
          "steam_id": "steam_id_147"
        },
        "47": {
          "damage": 68474,
          "is_vip": 0,
          "item": "item_shirenmozhimao,item_qishijian,item_huanyingfu",
          "name": "chess_gyro11",
          "steam_id": "steam_id_148"
        },
        "48": {
          "damage": 68089,
          "is_vip": 0,
          "item": "item_dadianchui,item_dongchayandou,item_huanyingfu,item_shirenmozhimao,item_qishijian,item_xuanmingdunpai",
          "name": "chess_troll11",
          "steam_id": "steam_id_149"
        },
        "49": {
          "damage": 67868,
          "is_vip": 0,
          "item": "item_shirenmozhimao,item_bkb,item_shenjingdun,item_jingmixie,item_hudie",
          "name": "chess_sven1",
          "steam_id": "steam_id_150"
        },
        "5": {
          "damage": 82665,
          "is_vip": 0,
          "item": "item_bingyan,item_anmie,item_kuangzhanfu,item_qiangxi,item_shenjingdun",
          "name": "chess_ember11",
          "steam_id": "steam_id_151"
        },
        "50": {
          "damage": 67680,
          "is_vip": 0,
          "item": "item_changdun,item_jingmixie,item_shenjingdun,item_huiyao,item_huiyao,item_moping",
          "name": "chess_shredder11",
          "steam_id": "steam_id_152"
        },
        "51": {
          "damage": 67587,
          "is_vip": 0,
          "item": "item_fengkuangmianju,item_suiluchui,item_kuangzhanfu,item_jingubang,item_jingmixie,item_jinghunzhiren",
          "name": "chess_pa11",
          "steam_id": "steam_id_153"
        },
        "6": {
          "damage": 81402,
          "is_vip": 0,
          "item": "item_huanyingfu,item_jinghunzhiren,item_zhusidoupeng,item_fulingsuo,item_sanchaji,item_jingubang",
          "name": "chess_gyro11",
          "steam_id": "steam_id_154"
        },
        "7": {
          "damage": 77824,
          "is_vip": 0,
          "item": "item_huiyao,item_weishijingjia,item_xingyunguazhui,item_dongchayandou,item_dadianchui",
          "name": "chess_largo11",
          "steam_id": "steam_id_155"
        },
        "8": {
          "damage": 77518,
          "is_vip": 0,
          "item": "item_yonghengzhipan,item_hudie,item_tiaodao,item_dadianchui,item_bkb,item_bingyan",
          "name": "chess_troll11",
          "steam_id": "steam_id_156"
        },
        "9": {
          "damage": 76883,
          "is_vip": 0,
          "item": "item_shirenmozhimao,item_dongchayandou,item_shenjingdun,item_jingubang,item_aoshuxie",
          "name": "chess_sven11",
          "steam_id": "steam_id_157"
        }
      },
      "leaderboard_pandaman_fish": {
        "1": {
          "chess_list": "chess_storm_7,chess_earth_10,chess_storm_14,chess_earth_16,chess_brew_16,chess_ember_17,chess_storm_18,chess_storm_19,chess_earth_19,chess_ember_21,chess_storm_24,chess_brew_26,chess_storm_27,chess_ember_28,chess_earth_29,chess_brew_29,chess_storm_30,chess_brew_31,chess_brew_32,chess_storm_34,chess_void_35,chess_earth_35,chess_storm_35,chess_storm_35,chess_ember_36,chess_earth_37,chess_ember_39,chess_brew_39,chess_brew_39,chess_storm_41,chess_earth_42,chess_earth_43,chess_brew_44,chess_earth_44,chess_void_46,chess_ember_47,chess_ember_48,chess_earth_50,chess_brew_50,chess_brew_51,chess_ember_51,chess_storm_52,chess_earth_52,chess_ember_53,chess_earth_53,chess_brew_54,chess_brew_54,chess_storm_54,chess_ember_55,chess_brew_55,chess_ember_57,chess_brew_58,chess_ember_58,chess_earth_58,chess_ember_58,chess_brew_59,chess_storm_59,chess_brew_60,chess_ember_60,chess_storm_61,chess_earth_61,chess_storm_62,chess_storm_63,chess_storm_64,chess_earth_65,chess_earth_65,chess_storm_65,chess_ember_66,chess_ember_67,chess_ember_68,chess_brew_68,chess_void_69,chess_void_71,chess_brew_72,chess_brew_73,chess_earth_73,chess_earth_73,chess_brew_75,chess_brew_76,chess_storm_76,chess_void_77,chess_storm_77,chess_ember_77,chess_void_78,chess_earth_79,chess_ember_79,chess_storm_79,chess_void_80,chess_brew_80,chess_storm_82,chess_storm_83,chess_brew_84,chess_brew_84,chess_ember_84,chess_ember_85,chess_earth_85,chess_storm_86,chess_storm_86,chess_storm_87,chess_void_87,chess_storm_87,chess_brew_87",
          "count": 1020333,
          "is_vip": 1,
          "steam_id": "steam_id_158"
        },
        "10": {
          "chess_list": "chess_storm_5,chess_brew_8,chess_ember_9,chess_brew_14,chess_ember_14,chess_ember_15,chess_ember_16,chess_void_18,chess_brew_18,chess_storm_18,chess_void_19,chess_earth_20,chess_earth_22,chess_ember_22,chess_ember_22,chess_brew_22,chess_void_23,chess_earth_23,chess_ember_24,chess_ember_25,chess_brew_26,chess_storm_28,chess_brew_29,chess_brew_30,chess_brew_31,chess_storm_31,chess_storm_32,chess_storm_35,chess_brew_36,chess_storm_36,chess_ember_36,chess_earth_37,chess_ember_37,chess_brew_37,chess_earth_38,chess_earth_38,chess_ember_40,chess_storm_41,chess_ember_41,chess_storm_43,chess_earth_43,chess_void_43,chess_earth_44,chess_earth_44,chess_brew_44,chess_ember_44,chess_brew_45,chess_brew_47,chess_void_47,chess_brew_48,chess_brew_48,chess_ember_49,chess_earth_49,chess_void_50,chess_ember_50,chess_ember_52,chess_brew_52,chess_earth_52,chess_storm_52,chess_earth_53,chess_void_53,chess_storm_54,chess_storm_54,chess_brew_54",
          "count": 640205,
          "is_vip": 1,
          "steam_id": "steam_id_159"
        },
        "11": {
          "chess_list": "chess_void_13,chess_void_14,chess_brew_15,chess_void_17,chess_void_17,chess_void_19,chess_brew_20,chess_brew_23,chess_void_24,chess_void_24,chess_brew_25,chess_brew_26,chess_brew_28,chess_void_28,chess_void_31,chess_brew_33,chess_brew_33,chess_ember_34,chess_brew_34,chess_brew_36,chess_brew_36,chess_ember_37,chess_brew_41,chess_brew_42,chess_void_42,chess_brew_42,chess_earth_43,chess_ember_43,chess_void_43,chess_huskar_44,chess_ember_44,chess_ss_46,chess_brew_46,chess_brew_47,chess_earth_47,chess_ember_48,chess_brew_48,chess_ember_49,chess_ember_49,chess_brew_49,chess_brew_50,chess_ember_50,chess_earth_52,chess_void_53,chess_void_54,chess_brew_54,chess_brew_55,chess_void_55,chess_ember_57,chess_void_58,chess_ember_58,chess_brew_60,chess_brew_60,chess_brew_60,chess_ember_60,chess_ember_60,chess_ember_61,chess_ember_61,chess_void_62,chess_ember_63,chess_void_63,chess_brew_63",
          "count": 620169,
          "is_vip": 0,
          "steam_id": "steam_id_160"
        },
        "12": {
          "chess_list": "chess_void_6,chess_brew_7,chess_brew_9,chess_brew_13,chess_void_13,chess_brew_14,chess_void_14,chess_void_17,chess_earth_18,chess_void_18,chess_brew_18,chess_earth_20,chess_void_20,chess_brew_22,chess_brew_22,chess_void_22,chess_earth_23,chess_void_24,chess_void_24,chess_brew_26,chess_storm_28,chess_earth_28,chess_brew_29,chess_earth_30,chess_storm_32,chess_earth_32,chess_storm_33,chess_void_33,chess_earth_34,chess_brew_34,chess_void_34,chess_brew_36,chess_void_36,chess_storm_37,chess_earth_37,chess_void_38,chess_earth_39,chess_void_40,chess_void_42,chess_earth_42,chess_brew_43,chess_ember_44,chess_earth_44,chess_storm_44,chess_storm_44,chess_ember_45,chess_storm_46,chess_ember_46,chess_void_47,chess_brew_47,chess_storm_47,chess_brew_50,chess_storm_50,chess_ember_51,chess_earth_53,chess_brew_54,chess_earth_54,chess_ember_54,chess_void_54,chess_void_55,chess_ember_55",
          "count": 610199,
          "is_vip": 0,
          "steam_id": "steam_id_161"
        },
        "13": {
          "chess_list": "chess_earth_15,chess_brew_15,chess_earth_16,chess_earth_16,chess_ember_17,chess_brew_17,chess_void_18,chess_earth_19,chess_earth_22,chess_earth_23,chess_ember_23,chess_void_24,chess_earth_24,chess_void_25,chess_earth_25,chess_brew_27,chess_earth_28,chess_storm_29,chess_brew_30,chess_void_31,chess_earth_31,chess_brew_32,chess_brew_33,chess_brew_35,chess_earth_37,chess_earth_41,chess_storm_41,chess_earth_44,chess_storm_44,chess_storm_45,chess_earth_47,chess_storm_47,chess_storm_48,chess_earth_48,chess_storm_49,chess_storm_49,chess_storm_52,chess_brew_53,chess_void_58,chess_void_60,chess_brew_60,chess_earth_60,chess_ember_61,chess_ember_62,chess_ember_62,chess_storm_62,chess_storm_63,chess_storm_64,chess_storm_65,chess_ember_66,chess_storm_66,chess_earth_67,chess_ember_67,chess_earth_69,chess_void_70,chess_void_70,chess_brew_71,chess_storm_73,chess_void_73",
          "count": 590206,
          "is_vip": 0,
          "steam_id": "steam_id_162"
        },
        "14": {
          "chess_list": "chess_void_10,chess_brew_14,chess_void_16,chess_brew_16,chess_storm_17,chess_void_17,chess_brew_17,chess_brew_17,chess_brew_18,chess_storm_19,chess_storm_20,chess_ember_23,chess_storm_23,chess_storm_25,chess_storm_25,chess_storm_26,chess_ember_27,chess_void_27,chess_storm_28,chess_brew_28,chess_brew_29,chess_brew_30,chess_void_31,chess_brew_33,chess_void_33,chess_storm_33,chess_void_34,chess_storm_34,chess_brew_35,chess_brew_35,chess_brew_37,chess_void_37,chess_earth_38,chess_void_40,chess_au_41,chess_storm_41,chess_brew_41,chess_storm_43,chess_brew_43,chess_brew_44,chess_earth_45,chess_void_46,chess_ember_48,chess_void_48,chess_brew_50,chess_void_50,chess_ember_51,chess_storm_51,chess_ember_52,chess_void_52,chess_void_54,chess_storm_56,chess_ember_57,chess_storm_57,chess_ember_57,chess_ember_58,chess_storm_58,chess_ember_58,chess_storm_60",
          "count": 590189,
          "is_vip": 0,
          "steam_id": "steam_id_163"
        },
        "15": {
          "chess_list": "chess_ember_2,chess_void_4,chess_brew_4,chess_storm_5,chess_earth_6,chess_void_7,chess_brew_12,chess_ember_13,chess_brew_13,chess_earth_14,chess_earth_15,chess_storm_16,chess_ember_16,chess_earth_17,chess_ember_18,chess_ember_19,chess_void_19,chess_void_19,chess_ember_21,chess_earth_22,chess_ember_23,chess_brew_25,chess_ember_26,chess_earth_26,chess_ember_26,chess_void_27,chess_void_27,chess_ember_28,chess_earth_30,chess_void_30,chess_ember_30,chess_ember_31,chess_void_31,chess_ember_33,chess_ember_33,chess_void_33,chess_phx_34,chess_earth_34,chess_void_34,chess_ember_35,chess_ember_36,chess_ember_37,chess_void_38,chess_ember_40,chess_ember_42,chess_ember_43,chess_earth_45,chess_earth_45,chess_earth_46,chess_ember_47,chess_earth_47,chess_earth_47,chess_ember_49,chess_earth_49,chess_ember_50,chess_ember_52,chess_void_52,chess_earth_52",
          "count": 580220,
          "is_vip": 0,
          "steam_id": "steam_id_164"
        },
        "16": {
          "chess_list": "chess_ember_4,chess_ember_5,chess_ember_7,chess_ember_8,chess_earth_9,chess_ember_9,chess_void_10,chess_earth_10,chess_earth_11,chess_earth_11,chess_earth_13,chess_earth_13,chess_earth_14,chess_ember_14,chess_ember_16,chess_earth_16,chess_earth_16,chess_brew_17,chess_earth_19,chess_ember_20,chess_void_20,chess_ember_21,chess_ember_22,chess_void_22,chess_void_22,chess_ember_24,chess_void_27,chess_ember_27,chess_void_28,chess_ember_28,chess_earth_30,chess_ember_32,chess_earth_32,chess_earth_32,chess_ember_33,chess_earth_33,chess_earth_36,chess_ember_36,chess_ember_36,chess_mars_37,chess_earth_38,chess_ember_39,chess_earth_39,chess_earth_39,chess_void_39,chess_earth_39,chess_ember_40,chess_ember_40,chess_et_43,chess_ember_43,chess_void_43,chess_ember_43,chess_earth_45,chess_void_45,chess_ember_46,chess_earth_47,chess_earth_47",
          "count": 570222,
          "is_vip": 1,
          "steam_id": "steam_id_165"
        },
        "17": {
          "chess_list": "chess_earth_17,chess_brew_24,chess_earth_25,chess_brew_26,chess_brew_27,chess_earth_29,chess_brew_29,chess_brew_30,chess_earth_31,chess_ds_32,chess_brew_32,chess_earth_33,chess_earth_34,chess_brew_34,chess_earth_34,chess_brew_35,chess_brew_35,chess_brew_37,chess_bat_38,chess_earth_38,chess_earth_38,chess_void_39,chess_earth_39,chess_brew_41,chess_earth_43,chess_void_45,chess_brew_45,chess_brew_46,chess_earth_46,chess_void_47,chess_brew_47,chess_earth_48,chess_brew_48,chess_ss_49,chess_brew_49,chess_void_51,chess_brew_52,chess_earth_52,chess_earth_53,chess_void_53,chess_brew_53,chess_void_53,chess_void_54,chess_void_55,chess_earth_55,chess_ember_56,chess_earth_57,chess_ember_57,chess_brew_58,chess_void_60,chess_earth_60,chess_void_60,chess_earth_60,chess_earth_61,chess_ember_61,chess_ember_61,chess_brew_62",
          "count": 570161,
          "is_vip": 0,
          "steam_id": "steam_id_166"
        },
        "18": {
          "chess_list": "chess_earth_4,chess_earth_5,chess_storm_7,chess_brew_8,chess_earth_9,chess_brew_10,chess_earth_10,chess_ember_12,chess_earth_12,chess_void_13,chess_earth_16,chess_ember_19,chess_brew_19,chess_ember_21,chess_earth_22,chess_earth_24,chess_earth_24,chess_void_24,chess_brew_25,chess_ember_26,chess_ember_27,chess_ember_29,chess_void_29,chess_storm_29,chess_brew_30,chess_ember_32,chess_earth_33,chess_storm_34,chess_earth_34,chess_ember_34,chess_hw_36,chess_void_36,chess_storm_36,chess_brew_39,chess_earth_39,chess_void_39,chess_earth_40,chess_void_40,chess_earth_41,chess_storm_41,chess_void_42,chess_brew_43,chess_earth_45,chess_void_45,chess_storm_46,chess_earth_48,chess_storm_48,chess_ember_49,chess_storm_49,chess_earth_50,chess_void_50,chess_void_50,chess_earth_51,chess_storm_51,chess_earth_52,chess_storm_52",
          "count": 560200,
          "is_vip": 0,
          "steam_id": "steam_id_167"
        },
        "19": {
          "chess_list": "chess_storm_7,chess_earth_8,chess_void_9,chess_storm_10,chess_void_10,chess_earth_10,chess_storm_11,chess_brew_12,chess_naix_14,chess_earth_14,chess_void_15,chess_slark_18,chess_brew_18,chess_void_21,chess_earth_22,chess_naix_23,chess_void_23,chess_storm_23,chess_storm_25,chess_void_26,chess_storm_26,chess_storm_28,chess_brew_30,chess_storm_30,chess_earth_31,chess_earth_31,chess_brew_31,chess_storm_32,chess_naix_33,chess_earth_33,chess_brew_33,chess_void_35,chess_earth_37,chess_earth_39,chess_earth_39,chess_void_40,chess_void_40,chess_storm_40,chess_storm_41,chess_brew_41,chess_earth_43,chess_void_44,chess_earth_45,chess_et_46,chess_void_46,chess_earth_47,chess_earth_47,chess_storm_50,chess_void_51,chess_storm_51,chess_brew_51,chess_storm_52,chess_void_52,chess_earth_53,chess_earth_54,chess_storm_54",
          "count": 560195,
          "is_vip": 0,
          "steam_id": "steam_id_168"
        },
        "2": {
          "chess_list": "chess_void_5,chess_void_9,chess_brew_9,chess_brew_10,chess_brew_11,chess_brew_11,chess_brew_12,chess_void_14,chess_void_17,chess_storm_18,chess_ember_20,chess_storm_21,chess_void_22,chess_earth_23,chess_void_23,chess_ember_23,chess_ember_24,chess_void_24,chess_storm_25,chess_earth_26,chess_earth_27,chess_void_27,chess_void_27,chess_storm_29,chess_storm_30,chess_storm_30,chess_void_31,chess_brew_31,chess_void_32,chess_void_32,chess_void_33,chess_earth_35,chess_brew_36,chess_brew_37,chess_brew_38,chess_earth_39,chess_brew_39,chess_earth_40,chess_storm_41,chess_earth_41,chess_brew_44,chess_earth_44,chess_earth_45,chess_brew_45,chess_ember_45,chess_void_45,chess_storm_45,chess_brew_46,chess_void_46,chess_void_46,chess_earth_47,chess_ember_49,chess_brew_50,chess_earth_52,chess_earth_53,chess_brew_53,chess_ember_54,chess_brew_54,chess_void_54,chess_brew_54,chess_void_55,chess_earth_56,chess_earth_56,chess_void_58,chess_earth_58,chess_brew_58,chess_void_58,chess_earth_58,chess_ember_59,chess_earth_60,chess_brew_60,chess_void_60,chess_brew_60,chess_earth_61,chess_ember_61,chess_void_61,chess_brew_61,chess_void_61,chess_brew_62,chess_earth_62,chess_void_63,chess_storm_64,chess_brew_64,chess_earth_64,chess_brew_64,chess_void_66,chess_earth_66,chess_brew_66,chess_brew_67,chess_brew_68,chess_void_68,chess_void_69,chess_earth_69,chess_void_69,chess_brew_71,chess_earth_71,chess_storm_71,chess_earth_71,chess_brew_73,chess_earth_74,chess_void_74,chess_brew_74",
          "count": 1020318,
          "is_vip": 0,
          "steam_id": "steam_id_169"
        },
        "20": {
          "chess_list": "chess_void_6,chess_ember_12,chess_brew_15,chess_ember_18,chess_void_20,chess_brew_20,chess_ember_20,chess_brew_20,chess_brew_21,chess_void_21,chess_void_22,chess_void_24,chess_void_26,chess_ember_26,chess_brew_26,chess_brew_27,chess_brew_28,chess_ember_29,chess_void_29,chess_ember_30,chess_ember_31,chess_void_31,chess_ember_32,chess_void_32,chess_earth_34,chess_brew_34,chess_void_36,chess_brew_38,chess_ember_38,chess_void_39,chess_earth_39,chess_ember_40,chess_earth_40,chess_earth_40,chess_void_42,chess_ember_42,chess_void_42,chess_brew_43,chess_brew_44,chess_void_44,chess_void_44,chess_earth_45,chess_void_47,chess_brew_48,chess_void_50,chess_ember_50,chess_ember_51,chess_brew_52,chess_storm_53,chess_void_54,chess_ember_58,chess_storm_59,chess_earth_60,chess_void_61,chess_ember_61,chess_storm_61",
          "count": 560185,
          "is_vip": 0,
          "steam_id": "steam_id_170"
        },
        "21": {
          "chess_list": "chess_ember_7,chess_void_10,chess_ember_14,chess_ember_17,chess_void_20,chess_ember_21,chess_void_24,chess_ember_25,chess_void_26,chess_earth_26,chess_storm_27,chess_earth_27,chess_ember_28,chess_ember_28,chess_void_30,chess_ember_30,chess_ember_31,chess_storm_31,chess_ember_33,chess_ember_33,chess_void_33,chess_ember_34,chess_ember_35,chess_ember_35,chess_void_36,chess_void_37,chess_ember_38,chess_earth_38,chess_void_38,chess_storm_39,chess_void_40,chess_void_41,chess_void_41,chess_ember_41,chess_storm_43,chess_earth_44,chess_void_44,chess_ember_44,chess_storm_45,chess_ember_45,chess_void_45,chess_earth_46,chess_storm_46,chess_ember_48,chess_ember_48,chess_ember_48,chess_ember_50,chess_ember_52,chess_earth_53,chess_void_54,chess_earth_54,chess_earth_56,chess_brew_57,chess_void_57,chess_ember_57",
          "count": 550217,
          "is_vip": 0,
          "steam_id": "steam_id_171"
        },
        "22": {
          "chess_list": "chess_storm_3,chess_storm_5,chess_storm_7,chess_earth_9,chess_storm_9,chess_brew_10,chess_ember_12,chess_brew_14,chess_earth_14,chess_storm_16,chess_earth_18,chess_storm_19,chess_ember_19,chess_earth_19,chess_void_20,chess_earth_20,chess_ember_21,chess_earth_21,chess_storm_21,chess_void_21,chess_void_22,chess_ember_23,chess_void_23,chess_ember_24,chess_storm_25,chess_ember_27,chess_storm_28,chess_ember_28,chess_storm_28,chess_storm_29,chess_void_29,chess_brew_29,chess_ember_29,chess_void_30,chess_ember_33,chess_storm_34,chess_void_35,chess_earth_35,chess_void_35,chess_earth_36,chess_earth_37,chess_earth_38,chess_earth_39,chess_void_39,chess_void_40,chess_brew_41,chess_void_41,chess_void_42,chess_storm_42,chess_puck_43,chess_brew_44,chess_void_45,chess_storm_46,chess_brew_48,chess_void_51",
          "count": 550200,
          "is_vip": 1,
          "steam_id": "steam_id_172"
        },
        "23": {
          "chess_list": "chess_earth_2,chess_ember_8,chess_earth_8,chess_earth_12,chess_wl_14,chess_earth_14,chess_brew_15,chess_earth_15,chess_brew_16,chess_earth_18,chess_earth_19,chess_brew_19,chess_earth_19,chess_earth_20,chess_bm_21,chess_na_22,chess_earth_22,chess_earth_23,chess_earth_25,chess_earth_25,chess_earth_26,chess_earth_28,chess_brew_29,chess_earth_30,chess_brew_31,chess_earth_32,chess_earth_32,chess_earth_32,chess_earth_33,chess_brew_35,chess_earth_35,chess_earth_38,chess_earth_38,chess_earth_38,chess_earth_39,chess_earth_40,chess_earth_40,chess_earth_41,chess_brew_41,chess_earth_43,chess_brew_43,chess_earth_44,chess_earth_45,chess_earth_46,chess_earth_46,chess_earth_46,chess_brew_47,chess_earth_48,chess_earth_48,chess_brew_50,chess_earth_50,chess_earth_50,chess_earth_51,chess_brew_51,chess_earth_52",
          "count": 550186,
          "is_vip": 0,
          "steam_id": "steam_id_173"
        },
        "24": {
          "chess_list": "chess_void_2,chess_snap_5,chess_db_7,chess_earth_8,chess_brew_8,chess_void_9,chess_brew_10,chess_void_10,chess_earth_10,chess_void_10,chess_earth_12,chess_storm_13,chess_void_13,chess_brew_15,chess_earth_16,chess_void_18,chess_brew_18,chess_earth_18,chess_earth_22,chess_brew_22,chess_void_22,chess_void_22,chess_razor_23,chess_void_23,chess_void_24,chess_earth_24,chess_earth_25,chess_na_28,chess_earth_28,chess_brew_29,chess_earth_30,chess_void_30,chess_ember_32,chess_earth_32,chess_void_33,chess_void_34,chess_earth_35,chess_lc_36,chess_void_36,chess_brew_37,chess_earth_38,chess_void_39,chess_void_39,chess_earth_42,chess_void_43,chess_earth_44,chess_void_46,chess_earth_46,chess_void_48,chess_earth_48,chess_earth_49,chess_earth_49,chess_void_50,chess_void_52",
          "count": 540192,
          "is_vip": 0,
          "steam_id": "steam_id_174"
        },
        "25": {
          "chess_list": "chess_earth_12,chess_earth_16,chess_earth_20,chess_ember_22,chess_earth_24,chess_ember_24,chess_earth_25,chess_earth_26,chess_earth_27,chess_brew_28,chess_ember_28,chess_brew_29,chess_earth_30,chess_brew_31,chess_void_31,chess_ember_31,chess_earth_31,chess_ember_31,chess_earth_32,chess_brew_33,chess_brew_34,chess_earth_37,chess_void_37,chess_void_38,chess_earth_38,chess_storm_39,chess_ember_39,chess_void_39,chess_void_39,chess_earth_39,chess_brew_40,chess_earth_41,chess_ember_42,chess_storm_42,chess_earth_42,chess_brew_43,chess_ember_44,chess_ember_45,chess_void_45,chess_void_45,chess_earth_46,chess_storm_47,chess_ember_48,chess_ember_49,chess_earth_49,chess_earth_50,chess_storm_52,chess_void_52,chess_ember_53,chess_earth_53,chess_earth_53,chess_brew_54,chess_ember_54,chess_earth_54",
          "count": 540192,
          "is_vip": 0,
          "steam_id": "steam_id_175"
        },
        "26": {
          "chess_list": "chess_void_7,chess_brew_10,chess_brew_11,chess_brew_12,chess_brew_13,chess_brew_14,chess_brew_14,chess_void_15,chess_void_17,chess_void_19,chess_void_19,chess_brew_20,chess_void_21,chess_storm_21,chess_brew_23,chess_void_23,chess_storm_24,chess_void_26,chess_brew_26,chess_storm_26,chess_void_27,chess_brew_28,chess_brew_29,chess_ember_30,chess_storm_31,chess_storm_32,chess_brew_32,chess_brew_33,chess_storm_33,chess_storm_34,chess_storm_34,chess_earth_36,chess_earth_37,chess_earth_38,chess_brew_39,chess_void_39,chess_void_39,chess_brew_40,chess_void_40,chess_brew_41,chess_void_43,chess_brew_43,chess_storm_44,chess_void_44,chess_void_45,chess_void_45,chess_storm_46,chess_brew_47,chess_brew_48,chess_void_49,chess_void_49,chess_brew_51,chess_storm_51,chess_earth_51",
          "count": 540156,
          "is_vip": 0,
          "steam_id": "steam_id_176"
        },
        "27": {
          "chess_list": "chess_storm_7,chess_storm_8,chess_storm_10,chess_storm_16,chess_brew_16,chess_brew_19,chess_brew_20,chess_brew_20,chess_brew_21,chess_brew_21,chess_brew_22,chess_brew_23,chess_brew_24,chess_brew_25,chess_brew_25,chess_storm_25,chess_brew_26,chess_brew_29,chess_earth_30,chess_brew_30,chess_brew_31,chess_earth_31,chess_storm_32,chess_brew_33,chess_storm_35,chess_brew_35,chess_storm_36,chess_storm_36,chess_brew_37,chess_brew_38,chess_brew_38,chess_ember_39,chess_earth_41,chess_brew_42,chess_brew_42,chess_void_44,chess_brew_44,chess_storm_44,chess_ember_44,chess_brew_46,chess_earth_47,chess_brew_48,chess_earth_50,chess_brew_52,chess_earth_52,chess_ember_52,chess_ember_53,chess_storm_53,chess_storm_56,chess_earth_57,chess_storm_58,chess_brew_58,chess_ember_59,chess_brew_59",
          "count": 540132,
          "is_vip": 0,
          "steam_id": "steam_id_177"
        },
        "28": {
          "chess_list": "chess_storm_2,chess_ember_4,chess_storm_4,chess_brew_4,chess_storm_6,chess_ember_6,chess_earth_8,chess_storm_8,chess_ember_9,chess_ember_10,chess_ember_10,chess_storm_12,chess_ember_14,chess_earth_15,chess_storm_15,chess_brew_16,chess_ember_18,chess_brew_18,chess_earth_18,chess_storm_19,chess_storm_21,chess_ember_22,chess_brew_22,chess_storm_23,chess_storm_23,chess_ember_24,chess_ember_25,chess_ember_25,chess_brew_28,chess_ember_28,chess_storm_29,chess_brew_29,chess_storm_31,chess_storm_31,chess_earth_31,chess_earth_33,chess_earth_34,chess_ember_34,chess_storm_35,chess_ember_37,chess_ember_37,chess_storm_38,chess_wr_39,chess_storm_39,chess_earth_39,chess_ember_39,chess_am_40,chess_storm_41,chess_ember_41,chess_earth_42,chess_ember_42,chess_storm_43,chess_ember_44",
          "count": 530192,
          "is_vip": 0,
          "steam_id": "steam_id_178"
        },
        "29": {
          "chess_list": "chess_void_2,chess_storm_4,chess_void_5,chess_brew_5,chess_earth_6,chess_void_8,chess_void_10,chess_ember_13,chess_storm_13,chess_brew_13,chess_ember_15,chess_void_15,chess_brew_15,chess_ember_17,chess_brew_17,chess_storm_19,chess_brew_19,chess_brew_19,chess_void_20,chess_storm_20,chess_brew_22,chess_void_24,chess_brew_24,chess_void_24,chess_void_25,chess_storm_26,chess_void_26,chess_storm_27,chess_brew_27,chess_void_28,chess_storm_28,chess_ember_29,chess_storm_30,chess_ember_30,chess_ember_31,chess_ember_31,chess_void_31,chess_storm_32,chess_storm_32,chess_void_32,chess_earth_33,chess_storm_34,chess_earth_36,chess_earth_38,chess_ember_40,chess_void_41,chess_void_42,chess_brew_44,chess_void_45,chess_earth_45,chess_earth_45,chess_void_46,chess_void_46",
          "count": 530182,
          "is_vip": 0,
          "steam_id": "steam_id_179"
        },
        "3": {
          "chess_list": "chess_void_13,chess_earth_14,chess_brew_14,chess_earth_15,chess_brew_15,chess_earth_16,chess_brew_18,chess_earth_18,chess_brew_19,chess_void_21,chess_void_22,chess_earth_22,chess_brew_24,chess_void_24,chess_earth_24,chess_earth_27,chess_brew_27,chess_brew_28,chess_void_28,chess_brew_29,chess_brew_30,chess_void_31,chess_brew_31,chess_void_32,chess_brew_32,chess_void_33,chess_void_33,chess_brew_34,chess_earth_36,chess_void_38,chess_void_39,chess_void_40,chess_void_40,chess_void_40,chess_void_41,chess_brew_41,chess_void_42,chess_void_43,chess_brew_43,chess_void_44,chess_void_45,chess_void_45,chess_brew_46,chess_void_46,chess_brew_47,chess_brew_49,chess_void_49,chess_ember_50,chess_void_50,chess_void_51,chess_void_52,chess_earth_54,chess_void_54,chess_earth_54,chess_brew_56,chess_ember_58,chess_void_58,chess_brew_59,chess_ember_60,chess_storm_61,chess_void_61,chess_brew_61,chess_void_63,chess_void_63,chess_ember_64,chess_void_65,chess_brew_65,chess_void_66,chess_storm_67,chess_void_68,chess_brew_69,chess_void_69,chess_brew_70,chess_earth_70,chess_brew_71,chess_brew_74,chess_void_74,chess_earth_74,chess_earth_74,chess_brew_75,chess_storm_76,chess_storm_76,chess_brew_76,chess_void_76,chess_earth_78,chess_void_78,chess_ember_79,chess_brew_79,chess_earth_79,chess_brew_81,chess_ember_83,chess_brew_83,chess_brew_83,chess_void_84,chess_earth_84,chess_brew_84,chess_void_84,chess_earth_85,chess_brew_86,chess_void_87,chess_storm_87",
          "count": 1010305,
          "is_vip": 0,
          "steam_id": "steam_id_180"
        },
        "30": {
          "chess_list": "chess_earth_7,chess_storm_10,chess_earth_10,chess_storm_12,chess_storm_13,chess_earth_15,chess_brew_17,chess_earth_19,chess_storm_21,chess_earth_21,chess_earth_22,chess_void_23,chess_storm_23,chess_storm_24,chess_brew_24,chess_earth_24,chess_brew_24,chess_storm_25,chess_brew_26,chess_brew_27,chess_void_27,chess_earth_28,chess_void_29,chess_storm_31,chess_storm_31,chess_earth_32,chess_storm_33,chess_brew_33,chess_storm_34,chess_brew_35,chess_storm_35,chess_brew_36,chess_ember_37,chess_brew_40,chess_storm_40,chess_storm_40,chess_storm_42,chess_storm_43,chess_void_44,chess_storm_44,chess_void_45,chess_brew_45,chess_storm_45,chess_storm_46,chess_void_46,chess_storm_47,chess_storm_47,chess_earth_48,chess_storm_49,chess_earth_50,chess_earth_50,chess_storm_51,chess_brew_52",
          "count": 530179,
          "is_vip": 0,
          "steam_id": "steam_id_181"
        },
        "31": {
          "chess_list": "chess_void_8,chess_brew_13,chess_storm_14,chess_void_14,chess_dw_16,chess_brew_19,chess_void_20,chess_void_25,chess_sf_26,chess_void_26,chess_void_26,chess_brew_26,chess_ember_31,chess_earth_31,chess_earth_32,chess_ember_32,chess_brew_33,chess_brew_35,chess_ember_35,chess_brew_36,chess_void_38,chess_void_39,chess_storm_39,chess_void_40,chess_storm_40,chess_void_41,chess_earth_41,chess_void_41,chess_void_42,chess_ember_42,chess_brew_44,chess_void_44,chess_storm_44,chess_brew_45,chess_storm_45,chess_storm_46,chess_brew_46,chess_void_47,chess_storm_47,chess_void_47,chess_earth_47,chess_earth_49,chess_earth_49,chess_void_51,chess_brew_51,chess_storm_52,chess_earth_52,chess_earth_53,chess_void_53,chess_void_54,chess_storm_54,chess_void_55,chess_ember_55",
          "count": 530178,
          "is_vip": 0,
          "steam_id": "steam_id_182"
        },
        "32": {
          "chess_list": "chess_storm_3,chess_void_5,chess_earth_7,chess_storm_8,chess_earth_9,chess_earth_11,chess_storm_12,chess_storm_13,chess_earth_14,chess_storm_14,chess_void_14,chess_storm_15,chess_earth_18,chess_earth_19,chess_storm_19,chess_brew_21,chess_storm_22,chess_storm_23,chess_storm_24,chess_earth_24,chess_earth_24,chess_earth_25,chess_storm_25,chess_storm_25,chess_storm_25,chess_earth_26,chess_void_27,chess_ld_28,chess_storm_28,chess_storm_29,chess_storm_29,chess_storm_30,chess_earth_30,chess_storm_31,chess_storm_32,chess_earth_32,chess_storm_34,chess_storm_35,chess_earth_35,chess_earth_35,chess_storm_35,chess_storm_35,chess_earth_38,chess_earth_38,chess_na_39,chess_storm_39,chess_earth_39,chess_earth_40,chess_storm_40,chess_storm_40,chess_earth_40,chess_earth_42",
          "count": 520205,
          "is_vip": 0,
          "steam_id": "steam_id_183"
        },
        "33": {
          "chess_list": "chess_earth_2,chess_ember_3,chess_void_4,chess_ember_4,chess_ember_5,chess_void_7,chess_void_9,chess_earth_12,chess_ember_12,chess_ember_14,chess_void_14,chess_void_16,chess_earth_17,chess_ember_18,chess_void_19,chess_void_19,chess_brew_20,chess_ember_20,chess_ember_21,chess_void_23,chess_void_24,chess_void_24,chess_void_25,chess_void_26,chess_void_27,chess_brew_28,chess_ember_28,chess_ember_28,chess_void_29,chess_earth_29,chess_ember_30,chess_void_31,chess_ember_32,chess_ember_34,chess_void_34,chess_void_35,chess_void_36,chess_void_37,chess_tusk_38,chess_ember_39,chess_ember_40,chess_void_41,chess_void_43,chess_void_44,chess_earth_44,chess_void_44,chess_ember_45,chess_void_45,chess_ember_46,chess_ember_47,chess_ember_48,chess_ember_49",
          "count": 520199,
          "is_vip": 0,
          "steam_id": "steam_id_184"
        },
        "34": {
          "chess_list": "chess_storm_11,chess_brew_15,chess_storm_17,chess_storm_19,chess_storm_22,chess_ember_24,chess_storm_24,chess_storm_24,chess_brew_24,chess_storm_26,chess_storm_28,chess_storm_31,chess_brew_31,chess_brew_34,chess_ember_34,chess_brew_34,chess_storm_38,chess_ember_39,chess_brew_39,chess_void_40,chess_marci_41,chess_storm_41,chess_storm_41,chess_earth_42,chess_storm_42,chess_void_42,chess_storm_43,chess_storm_44,chess_storm_44,chess_storm_45,chess_void_45,chess_ember_46,chess_brew_46,chess_void_46,chess_storm_48,chess_ember_49,chess_storm_50,chess_brew_50,chess_void_51,chess_ember_51,chess_ember_52,chess_storm_52,chess_earth_53,chess_storm_53,chess_ember_53,chess_void_54,chess_brew_54,chess_storm_55,chess_brew_57,chess_storm_57,chess_storm_57,chess_storm_58",
          "count": 520177,
          "is_vip": 1,
          "steam_id": "steam_id_185"
        },
        "35": {
          "chess_list": "chess_ember_10,chess_storm_11,chess_brew_12,chess_brew_13,chess_brew_14,chess_brew_17,chess_brew_18,chess_brew_19,chess_storm_19,chess_brew_20,chess_brew_20,chess_ember_20,chess_storm_20,chess_ember_22,chess_ember_26,chess_storm_27,chess_void_28,chess_storm_28,chess_storm_28,chess_ember_28,chess_brew_29,chess_storm_30,chess_storm_31,chess_storm_33,chess_void_35,chess_brew_35,chess_th_36,chess_earth_39,chess_void_40,chess_earth_42,chess_brew_42,chess_storm_42,chess_void_42,chess_ember_44,chess_ember_44,chess_earth_45,chess_storm_46,chess_storm_47,chess_earth_48,chess_brew_48,chess_brew_48,chess_void_49,chess_brew_49,chess_storm_50,chess_pangolier_51,chess_brew_51,chess_earth_51,chess_earth_52,chess_storm_53,chess_storm_58,chess_ember_58,chess_ember_59",
          "count": 520164,
          "is_vip": 0,
          "steam_id": "steam_id_186"
        },
        "36": {
          "chess_list": "chess_storm_4,chess_brew_5,chess_earth_7,chess_brew_10,chess_earth_10,chess_storm_11,chess_brew_12,chess_brew_13,chess_ember_14,chess_brew_14,chess_brew_15,chess_storm_16,chess_earth_16,chess_ember_17,chess_brew_17,chess_storm_18,chess_storm_19,chess_ember_19,chess_brew_21,chess_void_23,chess_storm_23,chess_storm_25,chess_earth_26,chess_storm_27,chess_brew_27,chess_storm_28,chess_brew_30,chess_brew_31,chess_brew_31,chess_earth_31,chess_brew_32,chess_void_33,chess_earth_33,chess_brew_33,chess_earth_34,chess_void_34,chess_brew_35,chess_brew_37,chess_storm_37,chess_earth_38,chess_brew_38,chess_ember_39,chess_void_39,chess_ember_40,chess_void_40,chess_earth_41,chess_storm_42,chess_storm_42,chess_void_43,chess_void_43,chess_void_44,chess_earth_46",
          "count": 520157,
          "is_vip": 0,
          "steam_id": "steam_id_187"
        },
        "37": {
          "chess_list": "chess_earth_2,chess_ember_5,chess_brew_5,chess_storm_7,chess_earth_7,chess_ember_11,chess_earth_11,chess_ember_14,chess_earth_15,chess_veno_16,chess_ember_16,chess_brew_17,chess_brew_18,chess_earth_18,chess_earth_19,chess_void_20,chess_earth_20,chess_earth_21,chess_void_21,chess_brew_21,chess_ember_22,chess_void_22,chess_earth_22,chess_void_24,chess_storm_24,chess_ember_25,chess_brew_26,chess_ember_27,chess_void_28,chess_storm_28,chess_ember_29,chess_ember_30,chess_brew_31,chess_earth_32,chess_brew_33,chess_ember_33,chess_void_33,chess_brew_33,chess_ember_34,chess_earth_34,chess_brew_34,chess_ember_35,chess_brew_35,chess_storm_35,chess_void_36,chess_brew_36,chess_earth_37,chess_storm_37,chess_void_37,chess_earth_38,chess_earth_38",
          "count": 510170,
          "is_vip": 0,
          "steam_id": "steam_id_188"
        },
        "38": {
          "chess_list": "chess_storm_7,chess_storm_10,chess_brew_11,chess_ember_12,chess_void_15,chess_brew_16,chess_brew_17,chess_brew_18,chess_earth_19,chess_brew_19,chess_brew_19,chess_brew_21,chess_storm_21,chess_brew_22,chess_void_22,chess_earth_23,chess_storm_24,chess_ember_24,chess_earth_25,chess_brew_27,chess_void_27,chess_ember_28,chess_brew_28,chess_void_29,chess_brew_31,chess_brew_31,chess_storm_32,chess_void_32,chess_storm_34,chess_brew_36,chess_ember_38,chess_earth_38,chess_storm_39,chess_earth_39,chess_void_42,chess_storm_42,chess_brew_42,chess_void_42,chess_void_43,chess_storm_43,chess_void_44,chess_ld_46,chess_void_46,chess_void_47,chess_earth_50,chess_ember_50,chess_earth_51,chess_storm_52,chess_earth_53,chess_storm_56,chess_earth_56",
          "count": 510162,
          "is_vip": 0,
          "steam_id": "steam_id_189"
        },
        "39": {
          "chess_list": "chess_storm_8,chess_storm_9,chess_brew_9,chess_brew_10,chess_storm_11,chess_brew_12,chess_brew_15,chess_storm_16,chess_storm_17,chess_void_19,chess_storm_19,chess_brew_20,chess_storm_22,chess_void_23,chess_brew_23,chess_storm_25,chess_void_25,chess_brew_28,chess_storm_28,chess_void_29,chess_void_29,chess_brew_32,chess_void_33,chess_brew_33,chess_storm_33,chess_brew_33,chess_void_34,chess_void_35,chess_void_35,chess_brew_35,chess_void_35,chess_storm_36,chess_earth_38,chess_storm_39,chess_storm_40,chess_earth_42,chess_brew_42,chess_storm_45,chess_ember_46,chess_void_47,chess_brew_47,chess_ember_47,chess_brew_48,chess_storm_48,chess_ember_48,chess_ember_49,chess_brew_49,chess_storm_49,chess_storm_50,chess_storm_50,chess_brew_51",
          "count": 510156,
          "is_vip": 1,
          "steam_id": "steam_id_190"
        },
        "4": {
          "chess_list": "chess_ember_2,chess_void_3,chess_brew_3,chess_brew_5,chess_storm_7,chess_void_7,chess_brew_7,chess_brew_11,chess_brew_13,chess_void_14,chess_brew_17,chess_ember_18,chess_brew_19,chess_storm_20,chess_ember_22,chess_brew_27,chess_earth_30,chess_brew_30,chess_ember_31,chess_storm_32,chess_brew_33,chess_earth_34,chess_brew_34,chess_void_34,chess_ember_35,chess_earth_35,chess_brew_35,chess_void_36,chess_storm_37,chess_earth_37,chess_void_38,chess_brew_38,chess_brew_38,chess_storm_40,chess_earth_40,chess_ember_41,chess_ember_42,chess_storm_42,chess_brew_43,chess_void_43,chess_ember_43,chess_earth_45,chess_earth_46,chess_ember_47,chess_brew_48,chess_brew_48,chess_brew_50,chess_brew_50,chess_void_50,chess_ember_50,chess_brew_51,chess_veno_52,chess_earth_53,chess_storm_53,chess_earth_56,chess_ember_57,chess_brew_58,chess_ember_59,chess_void_60,chess_storm_60,chess_ember_61,chess_storm_61,chess_earth_61,chess_brew_62,chess_brew_62,chess_storm_62,chess_earth_63,chess_ember_63,chess_storm_63,chess_storm_63,chess_brew_64,chess_ember_64,chess_void_64,chess_ember_65,chess_brew_65,chess_brew_65,chess_storm_65,chess_void_66,chess_void_66,chess_earth_66,chess_ember_67,chess_ember_68,chess_earth_68,chess_brew_69,chess_void_69,chess_storm_69,chess_earth_70,chess_earth_70,chess_brew_71,chess_storm_72,chess_brew_74,chess_earth_74,chess_storm_75,chess_storm_77",
          "count": 940288,
          "is_vip": 0,
          "steam_id": "steam_id_191"
        },
        "40": {
          "chess_list": "chess_ember_5,chess_brew_6,chess_ember_10,chess_ember_12,chess_brew_15,chess_ember_15,chess_brew_16,chess_ember_16,chess_ember_17,chess_ember_19,chess_brew_20,chess_ember_20,chess_brew_21,chess_brew_22,chess_brew_23,chess_brew_23,chess_brew_24,chess_brew_25,chess_ember_25,chess_ember_27,chess_ember_28,chess_brew_28,chess_brew_28,chess_brew_31,chess_ember_31,chess_storm_32,chess_brew_32,chess_ember_33,chess_earth_35,chess_brew_35,chess_ember_36,chess_brew_36,chess_storm_38,chess_ember_38,chess_storm_41,chess_storm_42,chess_ember_42,chess_brew_43,chess_ember_43,chess_storm_45,chess_storm_46,chess_ember_46,chess_ember_46,chess_ember_47,chess_brew_50,chess_storm_50,chess_ember_50,chess_brew_51,chess_storm_52,chess_ember_53,chess_earth_54",
          "count": 510147,
          "is_vip": 0,
          "steam_id": "steam_id_192"
        },
        "41": {
          "chess_list": "chess_earth_3,chess_ember_4,chess_ember_5,chess_void_6,chess_earth_6,chess_void_7,chess_ember_8,chess_ember_8,chess_ember_11,chess_storm_12,chess_void_17,chess_void_17,chess_ember_18,chess_ember_18,chess_ember_20,chess_earth_20,chess_void_21,chess_void_22,chess_ember_23,chess_void_23,chess_void_23,chess_ember_23,chess_void_24,chess_void_25,chess_earth_25,chess_earth_28,chess_earth_28,chess_ember_31,chess_storm_31,chess_earth_33,chess_ember_33,chess_earth_34,chess_earth_35,chess_storm_36,chess_ember_36,chess_storm_39,chess_ember_39,chess_storm_41,chess_ember_41,chess_void_41,chess_ember_42,chess_storm_42,chess_ember_42,chess_void_42,chess_ember_44,chess_doom_45,chess_earth_45,chess_doom_46,chess_earth_46,chess_ember_47",
          "count": 500200,
          "is_vip": 0,
          "steam_id": "steam_id_193"
        },
        "42": {
          "chess_list": "chess_ember_2,chess_earth_3,chess_ember_10,chess_earth_10,chess_earth_11,chess_earth_12,chess_ember_12,chess_ember_14,chess_earth_14,chess_ember_18,chess_jugg_19,chess_earth_20,chess_earth_21,chess_ember_21,chess_earth_22,chess_ember_24,chess_earth_24,chess_ember_25,chess_earth_25,chess_doom_26,chess_ember_29,chess_ember_30,chess_earth_30,chess_naga_31,chess_earth_31,chess_earth_33,chess_earth_34,chess_earth_35,chess_ember_35,chess_qop_36,chess_ember_36,chess_ember_37,chess_ember_38,chess_lyc_39,chess_ember_41,chess_ember_42,chess_ember_42,chess_earth_42,chess_earth_44,chess_ember_44,chess_ember_44,chess_pangolier_45,chess_ember_45,chess_earth_45,chess_wl_45,chess_earth_46,chess_earth_48,chess_wl_49,chess_earth_51,chess_earth_51",
          "count": 500199,
          "is_vip": 0,
          "steam_id": "steam_id_194"
        },
        "43": {
          "chess_list": "chess_void_5,chess_storm_6,chess_void_6,chess_void_7,chess_void_8,chess_storm_8,chess_void_9,chess_earth_10,chess_void_11,chess_earth_12,chess_storm_12,chess_earth_13,chess_ember_14,chess_brew_14,chess_void_14,chess_storm_15,chess_void_18,chess_storm_19,chess_storm_20,chess_void_21,chess_pangolier_22,chess_brew_23,chess_void_23,chess_ember_23,chess_void_24,chess_storm_24,chess_void_26,chess_storm_26,chess_earth_26,chess_hw_27,chess_earth_27,chess_storm_29,chess_void_30,chess_earth_30,chess_void_31,chess_storm_31,chess_earth_31,chess_storm_32,chess_void_34,chess_ember_35,chess_void_35,chess_brew_35,chess_void_36,chess_brew_38,chess_earth_38,chess_storm_41,chess_void_41,chess_storm_44,chess_earth_44,chess_storm_51",
          "count": 500185,
          "is_vip": 1,
          "steam_id": "steam_id_195"
        },
        "44": {
          "chess_list": "chess_storm_3,chess_storm_6,chess_storm_7,chess_brew_7,chess_storm_9,chess_brew_9,chess_storm_10,chess_void_11,chess_storm_13,chess_storm_13,chess_void_13,chess_ember_14,chess_storm_14,chess_storm_14,chess_earth_16,chess_ember_16,chess_ember_17,chess_earth_19,chess_storm_20,chess_brew_20,chess_brew_22,chess_earth_22,chess_void_24,chess_storm_25,chess_void_25,chess_brew_25,chess_ember_27,chess_ember_28,chess_storm_28,chess_brew_29,chess_lc_30,chess_earth_30,chess_ember_30,chess_void_32,chess_ember_33,chess_void_34,chess_ember_35,chess_void_36,chess_ember_38,chess_storm_38,chess_void_39,chess_earth_39,chess_brew_41,chess_brew_42,chess_void_42,chess_ember_43,chess_ember_48,chess_brew_48,chess_storm_51,chess_ember_51",
          "count": 500172,
          "is_vip": 0,
          "steam_id": "steam_id_196"
        },
        "45": {
          "chess_list": "chess_ember_2,chess_void_4,chess_brew_4,chess_ember_5,chess_ember_6,chess_ember_6,chess_morph_8,chess_brew_10,chess_void_12,chess_brew_13,chess_void_14,chess_void_14,chess_ember_14,chess_ember_15,chess_brew_15,chess_brew_15,chess_brew_16,chess_void_16,chess_ember_16,chess_ember_18,chess_earth_19,chess_void_19,chess_brew_20,chess_ember_22,chess_earth_22,chess_brew_22,chess_enigma_25,chess_earth_26,chess_brew_29,chess_brew_30,chess_earth_30,chess_storm_31,chess_ember_32,chess_brew_32,chess_ember_33,chess_jugg_35,chess_brew_36,chess_razor_37,chess_void_37,chess_earth_38,chess_ember_38,chess_brew_40,chess_brew_42,chess_void_42,chess_ember_43,chess_earth_43,chess_earth_47,chess_ember_48,chess_brew_48,chess_ember_50",
          "count": 500152,
          "is_vip": 1,
          "steam_id": "steam_id_197"
        },
        "46": {
          "chess_list": "chess_void_9,chess_void_12,chess_brew_12,chess_brew_15,chess_brew_17,chess_ember_21,chess_brew_21,chess_void_22,chess_brew_23,chess_brew_24,chess_brew_24,chess_void_24,chess_void_25,chess_brew_25,chess_void_27,chess_brew_27,chess_brew_28,chess_brew_29,chess_void_29,chess_brew_30,chess_brew_30,chess_void_31,chess_brew_31,chess_void_32,chess_void_32,chess_brew_33,chess_void_34,chess_brew_34,chess_void_34,chess_brew_38,chess_void_38,chess_storm_39,chess_storm_40,chess_brew_40,chess_earth_41,chess_void_41,chess_phx_42,chess_brew_42,chess_earth_43,chess_brew_44,chess_earth_44,chess_brew_45,chess_brew_48,chess_storm_48,chess_brew_48,chess_brew_50,chess_brew_50,chess_void_52,chess_void_53,chess_brew_53",
          "count": 500122,
          "is_vip": 0,
          "steam_id": "steam_id_198"
        },
        "47": {
          "chess_list": "chess_storm_8,chess_ember_10,chess_storm_10,chess_earth_13,chess_void_14,chess_earth_14,chess_void_15,chess_earth_15,chess_void_18,chess_void_18,chess_ember_18,chess_void_19,chess_ember_20,chess_void_20,chess_earth_21,chess_storm_22,chess_ember_25,chess_earth_26,chess_ember_26,chess_void_28,chess_brew_28,chess_storm_28,chess_earth_29,chess_void_30,chess_earth_30,chess_ember_30,chess_void_30,chess_storm_31,chess_earth_32,chess_storm_33,chess_storm_34,chess_storm_35,chess_earth_36,chess_void_37,chess_earth_38,chess_brew_39,chess_earth_39,chess_ember_41,chess_storm_42,chess_ember_43,chess_earth_43,chess_ember_44,chess_earth_44,chess_storm_46,chess_ember_47,chess_earth_48,chess_storm_49,chess_earth_49,chess_earth_49",
          "count": 490190,
          "is_vip": 1,
          "steam_id": "steam_id_199"
        },
        "48": {
          "chess_list": "chess_earth_7,chess_storm_8,chess_earth_8,chess_void_9,chess_void_11,chess_earth_11,chess_earth_12,chess_earth_14,chess_void_14,chess_earth_15,chess_earth_15,chess_earth_17,chess_earth_17,chess_brew_19,chess_brew_21,chess_earth_21,chess_earth_22,chess_earth_22,chess_earth_23,chess_earth_24,chess_void_24,chess_void_26,chess_earth_26,chess_na_29,chess_void_29,chess_earth_29,chess_earth_30,chess_earth_30,chess_earth_31,chess_void_31,chess_earth_31,chess_brew_32,chess_earth_35,chess_earth_36,chess_earth_37,chess_earth_37,chess_earth_39,chess_earth_40,chess_storm_41,chess_earth_41,chess_earth_42,chess_earth_43,chess_earth_44,chess_earth_44,chess_wr_45,chess_earth_45,chess_earth_45,chess_earth_47,chess_earth_47",
          "count": 490185,
          "is_vip": 1,
          "steam_id": "steam_id_200"
        },
        "49": {
          "chess_list": "chess_void_2,chess_ember_4,chess_void_5,chess_void_9,chess_earth_10,chess_ember_10,chess_void_11,chess_void_13,chess_void_14,chess_ember_14,chess_ember_14,chess_brew_15,chess_void_16,chess_void_16,chess_void_17,chess_ember_17,chess_earth_18,chess_ember_18,chess_ember_19,chess_earth_22,chess_ember_22,chess_ember_23,chess_ember_24,chess_earth_25,chess_ember_25,chess_earth_27,chess_earth_28,chess_ember_29,chess_void_29,chess_ember_29,chess_earth_30,chess_ember_30,chess_brew_31,chess_void_31,chess_earth_31,chess_void_32,chess_ember_32,chess_void_33,chess_earth_33,chess_brew_33,chess_void_34,chess_earth_36,chess_void_37,chess_brew_39,chess_brew_40,chess_void_42,chess_earth_42,chess_earth_43,chess_void_44",
          "count": 490181,
          "is_vip": 0,
          "steam_id": "steam_id_201"
        },
        "5": {
          "chess_list": "chess_earth_10,chess_brew_11,chess_void_12,chess_brew_13,chess_brew_14,chess_brew_17,chess_brew_20,chess_void_20,chess_brew_20,chess_morph_21,chess_void_21,chess_void_22,chess_void_24,chess_brew_24,chess_void_25,chess_brew_26,chess_brew_26,chess_brew_27,chess_void_30,chess_void_30,chess_earth_31,chess_void_31,chess_void_32,chess_earth_32,chess_brew_32,chess_void_34,chess_brew_38,chess_void_39,chess_void_40,chess_void_41,chess_brew_41,chess_void_41,chess_void_43,chess_earth_44,chess_void_44,chess_earth_45,chess_brew_45,chess_brew_45,chess_earth_46,chess_brew_47,chess_brew_47,chess_void_48,chess_void_49,chess_earth_49,chess_void_52,chess_brew_53,chess_earth_53,chess_void_54,chess_void_54,chess_brew_55,chess_void_55,chess_void_56,chess_brew_56,chess_void_57,chess_void_57,chess_brew_57,chess_brew_57,chess_brew_57,chess_brew_59,chess_void_59,chess_void_60,chess_void_61,chess_void_62,chess_brew_63,chess_earth_64,chess_void_65,chess_brew_65,chess_earth_65,chess_void_66,chess_brew_66,chess_brew_66,chess_earth_66,chess_storm_67,chess_brew_67,chess_void_67,chess_brew_67,chess_storm_68,chess_brew_68,chess_void_70,chess_storm_70,chess_void_70,chess_void_71,chess_earth_71,chess_earth_72,chess_brew_72,chess_brew_73,chess_storm_73,chess_void_73,chess_void_73,chess_void_74,chess_brew_74",
          "count": 910263,
          "is_vip": 0,
          "steam_id": "steam_id_202"
        },
        "50": {
          "chess_list": "chess_earth_5,chess_brew_7,chess_earth_11,chess_brew_15,chess_earth_17,chess_earth_17,chess_brew_17,chess_earth_18,chess_brew_19,chess_earth_20,chess_earth_21,chess_earth_21,chess_earth_22,chess_earth_22,chess_brew_22,chess_earth_23,chess_brew_23,chess_brew_24,chess_ember_25,chess_void_25,chess_void_25,chess_ta_26,chess_earth_26,chess_earth_27,chess_earth_28,chess_void_29,chess_earth_30,chess_earth_30,chess_earth_30,chess_earth_31,chess_earth_32,chess_void_33,chess_earth_33,chess_void_35,chess_void_36,chess_void_36,chess_ember_36,chess_void_37,chess_ember_39,chess_earth_39,chess_void_40,chess_earth_40,chess_earth_41,chess_void_41,chess_earth_41,chess_earth_42,chess_void_43,chess_ember_43,chess_earth_43",
          "count": 490176,
          "is_vip": 0,
          "steam_id": "steam_id_203"
        },
        "51": {
          "chess_list": "chess_storm_2,chess_brew_3,chess_storm_7,chess_brew_8,chess_storm_10,chess_earth_11,chess_brew_14,chess_brew_14,chess_storm_14,chess_storm_15,chess_brew_15,chess_ember_16,chess_earth_17,chess_storm_19,chess_storm_19,chess_void_20,chess_ember_21,chess_brew_21,chess_earth_22,chess_storm_22,chess_storm_23,chess_storm_23,chess_storm_24,chess_ember_25,chess_void_26,chess_brew_26,chess_storm_26,chess_storm_26,chess_storm_27,chess_storm_29,chess_void_29,chess_tusk_30,chess_void_31,chess_storm_32,chess_storm_34,chess_storm_34,chess_void_34,chess_storm_36,chess_ember_36,chess_storm_38,chess_void_38,chess_void_41,chess_earth_41,chess_storm_42,chess_earth_44,chess_storm_44,chess_storm_44,chess_storm_46,chess_storm_46",
          "count": 490172,
          "is_vip": 0,
          "steam_id": "steam_id_204"
        },
        "6": {
          "chess_list": "chess_brew_13,chess_earth_15,chess_brew_16,chess_brew_16,chess_void_19,chess_brew_19,chess_void_21,chess_void_22,chess_earth_24,chess_storm_29,chess_earth_30,chess_earth_31,chess_earth_31,chess_brew_32,chess_storm_33,chess_ember_34,chess_brew_34,chess_earth_34,chess_earth_35,chess_void_35,chess_ember_39,chess_ember_40,chess_earth_43,chess_void_43,chess_void_44,chess_storm_44,chess_ember_45,chess_ember_46,chess_brew_47,chess_storm_48,chess_earth_48,chess_ember_48,chess_ember_48,chess_void_49,chess_brew_51,chess_storm_51,chess_storm_51,chess_ember_51,chess_earth_51,chess_void_52,chess_ember_52,chess_storm_54,chess_void_54,chess_void_55,chess_storm_55,chess_storm_55,chess_storm_56,chess_brew_56,chess_void_59,chess_storm_59,chess_void_60,chess_void_60,chess_earth_61,chess_ember_61,chess_earth_61,chess_brew_62,chess_earth_63,chess_void_64,chess_storm_65,chess_ember_65,chess_brew_66,chess_earth_66,chess_earth_66,chess_storm_67,chess_void_67,chess_earth_67,chess_ember_67,chess_ember_67,chess_brew_68,chess_brew_69,chess_storm_69,chess_void_70,chess_void_70,chess_ember_71,chess_earth_71,chess_void_72,chess_storm_72,chess_ember_73,chess_void_73,chess_earth_73,chess_brew_74,chess_ember_74,chess_void_74,chess_storm_74,chess_void_76,chess_brew_76,chess_brew_76",
          "count": 870300,
          "is_vip": 0,
          "steam_id": "steam_id_205"
        },
        "7": {
          "chess_list": "chess_ember_8,chess_void_9,chess_ember_9,chess_ember_11,chess_brew_11,chess_ember_14,chess_brew_14,chess_brew_17,chess_brew_18,chess_ember_20,chess_brew_20,chess_void_21,chess_ember_21,chess_ember_23,chess_brew_23,chess_ember_24,chess_brew_24,chess_ember_25,chess_brew_25,chess_ember_27,chess_ember_27,chess_void_28,chess_ember_29,chess_void_29,chess_ember_29,chess_brew_31,chess_ember_31,chess_ember_33,chess_ember_34,chess_brew_35,chess_void_35,chess_void_36,chess_ember_36,chess_earth_37,chess_brew_37,chess_ember_38,chess_earth_38,chess_brew_39,chess_brew_39,chess_void_40,chess_brew_40,chess_ember_41,chess_earth_41,chess_earth_41,chess_earth_42,chess_ember_42,chess_ember_42,chess_ember_42,chess_ember_43,chess_void_44,chess_void_44,chess_void_45,chess_ember_45,chess_brew_45,chess_ember_45,chess_brew_45,chess_ember_45,chess_ember_46,chess_ember_47,chess_ember_47,chess_ember_48,chess_brew_49,chess_ember_50,chess_earth_51,chess_ember_51,chess_earth_51,chess_void_52,chess_earth_54,chess_ember_54,chess_void_54,chess_void_55,chess_brew_56,chess_brew_56,chess_void_56",
          "count": 740239,
          "is_vip": 0,
          "steam_id": "steam_id_206"
        },
        "8": {
          "chess_list": "chess_storm_5,chess_brew_7,chess_brew_8,chess_brew_9,chess_storm_12,chess_storm_14,chess_brew_14,chess_void_15,chess_brew_15,chess_storm_16,chess_void_17,chess_brew_17,chess_brew_18,chess_void_19,chess_brew_20,chess_brew_22,chess_brew_23,chess_storm_23,chess_void_25,chess_brew_27,chess_void_27,chess_brew_28,chess_void_28,chess_brew_28,chess_storm_29,chess_void_29,chess_brew_29,chess_storm_31,chess_storm_31,chess_brew_31,chess_brew_32,chess_storm_34,chess_earth_35,chess_storm_35,chess_lyc_36,chess_brew_36,chess_earth_37,chess_storm_37,chess_void_37,chess_earth_38,chess_void_38,chess_storm_39,chess_brew_39,chess_earth_40,chess_void_40,chess_storm_41,chess_brew_43,chess_void_43,chess_brew_43,chess_earth_44,chess_void_44,chess_storm_45,chess_storm_45,chess_brew_45,chess_ember_46,chess_void_46,chess_storm_46,chess_brew_47,chess_earth_49,chess_void_49,chess_earth_50,chess_void_50,chess_storm_51,chess_storm_51,chess_earth_53,chess_storm_53,chess_void_53,chess_brew_54,chess_storm_55",
          "count": 690206,
          "is_vip": 0,
          "steam_id": "steam_id_207"
        },
        "9": {
          "chess_list": "chess_void_5,chess_void_8,chess_brew_8,chess_storm_9,chess_void_9,chess_brew_9,chess_void_10,chess_ember_13,chess_earth_14,chess_void_14,chess_ember_14,chess_ember_16,chess_earth_18,chess_brew_19,chess_void_20,chess_ember_20,chess_ember_20,chess_storm_24,chess_brew_25,chess_void_26,chess_storm_27,chess_brew_27,chess_brew_28,chess_storm_28,chess_earth_28,chess_ember_28,chess_brew_29,chess_earth_30,chess_storm_32,chess_ember_33,chess_earth_33,chess_storm_33,chess_earth_34,chess_void_35,chess_brew_35,chess_storm_36,chess_void_37,chess_storm_38,chess_earth_38,chess_earth_38,chess_brew_39,chess_earth_40,chess_ember_40,chess_void_40,chess_storm_40,chess_void_42,chess_ember_43,chess_void_44,chess_storm_44,chess_earth_44,chess_void_45,chess_ember_45,chess_brew_46,chess_storm_47,chess_earth_47,chess_void_48,chess_storm_49,chess_storm_49,chess_storm_49,chess_void_50,chess_earth_51,chess_storm_51,chess_earth_52,chess_earth_52,chess_brew_52,chess_ember_53",
          "count": 660231,
          "is_vip": 0,
          "steam_id": "steam_id_208"
        }
      }
    },
    "ranking_top": {
      "1": {
        "chicken_count": 146,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_12",
        "queen_rank": 1
      },
      "10": {
        "chicken_count": 87,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_209",
        "queen_rank": 10
      },
      "100": {
        "chicken_count": 32,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_210",
        "queen_rank": 100
      },
      "11": {
        "chicken_count": 85,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_211",
        "queen_rank": 11
      },
      "12": {
        "chicken_count": 79,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_212",
        "queen_rank": 12
      },
      "13": {
        "chicken_count": 83,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_213",
        "queen_rank": 13
      },
      "14": {
        "chicken_count": 92,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_214",
        "queen_rank": 14
      },
      "15": {
        "chicken_count": 64,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_215",
        "queen_rank": 15
      },
      "16": {
        "chicken_count": 71,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_216",
        "queen_rank": 16
      },
      "17": {
        "chicken_count": 62,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_217",
        "queen_rank": 17
      },
      "18": {
        "chicken_count": 31,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_218",
        "queen_rank": 18
      },
      "19": {
        "chicken_count": 61,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_219",
        "queen_rank": 19
      },
      "2": {
        "chicken_count": 99,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_220",
        "queen_rank": 2
      },
      "20": {
        "chicken_count": 52,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_221",
        "queen_rank": 20
      },
      "21": {
        "chicken_count": 65,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_222",
        "queen_rank": 21
      },
      "22": {
        "chicken_count": 55,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_223",
        "queen_rank": 22
      },
      "23": {
        "chicken_count": 71,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_224",
        "queen_rank": 23
      },
      "24": {
        "chicken_count": 60,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_225",
        "queen_rank": 24
      },
      "25": {
        "chicken_count": 58,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_226",
        "queen_rank": 25
      },
      "26": {
        "chicken_count": 62,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_227",
        "queen_rank": 26
      },
      "27": {
        "chicken_count": 67,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_228",
        "queen_rank": 27
      },
      "28": {
        "chicken_count": 42,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_229",
        "queen_rank": 28
      },
      "29": {
        "chicken_count": 48,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_230",
        "queen_rank": 29
      },
      "3": {
        "chicken_count": 93,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_231",
        "queen_rank": 3
      },
      "30": {
        "chicken_count": 64,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_232",
        "queen_rank": 30
      },
      "31": {
        "chicken_count": 63,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_233",
        "queen_rank": 31
      },
      "32": {
        "chicken_count": 38,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_234",
        "queen_rank": 32
      },
      "33": {
        "chicken_count": 49,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_235",
        "queen_rank": 33
      },
      "34": {
        "chicken_count": 41,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_236",
        "queen_rank": 34
      },
      "35": {
        "chicken_count": 19,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_237",
        "queen_rank": 35
      },
      "36": {
        "chicken_count": 34,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_238",
        "queen_rank": 36
      },
      "37": {
        "chicken_count": 30,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_108",
        "queen_rank": 37
      },
      "38": {
        "chicken_count": 29,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_239",
        "queen_rank": 38
      },
      "39": {
        "chicken_count": 38,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_240",
        "queen_rank": 39
      },
      "4": {
        "chicken_count": 72,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_241",
        "queen_rank": 4
      },
      "40": {
        "chicken_count": 40,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_242",
        "queen_rank": 40
      },
      "41": {
        "chicken_count": 36,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_243",
        "queen_rank": 41
      },
      "42": {
        "chicken_count": 49,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_244",
        "queen_rank": 42
      },
      "43": {
        "chicken_count": 41,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_245",
        "queen_rank": 43
      },
      "44": {
        "chicken_count": 26,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_246",
        "queen_rank": 44
      },
      "45": {
        "chicken_count": 75,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_247",
        "queen_rank": 45
      },
      "46": {
        "chicken_count": 34,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_248",
        "queen_rank": 46
      },
      "47": {
        "chicken_count": 34,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_249",
        "queen_rank": 47
      },
      "48": {
        "chicken_count": 33,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_250",
        "queen_rank": 48
      },
      "49": {
        "chicken_count": 69,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_251",
        "queen_rank": 49
      },
      "5": {
        "chicken_count": 89,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_252",
        "queen_rank": 5
      },
      "50": {
        "chicken_count": 37,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_253",
        "queen_rank": 50
      },
      "51": {
        "chicken_count": 47,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_254",
        "queen_rank": 51
      },
      "52": {
        "chicken_count": 41,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_255",
        "queen_rank": 52
      },
      "53": {
        "chicken_count": 33,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_256",
        "queen_rank": 53
      },
      "54": {
        "chicken_count": 25,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_257",
        "queen_rank": 54
      },
      "55": {
        "chicken_count": 26,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_258",
        "queen_rank": 55
      },
      "56": {
        "chicken_count": 65,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_259",
        "queen_rank": 56
      },
      "57": {
        "chicken_count": 33,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_260",
        "queen_rank": 57
      },
      "58": {
        "chicken_count": 27,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_261",
        "queen_rank": 58
      },
      "59": {
        "chicken_count": 54,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_262",
        "queen_rank": 59
      },
      "6": {
        "chicken_count": 88,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_263",
        "queen_rank": 6
      },
      "60": {
        "chicken_count": 30,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_264",
        "queen_rank": 60
      },
      "61": {
        "chicken_count": 37,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_156",
        "queen_rank": 61
      },
      "62": {
        "chicken_count": 49,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_265",
        "queen_rank": 62
      },
      "63": {
        "chicken_count": 20,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_266",
        "queen_rank": 63
      },
      "64": {
        "chicken_count": 28,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_267",
        "queen_rank": 64
      },
      "65": {
        "chicken_count": 40,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_268",
        "queen_rank": 65
      },
      "66": {
        "chicken_count": 18,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_269",
        "queen_rank": 66
      },
      "67": {
        "chicken_count": 24,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_270",
        "queen_rank": 67
      },
      "68": {
        "chicken_count": 1,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_271",
        "queen_rank": 68
      },
      "69": {
        "chicken_count": 18,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_272",
        "queen_rank": 69
      },
      "7": {
        "chicken_count": 87,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_273",
        "queen_rank": 7
      },
      "70": {
        "chicken_count": 61,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_274",
        "queen_rank": 70
      },
      "71": {
        "chicken_count": 14,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_275",
        "queen_rank": 71
      },
      "72": {
        "chicken_count": 27,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_276",
        "queen_rank": 72
      },
      "73": {
        "chicken_count": 25,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_277",
        "queen_rank": 73
      },
      "74": {
        "chicken_count": 47,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_278",
        "queen_rank": 74
      },
      "75": {
        "chicken_count": 51,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_279",
        "queen_rank": 75
      },
      "76": {
        "chicken_count": 25,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_280",
        "queen_rank": 76
      },
      "77": {
        "chicken_count": 42,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_281",
        "queen_rank": 77
      },
      "78": {
        "chicken_count": 21,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_282",
        "queen_rank": 78
      },
      "79": {
        "chicken_count": 32,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_283",
        "queen_rank": 79
      },
      "8": {
        "chicken_count": 83,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_284",
        "queen_rank": 8
      },
      "80": {
        "chicken_count": 44,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_285",
        "queen_rank": 80
      },
      "81": {
        "chicken_count": 26,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_286",
        "queen_rank": 81
      },
      "82": {
        "chicken_count": 72,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_70",
        "queen_rank": 82
      },
      "83": {
        "chicken_count": 41,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_287",
        "queen_rank": 83
      },
      "84": {
        "chicken_count": 26,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_288",
        "queen_rank": 84
      },
      "85": {
        "chicken_count": 35,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_289",
        "queen_rank": 85
      },
      "86": {
        "chicken_count": 45,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_290",
        "queen_rank": 86
      },
      "87": {
        "chicken_count": 50,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_291",
        "queen_rank": 87
      },
      "88": {
        "chicken_count": 20,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_292",
        "queen_rank": 88
      },
      "89": {
        "chicken_count": 32,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_293",
        "queen_rank": 89
      },
      "9": {
        "chicken_count": 88,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_138",
        "queen_rank": 9
      },
      "90": {
        "chicken_count": 44,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_294",
        "queen_rank": 90
      },
      "91": {
        "chicken_count": 28,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_295",
        "queen_rank": 91
      },
      "92": {
        "chicken_count": 28,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_296",
        "queen_rank": 92
      },
      "93": {
        "chicken_count": 23,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_297",
        "queen_rank": 93
      },
      "94": {
        "chicken_count": 23,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_298",
        "queen_rank": 94
      },
      "95": {
        "chicken_count": 13,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_299",
        "queen_rank": 95
      },
      "96": {
        "chicken_count": 50,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_300",
        "queen_rank": 96
      },
      "97": {
        "chicken_count": 27,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_301",
        "queen_rank": 97
      },
      "98": {
        "chicken_count": 33,
        "is_vip": 1,
        "mmr_level": 38,
        "player": "steam_id_302",
        "queen_rank": 98
      },
      "99": {
        "chicken_count": 26,
        "is_vip": 0,
        "mmr_level": 38,
        "player": "steam_id_303",
        "queen_rank": 99
      }
    },
    "season": "_s43"
  }
}
```

#### `CustomNetTable_setting_table`

```json
{
  "show_settings": {
    "steam_id_7": {
      "is_auto_ai": 1,
      "is_auto_combine": 0,
      "is_click_select": 1,
      "is_fog_show": 1
    },
    "steam_id_6": {
      "is_auto_ai": 1,
      "is_auto_combine": 1,
      "is_click_select": 1,
      "is_fog_show": 1
    },
    "steam_id_5": {
      "is_auto_ai": 1,
      "is_auto_combine": 1,
      "is_click_select": 1,
      "is_fog_show": 1
    },
    "steam_id_4": {
      "is_auto_ai": 0,
      "is_auto_combine": 1,
      "is_click_select": 0,
      "is_fog_show": 1
    },
    "steam_id_3": {
      "is_auto_ai": 1,
      "is_auto_combine": 1,
      "is_click_select": 1,
      "is_fog_show": 1
    },
    "steam_id_2": {
      "is_auto_ai": 1,
      "is_auto_combine": 1,
      "is_click_select": 0,
      "is_fog_show": 1
    },
    "steam_id_1": {
      "is_auto_ai": 1,
      "is_auto_combine": 1,
      "is_click_select": 1,
      "is_fog_show": 1
    },
    "steam_id_0": {
      "is_auto_ai": 1,
      "is_auto_combine": 1,
      "is_click_select": 1,
      "is_fog_show": 1
    }
  }
}
```

Direct console batch 1/3 — core live/game tables:

```text
dumpstringtable CustomNetTable_dac_table cl verbose;dumpstringtable CustomNetTable_player_info_table cl verbose;dumpstringtable CustomNetTable_game_info cl verbose;dumpstringtable CustomNetTable_player_id_table cl verbose;dumpstringtable CustomNetTable_ranking_top_table cl verbose;dumpstringtable CustomNetTable_chess_pool_table cl verbose;dumpstringtable CustomNetTable_unit_table cl verbose
```

Direct console batch 2/3 — suspected gameplay/extra state tables:

```text
dumpstringtable CustomNetTable_match_history_table cl verbose;dumpstringtable CustomNetTable_hp_bar_table cl verbose;dumpstringtable CustomNetTable_quest_table cl verbose;dumpstringtable CustomNetTable_casino_table cl verbose;dumpstringtable CustomNetTable_hero_available_items cl verbose;dumpstringtable CustomNetTable_other_available_items cl verbose;dumpstringtable CustomNetTable_setting_table cl verbose
```

Direct console batch 3/3 — static/cosmetic/reference tables:

```text
dumpstringtable CustomNetTable_ability_kv_table cl verbose;dumpstringtable CustomNetTable_chess_kv_table cl verbose;dumpstringtable CustomNetTable_gems cl verbose;dumpstringtable CustomNetTable_hero_ethereals cl verbose;dumpstringtable CustomNetTable_hero_prismatic cl verbose;dumpstringtable CustomNetTable_hero_wearables cl verbose
```

```bash
cargo run --manifest-path app/backend/Cargo.toml -- parse-log <path-to-console.log>
cargo run --manifest-path app/backend/Cargo.toml -- parse-log-full <path-to-console.log>
cargo run --manifest-path app/backend/Cargo.toml -- parse-live <path-to-console.log> [local-steam-id]
```

## Supabase auth

Normal live capture uploads use the app's configured Supabase URL/key for processed `matches`, `match_players`, and `match_timelines` rows. Diagnostic logs upload to Supabase Storage bucket `diagnostic-logs`; raw nettable dump logs upload to `nettable_dump_upload_url`, which authenticates the desktop's Supabase session and writes to Cloudflare R2.
