# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Track Auto Chess is a monorepo for Dota Auto Chess game tracking and analysis. It includes a desktop app (Electron + React + Rust backend), a Next.js web viewer/CMS, shared UI/data utilities, committed game content, and automation for patch-note/game-data updates.

## Architecture

**Electron App (`app/`)** — The main desktop application.
- React 19 + TypeScript + Vite frontend (`app/src/`)
- Electron main process (`app/main.js`) spawns the Rust backend as a subprocess
- **IPC Protocol**: Electron ↔ Rust communicate via JSON Lines over stdin/stdout (one JSON object per line)
- Rust backend (`app/backend/`) handles: Dota console/nettable capture, GSI post-game detection, hotkey-driven table dumps, Steam auth, local outbox retry, Supabase sync, and diagnostic/raw-log uploads to Supabase Storage

**Rust backend (`app/backend/`)** — Local services backend.
- CLI commands include `daemon`, `parse-log`, `parse-log-full`, `parse-live`, `queue`, `outbox-list`, and `gsi-cfg`.
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
cargo run -- gsi-cfg
cargo test
```

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
- **Runtime config**: stored in `~/.dac/config.json`; local capture/retry artifacts may also be written under `~/.dac/` (`outbox`, `replays`, `captures`, `nettable_dumps`, logs).
- **Steam ID helpers**: reuse shared Steam ID helpers instead of duplicating conversion/validation logic. Frontend/shared TypeScript should use `shared/steam.ts`; Rust backend code should use the existing `app/backend/src/supabase/mod.rs` helpers such as `parse_valid_steam_id64` and `steam_id64_to_account_id`.
- **Database**: Supabase PostgreSQL with RLS policies; current product tables include `users`, `player_seasons`, `mmr_snapshots`, `matches`, `match_players`, `match_timelines`, and `lineup_snapshots`.
- **Storage**: Supabase Storage bucket `diagnostic-logs` receives diagnostic and raw nettable dump uploads.
- **Content pipeline**: `content/` JSON feeds generated web runtime data and desktop content readers; `data/` holds icons/config/extractor helpers.
- **Release pipeline**: `.github/workflows/release.yml` triggers on `v*` tags, builds the Rust backend and Electron installer on Windows, and publishes `.exe` artifacts to GitHub Releases.
- **Patch-note pipeline**: `.github/workflows/scrape-patch-notes.yml` runs hourly and commits `content/` updates when Steam Workshop changelog scraping changes files.


<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged � so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) � shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) � shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->
