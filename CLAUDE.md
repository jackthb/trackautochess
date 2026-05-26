# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DAC Tools is a monorepo for Dota Auto Chess game tracking and analysis. It includes a desktop app (Electron + Python backend), a web viewer, and a data scraper.

## Architecture

**Electron App (`app/`)** — The main desktop application.
- React 19 + TypeScript + Vite frontend (`app/src/`)
- Electron main process (`app/main.js`) spawns a Python backend as a subprocess
- **IPC Protocol**: Electron ↔ Python communicate via JSON Lines over stdin/stdout (one JSON object per line)
- Python backend (`app/backend/`) handles: nettable capture (CustomNetTable extraction from console.log), screen recording (PyAV), Dota window detection, Supabase sync

**Shared Data (`data/`)** — Single source of truth for game data (units.json, items.json, synergies.json, relics.json, icons/). Multiple modules copy from here at build time.

**Web Viewer (`web/`)** — Next.js 16 app for browsing analyzed games from Supabase.

**Scraper (`scraper/`)** — Node.js/Puppeteer scraper for game data.

## Database

- **Supabase** (PostgreSQL) with RLS policies
- **Tables**: `matches` (one row per match), `match_players` (one row per player per match — the primary data table), `users`, `mmr_snapshots`, `match_timelines`
- **Migrations** in `supabase/migrations/` run automatically on merge via Supabase GitHub integration — no manual migration step needed
- The `games` table is dropped — all per-player data lives in `match_players`

## Build & Run Commands

### Desktop App (app/)
```bash
cd app
pnpm install
pnpm run dev              # Vite build + launch Electron
pnpm run dev:vite         # Vite dev server only (port 5173)
pnpm run dev:electron     # Electron only (expects dist/)
pnpm run build:backend    # PyInstaller → dist/headless/
pnpm run build:installer  # electron-builder NSIS → release/
pnpm run build:all        # Backend + installer
```

### Python Backend (app/backend/)
```bash
cd app/backend
pip install -r requirements.txt
python headless.py              # JSON Lines daemon
python main.py ingest-nettable  # Manual nettable ingest from console.log
```

### Web Viewer
```bash
cd web
pnpm install
pnpm run dev    # Dev server port 3000
pnpm run build
```

### Scraper
```bash
cd scraper
npm install
npm run scrape          # All data
npm run scrape:pieces   # Units only
npm run scrape:items    # Items only
```

## Key Technical Details

- **Package managers**: pnpm for Node.js projects, uv for Python projects
- **Python version**: 3.12
- **No linter/test framework configured** — testing is manual
- **PyInstaller** bundles the Python backend + ffmpeg into a standalone Windows executable (`dac_tracker.spec`)
- **Release pipeline** (`.github/workflows/release.yml`): triggered on `v*` tags, builds on Windows, publishes `.exe` to GitHub Releases
- **Auto-update**: `updater.py` checks GitHub Releases every 6h, downloads new `.exe`, self-replacing restart
- **Runtime config**: stored in `~/.dac/config.json` (player name, hotkey, Supabase URL)
- **No local file writes**: all game data goes directly to Supabase, nothing written to `~/.dac/` except config

## Workflow

- **Solo project, no code review needed.** Commit and push directly to `main`. You don't need to confirm direct-to-main pushes or open PRs by default.
- **Use a PR only when** (a) the change might plausibly need to be reverted — risky refactors, schema migrations, anything that could silently break the app for existing users — or (b) the change is in `web/` and you want the Vercel preview deployment to test it in a live environment before it hits production.
