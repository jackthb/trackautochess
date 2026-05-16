# NetTable Capture Triage

Decide what's worth capturing. Categories:

- **KEEP** — core data for post-match review
- **DROP** — noise, static, cosmetic, or already in UI
- **TBD** — needs a real 8-player game to evaluate

Mark whichever you disagree with and I'll wire up the filters.

---

## Top-level tables

| Table | Decision | Why |
|---|---|---|
| `ranking_top_table` | **KEEP (once)** | Top-100 Queen ladder snapshot. ~79 KB. Capture once per session, dedupe handles the rest. |
| `match_history_table` | **KEEP** | Highest-value table. Per-player historical games. Truncated to `…_tab` by Source 2 (fix already in). |
| `dac_table` | **KEEP (selective)** | Game-wide state. See per-key triage below — has both important and useless keys. |
| `game_info` | **KEEP (round only)** | Use it as the round-change poll signal. See per-key triage. |
| `player_id_table` | **KEEP (selective)** | Per-slot data, keys end `_0` … `_7`. Some keep, some drop. |
| `player_info_table` | **TBD** | One key (`player_info`), ~2 KB. Possibly a duplicate of `dac_table.player_info`. Need an 8-player capture to compare. |
| `unit_table` | **DROP** | Only contains `egg_*` keys — static unit/egg definitions, same every game. |
| `chess_pool_table` | **DROP** | Live shop pool — you flagged this as "cheating at that stage." |
| `hero_available_items` / `other_available_items` | **DROP** | Already shown in the in-game UI. |
| `ability_kv_table` / `chess_kv_table` | **DROP** | Static piece + ability definitions, scrape once if ever needed. |
| `casino_table` | **DROP** | Pass-only minigame. |
| `quest_table` | **DROP** | Pass-only quest tracking. |
| `gems` / `hero_ethereals` / `hero_prismatic` / `hero_wearables` | **DROP** | Cosmetics. |
| `hp_bar_table` | **TBD** | Probably duplicates HP data already in `player_info`. |
| `setting_table` | **DROP** | UI setting state. |

---

## `dac_table` keys

(All keys discovered from the VPK; not all populated in every game)

| Key | Decision | Why |
|---|---|---|
| `player_info` | **KEEP** | Per-player full info — 40+ fields each. In an 8-player game this has everyone's hp / candy / kills / mmr_level / zhugong / talent_tree / lineup_value / etc. The core post-match data. |
| `end_board` | **KEEP** | Final placement & stats per player, populated at `POST_GAME`. The post-match-review payoff. |
| `user_panel_ranking` | **KEEP** | Live in-match rank per steam_id (`curr_rank: N`). Updates as players die — needed for "who was leading at round X". |
| `stat_chess` | **TBD** | Per-piece stat tracking. Possibly redundant with `player_info.chess_lineup`. |
| `show_all_player_connect_status` | **TBD** | DC-detection: slot → connected (1/0). Worth keeping if you want "Player 4 DC'd round 18" in the review. |
| `game_over` | **KEEP** | Probably a boolean flip on end-game. Cheap to capture. |
| `cdkey` | **DROP** | Promo code state. |
| `curtain_tips` | **DROP** | Loading-screen tips. |

---

## `game_info` keys

| Key | Decision | Why |
|---|---|---|
| `round_info` | **KEEP** | `{round: N}` — the trigger for "round changed, capture everything else." |
| `death_team` | **TBD** | `{6:0, 7:0, …}` — alive/dead per team_id. May already be derivable from `player_info.hp` or `user_panel_ranking`. Cheap to keep though. |
| `quest` | **DROP** | Pass biscuit-quest state. |
| `game_version` | **DROP** | Static `"dist"`. Nonsense. |

---

## `player_id_table` keys (`_N` for slots 0–7)

| Key | Decision | Why |
|---|---|---|
| `vchess_N` | **KEEP** | Full board state — units, positions, items, water tiles. **The decision-making record.** 2 KB per player; in 8-player games this dominates volume but it's the whole point. |
| `relic_ttl_N` | **KEEP** | Current relic + rounds remaining. Decisions around relic windows matter. |
| `player_N` | **TBD** | `{team_id, player_id, hero_index, player_index}` — slot-to-team mapping. Static within a game but needed to join other tables. Capture once at game start. |
| `mmr_level_N` | **TBD** | Candy + mmr_level. You said "not too useful," but mmr_level identifies player skill tier — useful for the review tool to calibrate analysis. Suggest **KEEP once at game start**. |
| `courier_N` | **DROP** | Level, courier skin, win_streak. Cosmetic + courier level is derivable from round + hp. |
| `chessboard_N` | **DROP** | Chessboard cosmetic skin. |
| `badge_N` | **DROP** | Player badge cosmetic. |

---

## Cadence proposal

Three capture modes:

1. **Once at game start** (T+30s after `GAME_IN_PROGRESS`):
   - `ranking_top_table.ranking_top` (top-100 ladder snapshot)
   - `player_id_table.player_N` (slot→team mapping)
   - `player_id_table.mmr_level_N` (skill tier baseline)
   - `match_history_table.match_history_N` (one row per player per game)

2. **Every 20s while in-game** (round-driven poll):
   - `game_info.round_info` (cheap trigger)
   - If `round` changed since last successful capture → capture the dynamic set:
     - `dac_table.player_info`
     - `dac_table.user_panel_ranking`
     - `dac_table.game_over`
     - `game_info.death_team`
     - `player_id_table.vchess_N`
     - `player_id_table.relic_ttl_N`

3. **Once 5s after `POST_GAME`**:
   - Re-capture dynamic set (final state)
   - `dac_table.end_board`
   - `dac_table.stat_chess`

In practice the existing dump-all-then-dedupe handles this correctly today — the alternative is splitting `DUMP_COMMAND` into three smaller commands (one per mode). Splitting cuts the per-poll cost of dumping ~85 KB to ~10 KB, but adds three console-typing flows to manage. Recommend keeping the single `dumpstringtable all` approach and trusting dedupe.

---

## Open questions for an 8-player run

- Is `player_info_table.player_info` actually different from `dac_table.player_info`?
- Are `dac_table.stat_chess` and `dac_table.show_all_player_connect_status` worth the bytes?
- Does `dac_table.game_over` flip cleanly at game end, or is it always `0` then never set?
- Does `hp_bar_table` add anything over `player_info.hp`?

Mark these once you've had a real game captured.

---

## Round / game-end signals (research)

Searched DAC's VPK for round-end / game-end events. **None exist as dedicated tables.** The only signals are:

- **Round changes**: `SetTableValue("game_info", "round_info", { round = _G.battle_round })` — Lua updates `round_info` whenever `battle_round` increments. That's the only way to know rounds advanced. No `round_end` event in `console.log` either.
- **Game end**: `SetTableValue("dac_table", "end_board", { data = _G.stat_info, hehe = ... })` — populated once at game end with the full final stat dump.
- **`game_ended`** appears as a Lua local variable but is not a netTable key.
- `match_history_table` is rewritten post-game with the new entry appended.

### Per-round vs post-game-only — the trade

| | Per-round capture loop (current) | Post-game-only (just match_history + end_board) |
|---|---|---|
| Final placement | ✅ | ✅ |
| Total candy / mmr change | ✅ | ✅ |
| Final lineup | ✅ | ✅ (probably — verify in 8p game) |
| **Round-by-round board state** | **✅ via `vchess_N` snapshots** | **❌** |
| **Identify decision points** (missed unit, bad sell timing, rotation errors) | **✅** | **❌** |
| Capture cost | ~85 KB × 50 rounds = ~4 MB / game (mostly dedup'd to ~300 KB) | ~30 KB total |

**Verdict:** If the goal is the TFT-style "this was a blunder" review tool, per-round is non-negotiable. The match_history table only has the outcome, not the decisions that led there.

### Caveat about other-player visibility

The user-flagged concern: when the local client doesn't have full info on other heroes' lineups (server only ships what the player can see), our per-round `vchess_N` snapshots may be empty for opponents. Need an 8-player capture to confirm — if opponents' `vchess_N` is `nil` or empty client-side, the decision-review tool will only work for the local player's own play. Still useful (you can review your own decisions), just less than the TFT tool can do.
