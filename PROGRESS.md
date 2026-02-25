# dac-tools Progress Tracker

## Project Structure

```
dac-tools/
├── analyzer/       Python VOD analyzer CLI
├── scraper/        Puppeteer scraper for autochess.site
├── tracker/        Hotkey game tracker (end-of-game screenshot → CSV)
└── data/           Shared game data (source of truth)
```

---

## Status Legend
- `✅ done` — working and merged
- `🔨 in progress` — actively being built
- `📋 planned` — scoped, not started
- `💡 idea` — not scoped yet
- `🐛 bug` — known issue

---

## 1. Data Pipeline

### Goal
Pull current patch data from autochess.site and build a rich internal DB — units with images at each star level, items, synergies, patch history. Use this to ground the vision prompts with accurate, patch-aware context.

| Task | Status | Notes |
|------|--------|-------|
| Initial `units.json` / `items.json` | ✅ done | Handwritten, likely outdated |
| Puppeteer scraper scaffold | ✅ done | `scraper/scrape.js` — dumps raw HTML/text |
| Parse pieces page → structured JSON | ✅ done | `scrape_costs.mjs` — cost filter + synergy filter via `<select>` on board builder |
| Build canonical `units.json` | ✅ done | `build_units_json.mjs` — 114 units with cost + synergies, synced to analyzer |
| Parse items page → structured JSON | ✅ done | `items_parsed.json` — 76 items with tiers |
| Patch notes scraper | 📋 planned | For patch version detection |
| Unit screenshot DB | 💡 idea | Capture buy-screen images of each unit at 1/2/3★ for use as vision prompt reference |
| Patch-aware data versioning | 💡 idea | Tag each unit/item JSON with patch version; detect which patch a VOD is from based on unit pool |
| Auto-sync data → analyzer package | ✅ done | `build_units_json.mjs` copies `data/units.json` → `analyzer/dac_analyzer/data/units.json` |

---

## 2. Vision Analyzer (analyzer/)

### Goal
Accurate per-frame game state extraction from VOD screenshots. Currently uses Claude API or local Ollama.

#### Core Pipeline
| Task | Status | Notes |
|------|--------|-------|
| yt-dlp VOD download | ✅ done | Cached by video ID, no re-download |
| ffmpeg frame extraction | ✅ done | Cached with `index.json`, no re-extraction |
| Light scan (round/phase detection) | ✅ done | Checkpointed to `.lightscan.jsonl` |
| Adaptive dense resampling | ✅ done | Dense frames around round transitions |
| Full frame analysis | ✅ done | Checkpointed to `.partial.jsonl`, resumable |
| Timeline assembly | ✅ done | Detects pivots, spikes, economy events, level-ups |
| JSON output | ✅ done | Structured `game.json` |
| Summary text output | ✅ done | `game.summary.txt` |
| Build guide generator | ✅ done | `dac build-guide game.json` → `game.md` |

#### Backends
| Task | Status | Notes |
|------|--------|-------|
| Claude API backend | ✅ done | `analyzer.py` — requires `ANTHROPIC_API_KEY` |
| Ollama local backend | ✅ done | `ollama_analyzer.py` — `--local` flag |
| `qwen2.5vl:7b` stability | 🐛 bug | Runner crashes (~10-15% of frames) on WSL2; adds retries + skip logic but still slow |
| Test with `llava:7b` | 📋 planned | More stable for batch; lower structured output quality |
| `scan-frame` test command | ✅ done | `dac scan-frame <img> [--local]` for single-frame testing |

#### Prompt Quality
| Task | Status | Notes |
|------|--------|-------|
| Light scan prompt | ✅ done | Works well — round/phase/HP extraction accurate |
| Full analysis prompt | 🐛 bug | Several issues found in testing (see below) |
| Prompt testing harness | 📋 planned | Run prompt against known frames, compare to ground truth |

**Known prompt issues (from frame_000040 test):**
- Reads streamer name off board as a unit name
- `xp` field sometimes captures HP value instead
- `streak` field captures on-screen results text instead of actual streak count
- `active_synergies` returns unit names instead of class/species names
- Misses units visible in side panel (only sees board, not full roster)

---

## 3. Build Guide Generator (analyzer/dac_analyzer/build_guide.py)

| Task | Status | Notes |
|------|--------|-------|
| Basic Markdown generation from JSON | ✅ done | Early/mid/late phases, economy notes, power spikes |
| Key decision points (pivots) | ✅ done | Extracted from timeline events |
| Full end-to-end test | 🐛 bug | Blocked by Ollama stability — no complete JSON yet |
| Narrative quality review | 📋 planned | Review output once we have a complete run |

---

## 4. Scraper (scraper/)

| Task | Status | Notes |
|------|--------|-------|
| Puppeteer scaffold | ✅ done | `scrape.js` — launches browser, dumps raw page content |
| Install dependencies | ✅ done | `cd scraper && npm install` |
| Scrape 114 units with costs | ✅ done | `scrape_costs.mjs` — uses `<select>` cost + synergy filters on board builder |
| Build canonical `units.json` | ✅ done | `build_units_json.mjs` — syncs to analyzer data dir |
| Scrape 76 items | ✅ done | `items_parsed.json` from items page |
| Patch version detection | 📋 planned | Compare unit pool to known patches |
| Scheduled/CI auto-update | 💡 idea | Run scraper on a schedule, PR the data update |

### Key Scraper Findings
- autochess.site is a React SPA — must navigate from home page, not direct URL
- Cost filter is a `<select>` element (not buttons) — use `select.value = "1"; dispatchEvent(change)`
- Synergy filter is also a `<select>` — index 0 on page, cost filter is index 1
- Unit cards: `.grid.grid-cols-4 .group.cursor-pointer` → `.truncate` div has name
- Item registry (grid-cols-6) has item cards that look like buttons but are item instances

---

## 5. Game Tracker (tracker/)

### Goal
Background app: press hotkey at end of game → screenshot → local Ollama vision parses it → row appended to `~/.dac/games.csv`.

### Files
```
tracker/
├── main.py                   Hotkey listener (pynput), config prompt, import subcommand
├── capture.py                mss fullscreen → JPEG saved to ~/.dac/screenshots/
├── csv_writer.py             GameRow dataclass + append/read CSV
├── parser.py                 Two-call Ollama approach
├── image_utils.py            Synergy icon crops (calibrated for 3440×1440 ultrawide)
├── importer.py               Import old match CSV
├── prompts/
│   ├── parse_endgame.txt     (old single-call prompt — unused)
│   └── parse_endgame_main.txt  Main fields prompt (placement, level, wl, talents, relic)
└── requirements.txt          mss, pillow, httpx (pynput Windows-only)
```

### CSV Schema
`date, placement, comp, synergies, talents, relic, level, wl, screenshot, notes`

### Two-call Parse Approach
1. **Call 1** — send two synergy-area crops → model returns JSON `[{name, count}]`
   - Crop 1 (GAME OVER table): x 28–52%, y 11–24%
   - Crop 2 (Final Ranking floating badges): x 12–45%, y 32–58%
2. **Call 2** — full screenshot + pre-filled synergies → placement/level/wl/talents/relic

### Status
| Task | Status | Notes |
|------|--------|-------|
| Hotkey listener | ✅ done | pynput GlobalHotKeys, configurable |
| Screenshot capture | ✅ done | mss → JPEG |
| CSV writer | ✅ done | creates header on first run |
| Two-call parser | ✅ done | synergy crops + main fields |
| Importer | ✅ done | `python main.py import <file> [--dry-run]` |
| Live end-to-end test | ⏳ not done | needs Windows + Ollama running |
| Relic list in prompt | 📋 planned | inject known relic names like we do synergies |
| Icon extraction | 📋 planned | extract synergy/relic icons from VPK for reference images |

### Known Issues
- Relic detection: model guesses freely — need known list injected + reference icons
- `is_hunter` = Archer/Hunter synergy (not a separate "Archer" name)
- `is_demonhunter` = Demon Hunter synergy

---

## 6. VPK Datamine

### Auto Chess Workshop VPK
**Path:** `/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/570/1613886175/1613886175.vpk`

**Access:**
```python
import sys
sys.path.insert(0, 'tracker/.venv/lib/python3.12/site-packages')
import vpk
pak = vpk.open('...1613886175.vpk')
```

### Key Files Inside VPK
| File | Contents |
|------|----------|
| `scripts/npc/npc_abilities_custom.txt` | 36 synergies + their Dota ability icon texture names |
| `scripts/npc/npc_units_custom.txt` | All units — HP, attack, synergy assignments (Ability1/2) |
| `scripts/npc/npc_items_custom.txt` | Chess piece equipment items (NOT player relics — see note) |
| `resource/addon_english.txt` | English localisation — unit names, item names, rank labels |
| `panorama/images/custom_game/chess_icon/` | 99 unit portrait `.vtex_c` images |
| `panorama/images/custom_game/skaters/` | 416 hero portrait `.vtex_c` images (h001–h4xx) |

### Synergy → Dota Icon Texture Mapping (key ones)
| Synergy | Internal | Dota texture |
|---------|----------|--------------|
| Warlock | `is_warlock` | `warlock_upheaval` |
| Demon Hunter | `is_demonhunter` | `custom/terrorblade_metamorphosis_alt1_png` |
| Hunter (Archer) | `is_hunter` | `drow_ranger_marksmanship` |
| Assassin | `is_assassin` | `silencer_gaives_of_wisdom` |
| Demon | `is_demon` | `custom/nevermore_dark_lord_demon_png` |
| Knight | `is_knight` | `chaos_knight_phantasm` |
| Dragon | `is_dragon` | `lina_dragon_slave_alt1` |
| Mage | `is_mage` | `crystal_maiden_brilliance_aura` |

### Icon Locations
- **Standard icons** (most synergies + relics): inside Dota 2 main VPK as `.vtex_c`
  - `/mnt/c/.../dota 2 beta/game/dota/pak01_dir.vpk`
  - Need VRF decompiler or CDN download to get PNGs
- **Custom icons** (`custom/` prefix): inside workshop VPK above
- **No loose PNGs exist** — everything is compiled `.vtex_c`

### Extracted Data
- `analyzer/dac_analyzer/data/relics.json` — extracted from VPK but **flagged as incorrect by user** (npc_items_custom.txt has chess piece equipment, not player relics)
- `analyzer/dac_analyzer/data/units.json` — 114 units from scraper (accurate)
- `analyzer/dac_analyzer/data/items.json` — 76 items from scraper

### TODO
- [ ] Identify correct source of player relic definitions in VPK
- [ ] Extract `.vtex_c` icons → PNG (VRF tool or CDN)
- [ ] Build synergy icon reference sheet for vision model

---

## 7. Ideas Backlog

| Idea | Notes |
|------|-------|
| Unit image DB | Screenshot each unit at 1★/2★/3★ from buy screen; embed as vision prompt reference so model can visually match units |
| Patch detection from VOD | Compare unit pool in VOD vs known patch unit pools to auto-detect which patch a game was played on |
| Multi-player spectator mode | Currently only tracks one player; extend to track all 8 players in spectator mode |
| Live overlay (`dac watch`) | Screen capture instead of VOD; real-time analysis during a live game |
| Win/loss prediction | Train a simple model on game state at round X to predict final placement |
| Web UI | Browse analyzed VODs, filter by comp, compare build paths |
| Stats across sessions | Track personal stats over multiple VODs — winrate by comp, avg placement, etc. |

---

## 8. Known Bugs

| Bug | Severity | Status |
|-----|----------|--------|
| `qwen2.5vl:7b` runner crashes on WSL2 | High | Open — workaround: skip + retry |
| Video cache matches `.part` files | Low | Open — glob should filter to `.mp4` only |
| Prompt reads streamer name as unit | High | Open — prompt needs revision |
| `xp` field captures HP instead of XP | Medium | Open |
| `active_synergies` returns unit names not synergy names | High | Open — prompt needs revision |
| Dense frame `index.json` not written on first run | Low | Open |

---

## 9. Immediate Next Steps

1. Fix prompt issues (streamer name, synergies, xp) now that we have accurate unit/synergy data
2. Full end-to-end test run with `--no-adaptive` + a stable Ollama model to get complete output
3. Test `llava:7b` as stable alternative to `qwen2.5vl:7b` for batch analysis
4. Add items scrape to build `items.json` with full current patch item list
