# Drodo API Map

Base: `http://autochess.ppbizon.com`  
Source: `data/vscripts/scripts/vscripts/addon_game_mode.lua`

Auth: All protected endpoints require `&key=<GetDedicatedServerKey('drodo')>&key5=<GetDedicatedServerKeyV2('bsl,bgbxh')>` — Valve server-side crypto, not replicable from outside a real game server.

---

## Public (no auth)

### `GET /courier/get/@{steamId1,steamId2,...}`
Player profile lookup. Multiple IDs comma-separated.  
**Returns:** `user_info`, `notice`, `qq_list`  
`user_info` per player:
- `steam_id`, `mmr_level`, `mmr_s42/43`, `max_mmr_s42/43`, `match_s42/43`
- `queen_rank` when the player is currently ranked on the Queen ladder
- `zhugong` (couriers owned), `onduty_hero`, `onduty_chessboard`
- `chessboard_list`, `emotion_list`, `chicken_count`, `candy`, `biscuit`
- `award_season_mmr_level`, `award_available`, `vip_info`
- `zhugong_count`, `zhugong_total_count`, `is_author`

**Current omission (2026-07):** many accounts no longer receive `mmr_s*`,
`max_mmr_s*`, `match_s*`, or `queen_rank` on this public endpoint. Cache writes
must preserve prior season MMR when those keys are absent.

With auth the game also gets: `badgeall`, `match_history` (bundled inside `/game/new`).

#### `mmr_level` tier mapping

Drodo profile and nettable fields use numeric `mmr_level` values for broad tier labels. Queen is open-ended: `38`, `39`, etc. all mean the player is in the Queen tier; they are not Queen ladder positions. Use `queen_rank` for the player's current Queen leaderboard rank when present.

```js
function tierLabel(level) {
  if (level > 37) return "Queen";
  if (level == 37) return "King";
  if (level >= 28) return "Rook-" + (level - 27);
  if (level >= 19) return "Bishop-" + (level - 18);
  if (level >= 10) return "Knight-" + (level - 9);
  if (level >= 1) return "Pawn-" + level;
  return "Unranked";
}
```

---

### `GET /lineup/get?hehe={random}&from=InitHeros&difficulty={n}`
Live winning board snapshots from solo games in progress. One entry per round slot (rounds 4–70, skipping PvE rounds). Called at game start for single-player mode only.

`difficulty` param changes what's returned:
- `difficulty=2` → 60 entries
- `difficulty=3` → 57 entries  
- `difficulty=0/1/4/5` → 53 entries

Per entry:
- `round`, `owner` (steamId), `result` (always "win"), `population`
- `chess` (comma-separated unit IDs), `synergy`, `talent`
- `lineup[]` → `{chess, x, y, lastitem[]}`
- `courier`, `zhugong`

This is what `/lineup/v2/add` writes to (game servers push winning boards here).

---

### `GET /shop/v5/courier/getall/@{steamId}`
Player's full cosmetic inventory.  
**Returns:** `all_courier_list`

---

### `GET /lineup/str/get?key={shareCode}`
Import a shared lineup by share code. Code is generated in-game by a player.  
**Returns:** `data` (JSON lineup string, or null if key invalid)

---

## Auth Required (Valve server key)

### `GET /game/new/@{steamId1,steamId2,...}?...&key=...&key5=...`
Called at game start. Passes all player steamIds.  
**Returns:** per-player `user_info` including `match_history`, plus `game_version`, `casino_info`, `chess_pool`.  
**DO NOT CALL** — starts a server-side game session.

---

### `GET /game/post/one/@{allSteamIds}@{playerSteamId}@{rank}?...&key=...`
Called at game end, once per player. Submits result.  
**Sends:** `duration`, `chess_lineup`, `synergy`, `population`, `total_money`, `win_round`, `lose_round`, `relic_history`, `onduty_courier`, `onduty_chessboard`, `max_lineup_value`, `mvp_chess_name/damage/items`, `pandaman_getlist`, `settings`, `mode`, `map`  
**Returns:** `mmr_info` (new rank/level/candy), `lineup_info`  
**DO NOT CALL** — writes match result to Drodo's DB and is how match_history is built.

---

### `GET /lineup/v2/add?lineups={data}&bans={bans}&mmr_level={n}&key=...`
Uploads current winning lineups from a game. This is the write side of `/lineup/get`. Called when rank=1 in solo mode.

### `GET /lineup/add?lineups={data}&mmr_level={n}&key=...`
Older version of above, used in 2P mode.

---

### `GET /ranking/top` + auth
Leaderboard. Requires auth — 404 without it.

### `GET /ranking/get?...` + auth (partially)
Returns error without correct params — expects something it can `.split()`.

### `GET /award/get/@{steamId}` + auth
Season awards for a player.

### `GET /award/ti14/@{steamId}` + auth
TI14 bet award claim.

### `GET /award/casino/@{steamId}` + auth
Casino award claim.

### `GET /shop/v5/get/@{steamId}` + auth
Shop contents refresh.

### `GET /shop/v5/buy/@{steamId}@{item}` + auth
Purchase item.

### `GET /shop/v5/collect/@{steamId}@{courierId}` + auth
Collect/jihuan a courier.

### `GET /shop/v5/lottery/@{steamId}` + auth
Run lottery.

### `GET /shop/v5/recycle/courier/@{steamId}@{courierId}` + auth
Recycle a courier.

### `GET /courier/change/@{steamId}@{courierId}` + auth
Set active courier.

### `GET /chessboard/change/@{steamId}@{chessboardId}` + auth
Set active chessboard.

### `GET /courier/merge/@{steamId}@{courierId}` + auth
Merge couriers.

### `GET /cdkey/act/@{steamId}@{cdkey}` + auth
Activate a CD key.

### `GET /vip/vote` + auth
VIP vote.

### `GET /bet/ti14` + auth
Place a TI14 bet.

---

## AWS Kinesis (write-only, game server → AWS)

Stream: `kinesis.cn-north-1.amazonaws.com.cn`  
Stream name: `report_reciver`  
Credentials AES-encrypted with `GetDedicatedServerKeyV2('fgnb')`.

Called at game end. Payload (deflate-compressed, base64-encoded):
- `version`, `ticket`, `map_name`, `end_time`, `duration`
- `legendary_list` (5-cost units), `relic_list`
- `players[]`: `account_id`, `rank`, `total`, `level`, `candy`, `biscuit`, `chess`, `win_round`, `lose_round`, `kills`, `deaths`, `gold`, `duration`, `total_money`, `ban_synergy`, `relic_history`, `chess_item`, `talent_tree`
- `chess_detail`

This is Drodo's analytics pipeline. No read access.

---

## Commented Out / Disabled

- `/error/catch` — server error logging (disabled)
- `/shop/v4/*` — old v4 shop endpoints (deprecated, replaced by v5)
- `https://gtf.ai.xingzheai.cn/v2.0/game_chat_ban/detect_text` — chat ban AI
- `http://api.xiaoheihe.cn/api/rpg/autochess/report_match_start/` — Xiaoheihe integration
- `https://autochess.ppbizon.com/cheat/report` — cheat reporting (HTTPS, auth required)

---

## Summary

| What we can read | How |
|---|---|
| Player profile + season stats | `/courier/get/@{steamId}` |
| Live winning boards (solo games) | `/lineup/get` |
| Player cosmetic inventory | `/shop/v5/courier/getall/@{steamId}` |
| Shared lineup by code | `/lineup/str/get?key={code}` |
| Match history | Only returned inside `/game/new` (auth required) — no standalone read endpoint |
| Leaderboard | Auth required |
| Full match data | Write-only (game server → `/game/post/one` + Kinesis) |
