# DAC NetTable Dump

Capture useful CustomNetTable values that Drodo's dedi pushes to every client
during a DAC game, write them to Supabase as raw JSON. No auth keys involved
— this is data the dedi already broadcasts in the clear to every player in
every lobby.

Source-side reference: `data/vscripts/scripts/vscripts/addon_game_mode.lua`.
Drodo endpoint map: `data/drodo-api.md`.

## What gets captured

| NetTable | Key(s) | What's in it |
|---|---|---|
| `ranking_top_table` | `ranking_top` | Full queen ladder (`ranking_info`) + `leaderboard_info` sub-categories. Lua line 3144-3172. |
| `match_history_table` | `match_history_<player_id>` | Per-lobby-player match history. Lua line 3088 — copied out of the `/game/new` `user_info` blob and broadcast. |
| `dac_table` | `player_info` | `_G.stat_info` for all 8 players, includes `queen_rank`. Lua line 3102. |
| `dac_table` | `end_board` | Final placements / stats — only set at game end (Lua line 5227, `PostGame`). |
| `dac_table` | `user_panel_ranking` | In-match rank panel data (Lua line 3813). |
| `player_id_table` | `player_<i>` | `player_id` ↔ `team_id` ↔ `hero_index` mapping for the current lobby (Lua line 14492). |
| `__synth__` | `lobby_steam_ids` | Synthesized client-side from `Players.GetSteamAccountID` — the link from `player_id` to actual Steam accounts. **`steam_account_id` is 32-bit; SteamID64 = `steam_account_id + 76561197960265728`.** |

All of it lands in `dac_nettable_dumps(table_name, key, raw, captured_at)`.
Once we've validated the shapes against real data we can carve indexed
columns off `raw` (or build a `match_history` view, etc.) — until then
everything stays in jsonb.

## Pieces

- `panorama/dac_dump.js` — panorama hook that subscribes + polls and emits
  one `DAC_NETTABLE_DUMP_BEGIN ... END` line per unique payload to
  `console.log`.
- `ingest.py` — scans `console.log`, dedupes by exact-payload, inserts into
  `dac_nettable_dumps`.
- `../../supabase/migrations/20260509120000_create_dac_nettable_dumps.sql` —
  schema.

## One-time setup

1. **Apply the migration** to your Supabase project (same flow as every
   other migration in `supabase/migrations/`).

2. **Install the panorama hook into the DAC custom game.** This is the
   one fiddly step because Source 2 ships custom games as VPKs.

   a. Find the DAC VPK. `tools/extract_vscripts.py` already locates it —
      same `STEAM_PATHS` / workshop ID `1613886175`.

   b. Extract its `panorama/scripts/` and `panorama/layout/` trees with
      [VRF / Source2Viewer-CLI](https://github.com/ValveResourceFormat/ValveResourceFormat).

   c. Drop `panorama/dac_dump.js` from this directory into the extracted
      tree at `panorama/scripts/custom_game/dac_dump.js`.

   d. Pick any panel `.xml` that's loaded both in-lobby and in-game (the
      root HUD or a permanent overlay panel) and add to its `<scripts>`
      block:

      ```xml
      <include src="file://{resources}/scripts/custom_game/dac_dump.js" />
      ```

   e. Point Dota at the override tree by adding to launch options:

      ```
      -insert_search_path "<path-to-extracted-tree>" -condebug
      ```

      `-condebug` is what makes `$.Msg(...)` calls land in
      `<dota>/game/dota/console.log`.

   Use a throwaway Steam account. VAC isn't active for custom games, but
   modified client files are still your-account risk; isolate the blast
   radius.

3. **Make sure `~/.dac/config.json`** has `supabase_url` and
   `supabase_key`. The migration only opens SELECT to anon; use the
   service role key for writes.

## Run

1. Launch Dota (with the override + `-condebug`).
2. Start a DAC game on the throwaway. Most data lands at `/game/new`
   resolution (~30s after lobby load); `end_board` only lands when you
   play through to game over.
3. Quit out (or play through if you want `end_board`).
4. `python tools/dac_dump/ingest.py`

   Optional flags:
   - `--dry-run` — count what would be written per table, no DB writes.
   - `--only ranking_top_table,match_history_table` — allowlist.
   - `--log <path>` — override auto-detection.

`console.log` is appended across sessions, so the ingester sees historic
dumps too. Same exact JSON payload is deduped before the first write,
but the DB itself has no uniqueness — running the ingest twice on the
same log will insert duplicates. Either delete `console.log` before each
session or use a one-shot import-then-rotate flow.

## Querying

```sql
-- Latest ladder snapshot
SELECT raw
FROM dac_nettable_dumps
WHERE table_name = 'ranking_top_table' AND key = 'ranking_top'
ORDER BY captured_at DESC
LIMIT 1;

-- All lobby steam_id mappings ever captured
SELECT captured_at, raw
FROM dac_nettable_dumps
WHERE table_name = '__synth__' AND key = 'lobby_steam_ids'
ORDER BY captured_at DESC;

-- Match history blobs per player_id
SELECT key, raw
FROM dac_nettable_dumps
WHERE table_name = 'match_history_table'
ORDER BY captured_at DESC;
```

Once we've seen real shapes we can promote useful fields out of `raw`
into indexed columns (or a parsed-snapshots table, like
`mmr_snapshots`).

## Future automation

- Watch `console.log` from the Electron app while the user plays normally
  and ingest in the background — covers the local user without a
  throwaway-account flow, and we get fresh data every time the user
  starts a DAC game.
- Once the queen ladder shape is confirmed, add a parsed-snapshots view
  on top of `dac_nettable_dumps` filtered to
  `(table_name='ranking_top_table', key='ranking_top')`.
