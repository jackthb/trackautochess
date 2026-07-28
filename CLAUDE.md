# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DAC Tools is a monorepo for Dota Auto Chess game tracking and analysis. It includes a desktop app (Electron + React + Rust backend), a Next.js web viewer/CMS, shared UI/data utilities, committed game content, and automation for patch-note/game-data updates.

## Architecture

**Electron App (`app/`)** — The main desktop application.
- React 19 + TypeScript + Vite frontend (`app/src/`)
- Electron main process (`app/main.js`) spawns the Rust backend as a subprocess
- **IPC Protocol**: Electron ↔ Rust communicate via JSON Lines over stdin/stdout (one JSON object per line)
- Rust backend (`app/backend/`) handles: Dota console/nettable capture, GSI post-game detection, hotkey-driven table dumps, Steam auth, local outbox retry, Supabase sync, and diagnostic/raw-log uploads to Supabase Storage

**Rust backend (`app/backend/`)** — Local services backend.
- CLI commands: `daemon`, `parse-log`, `parse-log-full`, `parse-live`, `queue`, `outbox-list`, `outbox-flush`, `gsi-cfg`, `finalize-log`, `finalize-dump`, `timeline-from-log`, and `timeline-from-dump`.
- The packaged binary is copied to `app/backend/dist/headless/` by `pnpm --dir app run build:backend`.

**Content (`content/`)** — Source of truth for committed game/CMS JSON, including game data and patch notes.

**Data helpers/assets (`data/`)** — Non-CMS assets/config such as icons, parser regions, and extractor scripts.

**Shared package (`shared/`)** — Shared React components, styles, and utilities consumed by app/web code.

**Web Viewer (`web/`)** — Next.js 16 App Router app for player lookup, match history, leaderboards, content guides, patch notes, and Keystatic editing.

**Automation (`scripts/`, `.github/workflows/`)** — Runtime-data generation, desktop setup/build helpers, patch-note scraping, Drodo polling, and Windows release builds.

## Build & Run Commands

### Root helpers
```bash
npm run dev:desktop
npm run start:desktop
npm run build:desktop
npm run build:desktop:backend
npm run build:desktop:installer
npm run web:data
npm run cms:dev
```

### Desktop App (`app/`)
```bash
cd app
pnpm install
pnpm run dev              # Vite dev server + launch Electron
pnpm run dev:vite         # Vite dev server only (port 5173)
pnpm run dev:electron     # Electron only (expects dist/ or dev server depending on flags)
pnpm run build            # Vite renderer build
pnpm run build:backend    # Cargo release build → backend/dist/headless/
pnpm run build:installer  # Vite build + electron-builder NSIS → release/
pnpm run build:all        # Backend + installer
```

### Rust Backend (`app/backend/`)
```bash
cargo run -- daemon
cargo run -- parse-log <path-to-console.log>
cargo run -- parse-log-full <path-to-console.log>
cargo run -- parse-live <path-to-console.log> [local-steam-id]
cargo run -- queue <payload.json>
cargo run -- outbox-list
cargo run -- outbox-flush
cargo run -- gsi-cfg
cargo run -- finalize-log [path-to-console.log]
cargo run -- finalize-dump <path-to-dump>
cargo run -- timeline-from-log <path-to-console.log> <match-id>
cargo run -- timeline-from-dump <path-to-dump> <match-id>
cargo test
```

The `finalize-*` and `timeline-from-*` commands are recovery paths: they
re-upload a match, or just its timeline, from a log or dump whose live upload
never landed.

### Web Viewer (`web/`)
```bash
cd web
pnpm install
pnpm run dev       # Dev server port 3000; predev regenerates runtime data
pnpm run build     # Regenerate runtime data, sync icons, build Next.js
pnpm run test:e2e  # Build, then run Playwright tests
```

## Key Technical Details

- **Package managers**: pnpm for Node.js workspaces, Cargo for the Rust backend.
- **Backend migration status**: the Python/CV backend has been removed; `app/backend/` is the Rust backend.
- **Runtime config**: stored in `config.json` inside the DAC data dir (`%APPDATA%\@dac\desktop` on Windows, `~/.dac` elsewhere; `DAC_DIR` overrides both). Local capture/retry artifacts live beside it (`outbox`, `replays`, `captures`, `nettable_dumps`, logs). Electron resolves the dir via `app.getPath("userData")` and passes it to the Rust backend as `DAC_DIR`; a leftover `~/.dac` on Windows is the pre-migration copy, not live data.
- **Database**: Supabase PostgreSQL with RLS policies; current product tables are `users`, `player_seasons`, `mmr_snapshots`, `matches`, `match_players`, `match_timelines`, `lineup_snapshots`, `community_builds`, `community_build_votes`, `community_build_comments`, `content_embeddings`, and `site_status`.
- **Storage**: Supabase Storage bucket `diagnostic-logs` receives diagnostic uploads. Raw nettable dumps are local-only, under `nettable_dumps/` in the DAC data dir.
- **Content pipeline**: `content/` JSON feeds generated web runtime data and desktop content readers; `data/` holds icons/config/extractor helpers.
- **Release pipeline**: `.github/workflows/release.yml` triggers on `v*` tags, builds the Rust backend and Electron installer on Windows, and publishes `.exe` artifacts to GitHub Releases.
- **Patch-note pipeline**: `scripts/scrape-patch-notes.mjs` scrapes the Steam Workshop changelog and commits `content/` updates. It runs hourly via Cronicle on the Pi (`ops/cronicle/cronicle-job.dac-scrape-patch-notes.json`), which pushes directly using that checkout's git credentials; `.github/workflows/scrape-patch-notes.yml` is a disabled-schedule, manual-only fallback (Steam intermittently serves GitHub-hosted runner IPs an anti-bot shell with no changelog entries, which a residential IP avoids).

## Workflow

Follow the active task instructions from the invoking environment. In this repository, prefer small focused commits with clear validation notes; use pull requests when requested by the current automation or user instructions.
