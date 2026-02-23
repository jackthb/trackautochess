# dac-tools Progress Tracker

## Project Structure

```
dac-tools/
├── analyzer/       Python VOD analyzer CLI
├── scraper/        Puppeteer scraper for autochess.site
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

## 5. Ideas Backlog

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

## Known Bugs

| Bug | Severity | Status |
|-----|----------|--------|
| `qwen2.5vl:7b` runner crashes on WSL2 | High | Open — workaround: skip + retry |
| Video cache matches `.part` files | Low | Open — glob should filter to `.mp4` only |
| Prompt reads streamer name as unit | High | Open — prompt needs revision |
| `xp` field captures HP instead of XP | Medium | Open |
| `active_synergies` returns unit names not synergy names | High | Open — prompt needs revision |
| Dense frame `index.json` not written on first run | Low | Open |

---

## Immediate Next Steps

1. Fix prompt issues (streamer name, synergies, xp) now that we have accurate unit/synergy data
2. Full end-to-end test run with `--no-adaptive` + a stable Ollama model to get complete output
3. Test `llava:7b` as stable alternative to `qwen2.5vl:7b` for batch analysis
4. Add items scrape to build `items.json` with full current patch item list
