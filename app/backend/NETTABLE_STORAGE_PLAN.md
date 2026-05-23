# NetTable Storage Filter — Plan

Deferred work. We're storing way more rows than we need to. The cascade captures the full nettable state every ~15s; most of it is static reference data we already have from the VPK extraction, or per-slot fluff we don't care about.

**Strategy:** filter at the **storage boundary only** — not at capture. The in-memory `_last_state` (live debug view + warm-start) still sees everything. We just stop writing the noise to:

- `~/.dac/nettable_dumps/<ts>.json` (local dump files)
- `dac_nettable_dumps` table in Supabase

Implementation lives in `nettable_capture.py`. Apply the denylist before the `LOCAL_DUMPS_DIR / ...write_text(...)` call and before `insert_dumps(client, changed_rows)`. Do not apply at `extract_rows()` — in-memory consumers (slot mapping, live view) need the full set.

## Drop

Confirmed throwaway — either static (we have it from VPK), unused, or boring per-slot metadata.

| Table | Key | Notes |
|---|---|---|
| `player_id_table` | `chessboard_*` | board cosmetic ID (e.g. `b101`), useless |
| `player_id_table` | `courier_*` | tracks win streak, don't care |
| `player_id_table` | `vchess_*` | unknown V-chess thing, drop |
| `player_id_table` | `mmr_level_*` | numeric rank, don't care |
| `game_info` | `game_version` | drop |
| `game_info` | `quest` | drop |
| `chess_pool_table` | `synergy_info` | duplicates `chess_list_by_synergy` |
| `chess_pool_table` | `food_list` | static reference |
| `chess_pool_table` | `item_list_by_mana` | static |
| `chess_pool_table` | `item_level_list` | static |
| `chess_pool_table` | `chess_list_by_mana` | static (all units by cost) |
| `chess_pool_table` | `chess_list_by_mana_black` | static (undeads) |
| `chess_pool_table` | `chess_list_by_mana_special` | static |
| `chess_pool_table` | `chess_list_by_synergy` | static (units grouped by synergy — VPK knows this) |
| `chess_pool_table` | `chess_list_by_synergy_black_and_pandaman` | static |
| `chess_pool_table` | `chess_list_by_synergy_ban_unavailable` | static |
| `chess_pool_table` | `chess_rm_class` | unknown, drop |
| `quest_table` | * | drop entire table |
| `casino_table` | * | drop entire table |

## Keep

Match-specific data, or stuff we use downstream.

| Table | Key | Why |
|---|---|---|
| `dac_table` | `player_info` | live state |
| `dac_table` | `end_board` | post-game record |
| `dac_table` | `user_panel_ranking` | per-match ranking panel |
| `dac_table` | `show_all_player_connect_status` | who's still connected |
| `game_info` | `round_info` | round tracking |
| `unit_table` | * | egg state — `{ chess: 'chess_x', count: N }` per egg |
| `chess_pool_table` | `legendary_info` | active legendaries this match |
| `chess_pool_table` | `revealed_legendary_chess_list` | revealed over time |
| `chess_pool_table` | `unrevealed_legendary_chess_list` | the Hidden Legendaries view |
| `chess_pool_table` | `relic_list` | **per-match** relic pool (17 relics this game), NOT a global static list |
| `chess_pool_table` | `destroy_info` | which pieces have been eliminated from each player's lineup this match |
| `chess_pool_table` | `ban_info` | per-lobby pick-bans — match-specific, not from VPK |
| `chess_pool_table` | `ban_info_<N>` | per-player pick records |
| `player_info_table` | `player_info` | aggregate state |
| `ranking_top_table` | * | queen ladder |
| `hp_bar_table` | * | live HP |

## Still uncertain

| Table | Key | Question |
|---|---|---|
| `player_id_table` | `player_<n>` | This is the **slot → steam_id mapping**. Live ingest uses it in-memory; if we drop it, can't re-ingest a match from local dumps later. Default: keep. |
| `game_info` | `death_team` | Slot-elimination tracker; might be redundant with `chess_pool_table.destroy_info`. Need to compare on a real match. Default: keep both for now, dedup later. |

## What is NOT in the nettables

- **Board position (x, y) of placed units** — not exposed. `unit_table` only has `egg_*` → `{ chess, count }`. `chessboard_*` is just the cosmetic board ID. No grid coords anywhere in the cascade. Would need a different capture mechanism (parse from the world entity feed, hook the panorama UI, or screenshot OCR).
- **Live opponent benches** — only what's on their visible board state via `dac_table.player_info` data, and even that is current-tick HP/lineup, not their bench.

## Process notes

- User reviewed every captured key during a live match on 2026-05-23 and called out which felt useful vs noise.
- User explicitly said: do NOT alter in-memory capture for now. Filter only at the storage write boundary. In-memory cleanup is a separate, lower-priority follow-up.
- ban_info: user initially said "we know from VPK" — but the actual per-lobby bans (which synergy each player banned at draft) is match-specific. Sample dump confirms it varies per match. Flipped to keep.
- relic_list: user initially called it "just a list of the relics" but later asked "which relics are in the game?" — the captured data is the per-match relic pool (17 entries, varies per game). Flipped to keep.
- destroy_info: belongs to `chess_pool_table`, not game_info. This is what user meant by "Destroy info — yep, keep that."
