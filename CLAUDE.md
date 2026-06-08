# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DAC Tools is a monorepo for Dota Auto Chess game tracking and analysis. It includes a desktop app (Electron + Rust backend), a web viewer, and a data scraper.

## Architecture

**Electron App (`app/`)** — The main desktop application.
- React 19 + TypeScript + Vite frontend (`app/src/`)
- Electron main process (`app/main.js`) spawns a Rust backend as a subprocess
- **IPC Protocol**: Electron ↔ Rust communicate via JSON Lines over stdin/stdout (one JSON object per line)
- Rust backend (`app/backend/`) handles: nettable capture (CustomNetTable extraction from console.log), Dota/GSI state detection, Steam auth, Supabase sync, and diagnostic log uploads

**Shared Data (`data/`)** — Single source of truth for game data (units_full.json, aliases.json, items.json, synergies.json, relics.json, icons/). Multiple modules copy from here at build time.

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
pnpm run build:backend    # Cargo release build → backend/dist/headless/
pnpm run build:installer  # electron-builder NSIS → release/
pnpm run build:all        # Backend + installer
```

### Rust Backend (app/backend/)
```bash
cd app/backend
cargo run -- daemon
cargo run -- parse-log <path-to-console.log>
cargo run -- parse-log-full <path-to-console.log>
cargo test
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

- **Package managers**: pnpm for Node.js projects, Cargo for the Rust backend
- **Backend migration status**: the Python/CV backend has been removed; `app/backend/` is the Rust backend
- **Cargo** builds the Rust backend executable bundled by electron-builder
- **Release pipeline** (`.github/workflows/release.yml`): triggered on `v*` tags, builds on Windows, publishes `.exe` to GitHub Releases
- **Runtime config**: stored in `~/.dac/config.json` (Steam identity, Supabase URL/key, local toggles)
- **No local file writes**: all game data goes directly to Supabase, nothing written to `~/.dac/` except config

## Workflow

- **Solo project, no code review needed.** Commit and push directly to `main`. You don't need to confirm direct-to-main pushes or open PRs by default.
- **Use a PR only when** (a) the change might plausibly need to be reverted — risky refactors, schema migrations, anything that could silently break the app for existing users — or (b) the change is in `web/` and you want the Vercel preview deployment to test it in a live environment before it hits production.
