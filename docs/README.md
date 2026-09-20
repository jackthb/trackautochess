# Developer guide

Track Auto Chess contains a Windows desktop tracker and a Next.js web app. Both use the committed game content and shared UI utilities in this repository.

## Install

Install Node.js 24 and pnpm 10.32.1. From the repository root:

```sh
pnpm install --frozen-lockfile
```

Desktop development also requires a current stable Rust toolchain (at least 1.85) and the Visual Studio C++ build tools. Live capture requires Windows, Dota 2 and the Dota Auto Chess Workshop item.

## Web app

```sh
pnpm --dir web run dev
```

Open http://localhost:3000. The development command generates runtime data from `content/` automatically. Game-content pages work without service credentials. The local content editor is at `/keystatic`.

For database-backed features, copy [web/.env.example](../web/.env.example) to `web/.env.local` and configure your own services. The example documents Supabase, Steam authentication, analytics, the game assistant and optional GitHub-backed content editing. Keep service-role keys on the server. A root `.env.local` is not loaded by Next.js.

```sh
pnpm --dir web run build
pnpm --dir web run start
```

The production build generates runtime content and copies the game icons before compiling the site.

## Desktop app

The desktop app includes connection defaults for the official service. Enable local-only mode before development to disable cloud sync. In PowerShell:

```powershell
$env:DAC_LOCAL_ONLY = "1"
pnpm --dir app run build:backend
pnpm --dir app run dev
```

The backend build writes its binary to `app/backend/dist/headless/`. Electron launches it and exchanges JSON Lines over stdin/stdout.

To build the Windows installer:

```sh
pnpm --dir app run build:all
```

Configuration and local capture data live in `%APPDATA%\@dac\desktop` on Windows, or `~/.dac` elsewhere. Set `DAC_DIR` before launching to use a separate development directory. That directory contains `config.json`, captures, local nettable dumps, logs and the upload outbox. Keep these files out of commits.

For an offline parser check:

```sh
cargo run --manifest-path app/backend/Cargo.toml -- parse-log <path-to-console.log>
```

## Project layout

| Path | Purpose |
| --- | --- |
| `app/` | Electron app and React renderer |
| `app/backend/` | Rust capture, parsing and sync backend |
| `web/` | Next.js viewer, API routes and content editor |
| `shared/` | Shared components, styles and utilities |
| `content/` | Game data, guides and patch notes used by both apps |
| `data/` | Game icons and extraction helpers |
| `scripts/` | Build, generation, validation and maintenance tools |
| `supabase/` | Database migrations, Edge Functions and tests |

Game data is committed under `content/`; `pnpm run web:data` regenerates the web runtime module after edits. Environment settings for standalone maintenance scripts are documented in the root [.env.example](../.env.example).

See [CONTRIBUTING.md](../CONTRIBUTING.md) for validation and test setup, and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for game-content and font notices.
