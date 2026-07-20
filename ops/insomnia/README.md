# Insomnia — Drodo API only

Import `dac-drodo-mmr.json`:

1. Insomnia → **Import** → **From File**
2. Open **Base Environment**, set `steam_id` if you want

## Requests

| Request | Notes |
| --- | --- |
| `/courier/get/@{steamId}` | Profile — check for missing `mmr_s*` |
| `/courier/get/@{id1,id2}` | Batch |
| `/shop/v5/courier/getall/@{steamId}` | Cosmetics |
| `/lineup/get` | Live win boards |
| `/lineup/str/get` | Share-code import |
| `/ranking/top` | Needs auth — usually 404 |

Auth-only write routes (`/game/new`, `/game/post/one`, …) are **not** included — Valve server keys only.
