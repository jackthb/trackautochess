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
| Parse pieces page → structured JSON | 🔨 in progress | Need to inspect raw output first |
| Parse items page → structured JSON | 📋 planned | Same approach as pieces |
| Patch notes scraper | 📋 planned | For patch version detection |
| Unit screenshot DB | 💡 idea | Capture buy-screen images of each unit at 1/2/3★ for use as vision prompt reference |
| Patch-aware data versioning | 💡 idea | Tag each unit/item JSON with patch version; detect which patch a VOD is from based on unit pool |
| Auto-sync data → analyzer package | 📋 planned | Scraper writes to `data/`, script copies to `analyzer/dac_analyzer/data/` |

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
| Install dependencies | 📋 planned | `cd scraper && npm install` |
| Run against autochess.site | 🔨 in progress | Need to inspect what the site actually renders |
| Parse pieces into `units.json` | 📋 planned | After inspecting raw output |
| Parse items into `items.json` | 📋 planned | |
| Patch version detection | 📋 planned | |
| Scheduled/CI auto-update | 💡 idea | Run scraper on a schedule, PR the data update |

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

1. `cd scraper && npm install && node scrape.js` — see what autochess.site actually renders
2. Build parser for pieces page → structured `units.json`
3. Fix prompt issues (streamer name, synergies, xp) using better-grounded data
4. Full end-to-end test run with `--no-adaptive` + `llava:7b` to get a complete output
