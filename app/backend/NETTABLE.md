# NetTable Capture

Captures Drodo's CustomNetTable broadcasts (queen ladder, post-game
`end_board`, live player snapshots, player_id ↔ team mapping) locally first,
then uploads the processed match representation to Supabase.

## How it works

1. Dota launches with `-condebug -conclearlog` in launch options. `condebug`
   tees the in-game console to `<dota>/game/dota/console.log`;
   `conclearlog` truncates it at each launch, so ingest is idempotent
   across sessions.
2. On app startup, `nettable_capture.NetTableCapture` updates a marked DAC
   Tracker block inside `<dota>/game/dota/cfg/autoexec.cfg`. If the user has
   their own autoexec, it appends/replaces only our marked block and preserves
   the rest of the file.
3. The capture module tails `console.log` and sends key presses to the Dota
   HWND (via `SendInput`) on these cadences:
   - **Every 2s**: F23 (`game_info` — round/death tracking)
   - **On round change**: F22 (`player_info_table`) + F20 (`player_id_table` — slot/board metadata refresh)
   - **Once at match/session opening**: F24 (`ranking_top_table` + `player_id_table`) then F16 (`chess_pool_table`)
   - **On POST_GAME**: burst of F21 to capture `end_board`
4. Each key fires a single `dumpstringtable` command; the engine writes
   binary VBKV payloads into console.log.
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
   for 2s), decodes them via `nettable_parser.parse_log`, archives raw
   dumps locally under `~/.dac/captures/sessions/`, and processes them
   in-memory into `matches`, `match_players`, and `match_timelines`. Raw
   `dac_nettable_dumps` uploads are debug opt-in only.

## Active capture matrix / key binds

All binds use extended F-keys (F20-F25) plus F16 to avoid conflicting with
normal user keyboard shortcuts. Most binds dump one table. F24 deliberately
dumps `ranking_top_table` and `player_id_table` together so the one-time lobby
metadata snapshot includes both the Queen ladder and the slot mapping.

| Key | Table(s) | Automatic trigger / cadence | Important keys | What it means / what we use it for | Raw-upload storage filter |
|---|---|---|---|---|---|
| F21 | `dac_table` | POST_GAME burst only | `end_board`, `player_info`, `user_panel_ranking`, `show_all_player_connect_status`, sometimes `stat_chess`, `game_over` | Main game-wide table, now captured only at the end because `end_board` is the important part. In observed same-second live dumps, `dac_table.player_info` was mostly default/stale, so continuously polling it was noise. Prefer `player_info_table.player_info` for current player state. | Kept. |
| F22 | `player_info_table` | On round change | `player_info` | Dedicated current player-state table: HP, gold, level, lineup, bench/hand, synergies, damage, rank, relic, talent tree, MMR/candy fields, etc. In same-second diffs, this is the table with the real current/final values while `dac_table.player_info` is mostly defaults. Round-change capture lines this up with the review UI's per-round view. | Kept. |
| F23 | `game_info` | Every 2s | `round_info`, `death_team`, `game_version`, `quest` | Cheap live heartbeat. `round_info.round` triggers heavier F22/F20 snapshots once per round. `death_team` maps team IDs to elimination bits and is used to detect when the local player dies before the whole lobby ends. | `round_info` and `death_team` kept. `game_version` and `quest` dropped from raw Supabase uploads. |
| F20 | `player_id_table` | On round change | `player_<n>`, `vchess_<n>`, `relic_ttl_<n>`, `mmr_level_<n>`, `courier_<n>`, `chessboard_<n>` | Per-slot state. `player_<n>` maps lobby slots/team IDs/hero indexes. `vchess_<n>` is the board grid state for that slot: unit IDs/names, board coordinates, items, water IDs, etc. `relic_ttl_<n>` is active relic + remaining duration. `mmr_level_<n>` is rank/candy baseline. | `player_*`, `vchess_*`, `relic_ttl_*`, and `mmr_level_*` kept. Cosmetic `courier_*` and `chessboard_*` dropped from raw Supabase uploads. |
| F24 | `ranking_top_table` + `player_id_table` | Once at match/session opening | `ranking_top`; plus the `player_id_table` keys above | One-shot lobby metadata. `ranking_top_table` normalizes into public Queen ladder/profile rank rows; the paired `player_id_table` gives an early steam_id → slot/team mapping before the first round snapshot. | Kept; `player_id_table` key-level filter still applies. |
| F16 | `chess_pool_table` | Once at match/session opening, immediately after F24 | `ban_info`, `ban_info_<n>`, `legendary_info`, `relic_list`, `destroy_info`, `chess_list_by_mana`, `chess_list_by_synergy`, `revealed_legendary_chess_list`, `unrevealed_legendary_chess_list`, static/reference list keys | Lobby pool metadata. Local raw dumps keep the whole one-shot table. The processed timeline currently extracts `ban_info_<n>` and `revealed_legendary_chess_list`; `relic_list`, `legendary_info`, `destroy_info`, and static reference lists are raw-only today unless we add explicit processed fields. | Kept. The old plan proposed dropping several static keys, but current code keeps the table because it is one-shot and useful for debugging patch/data drift. |
| F25 | `unit_table` | Bound only; not automatically fired | `egg_*` and/or unit entries depending on game state | Manual debugging only. It is not part of the normal capture cadence, so it should not appear unless someone presses F25 or runs a manual dump. | Kept if manually uploaded, but normally absent. |

## Files

| File | Role |
|---|---|
| `nettable_capture.py` | Autoexec install, log tailer, key sender, match extraction, timeline, event emits, ingest helpers. |
| `nettable_parser.py` | Pure VBKV decoder (`parse_vbkv`) and console.log walker (`parse_log`). |
| `main.py ingest-nettable` | CLI fallback for manual ingest when the app daemon isn't running. |
| `headless.py` | Instantiates `NetTableCapture(self._emit)` and runs its tailer thread. |

`AUTOEXEC_CFG_CONTENT` is the marked DAC Tracker cfg block, inlined as a
constant in `nettable_capture.py` — single source of truth. The installer
upserts that block instead of replacing the user's whole `autoexec.cfg`.

## Events emitted (consumed by `useNetTableEvents` in the renderer)

```ts
{ type: "nettable_status", autoexec_installed: bool, log_path: str, log_writable: bool, dota_dir: str }
{ type: "nettable_dump_captured", tables: string[], at: ISO_string }
{ type: "nettable_ingest_complete", rows_written: number, tables: string[], at: ISO_string }
{ type: "nettable_ingest_error", error: string }
{ type: "nettable_end_board_saved", at: ISO_string }
{ type: "nettable_partial_match_saved", match_id: string, capture_status: string, verification_source: string, at: ISO_string }
```

## What gets captured

Raw dumps are stored locally as gzipped JSONL. Normal Supabase writes use the
processed `matches`, `match_players`, `match_timelines`, and Queen ladder
profile rows. `dac_nettable_dumps` is only written when
`upload_raw_nettable_dumps` is enabled.

The storage filter is intentionally only at the raw-upload boundary. The
in-memory live state and local raw archive still receive the full decoded dump.

### Known DAC nettables not currently captured by the app

These showed up in older VPK/triage notes, but they are not in the current
automatic key cadence. If we need one later, add an explicit bind/cadence and
document why.

| Table | Current status | Notes |
|---|---|---|
| `match_history_table` | Not currently bound/captured | Previously investigated and observed to be empty in practice, so we do not treat it as a useful source unless a future patch proves otherwise. |
| `hp_bar_table` | Not currently bound/captured | Likely duplicates HP fields already present in player state. Still an open question if it adds cleaner live HP. |
| `quest_table` | Dropped if encountered | Battle-pass/quest noise. Entire table is excluded from raw Supabase upload. |
| `casino_table` | Dropped if encountered | Pass/minigame noise. Entire table is excluded from raw Supabase upload. |
| `hero_available_items`, `other_available_items` | Not currently bound/captured | In-game available-item UI state; not used by the tracker. |
| `ability_kv_table`, `chess_kv_table` | Not currently bound/captured | Static definitions better sourced from scraper/VPK data. |
| `gems`, `hero_ethereals`, `hero_prismatic`, `hero_wearables` | Not currently bound/captured | Cosmetic data. |
| `setting_table` | Not currently bound/captured | UI/settings state. |

### Current raw-upload storage filter

This is the implemented filter in `nettable_capture.py`, not a proposal:

```text
Drop entire tables from raw Supabase upload:
- quest_table
- casino_table

Drop keys by prefix from raw Supabase upload:
- player_id_table.chessboard_*
- player_id_table.courier_*
- game_info.game_version
- game_info.quest

Keep everything else.
```

Local `raw_dumps.jsonl.gz` archives are not filtered. The filter only affects
optional raw writes to `dac_nettable_dumps`; processed match/timeline/profile
uploads use the in-memory decoded state.

### Open questions / current answers

| Question | Current answer |
|---|---|
| Is `player_info_table.player_info` different from `dac_table.player_info`? | Yes. In a same-second diff from `20260604_230953`, both tables had the same 8 Steam IDs, but `dac_table.player_info` was mostly default/stale for live stats while `player_info_table.player_info` had the real current values. Prefer `player_info_table` for current player state; use `dac_table` mainly for `end_board`, `user_panel_ranking`, and connection status. |
| Should `player_id_table.vchess_*` be dropped as an unknown VCHESS thing? | No. We now know this is the board-state table: unit entries keyed by board coordinates, with unit name/id/items/other per-piece fields. Keep it. |
| Do we need `mmr_level_*`? | Keep for now. It gives rank/candy baseline by slot and is small. |
| Is `death_team` redundant with HP or destroy info? | Maybe, but it is the cleanest local-player-death signal we currently have, so keep it. |
| Does `hp_bar_table` add anything over `player_info.hp`? | Unknown because it is not currently captured. If HP timing is bad, this is the first table to test. |
| Do we need static `chess_pool_table` lists like `chess_list_by_mana`? | Not for normal processing, because scraper/VPK data is the source of truth. Current code still keeps them in the one-shot local/raw capture because the table is not polled repeatedly and it can expose patch drift. |
| Do we store the chess-pool relic list in processed match data? | Not currently. `chess_pool_table.relic_list` is present in local/raw dumps, but processed player/timeline rows use active per-player relic state from `player_id_table.relic_ttl_<n>`. |

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

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = '<sb_secret_...>'
cd app/backend
python main.py ingest-nettable --dry-run        # parse-only
python main.py ingest-nettable                   # write
python main.py ingest-nettable --only dac_table  # filter
```

Bare names in `--only` get the `CustomNetTable_` prefix auto-prepended.

## Supabase auth

Normal live capture uploads use the app's configured publishable Supabase key
for processed `matches`, `match_players`, and `match_timelines` rows. Raw
`dac_nettable_dumps` writes are disabled by default; if a developer explicitly
enables `upload_raw_nettable_dumps`, raw writes still require a service-role key:

- Export `SUPABASE_SERVICE_ROLE_KEY` in the environment the app inherits, or
- Replace `supabase_key` in `~/.dac/config.json` with the service-role
  key (not recommended).
