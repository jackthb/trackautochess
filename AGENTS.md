# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

DAC Tools is a monorepo for Dota Auto Chess game tracking and analysis. It includes a desktop app (Electron + Rust backend), a web viewer, and shared game/content data.

## Architecture

**Electron App (`app/`)** — The main desktop application.
- React 19 + TypeScript + Vite frontend (`app/src/`)
- Electron main process (`app/main.js`) spawns the Rust backend as a subprocess
- **IPC Protocol**: Electron ↔ Rust communicate via JSON Lines over stdin/stdout (one JSON object per line)
- Rust backend (`app/backend/`) handles: Dota console/nettable capture, GSI post-game detection, hotkey-driven table dumps, Steam auth, Supabase sync, and diagnostic log uploads to Supabase Storage

**Shared Data (`data/`)** — Single source of truth for game data (units_full.json, aliases.json, items.json, synergies.json, relics.json, icons/). Multiple modules copy from here at build time.

**Web Viewer (`web/`)** — Next.js 16 app for browsing analyzed games from Supabase.

## Build & Run Commands

### Desktop App (app/)
```bash
cd app
pnpm install
pnpm run dev              # Vite dev server + launch Electron
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

## Key Technical Details

- **Package managers**: pnpm for Node.js projects, Cargo for the Rust backend
- **Backend migration status**: the Python/CV backend has been removed; `app/backend/` is the Rust backend
- **Release pipeline** (`.github/workflows/release.yml`): triggered on `v*` tags, builds Rust backend on Windows, publishes `.exe` to GitHub Releases
- **Runtime config**: stored in `~/.dac/config.json` (Steam identity, Supabase URL/key, local toggles)
- **Database**: Supabase (PostgreSQL + Storage) with RLS policies
