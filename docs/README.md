# Track Auto Chess

Game tracking and analysis for Dota Auto Chess.

- **Web** - [trackautochess.com](https://www.trackautochess.com) - player lookup, match history, patch notes, item/unit/synergy/relic/talent guides, and Keystatic content editing.
- **Desktop App** - Electron + React + Rust tracker that captures Dota console/nettable data locally and syncs processed match data to Supabase.
- **Patch note scraper** - GitHub Actions job and local script that poll the Steam Workshop changelog and commit content updates.

## Repository layout

| Path | Purpose |
| --- | --- |
| `app/` | Electron desktop app, Vite/React renderer, and packaging config. |
| `app/backend/` | Rust backend spawned by Electron; handles capture, GSI, Steam auth, Supabase sync, diagnostics, and outbox replay. |
| `web/` | Next.js App Router site and Keystatic CMS. |
| `content/` | Committed CMS/game content JSON used by the web app and desktop content readers. |
| `data/` | Non-CMS assets/config and extractor helpers, including icons and parser region config. |
| `shared/` | Shared React components, styles, and TypeScript utilities consumed by app/web code. |
| `scripts/` | Root automation for desktop setup/builds, content generation, patch-note scraping, and maintenance tasks. |
| `supabase/migrations/` | Database and Storage migrations for Supabase. |

## Setup

Install Node dependencies once from the repository root:

```bash
pnpm install
```

For the desktop app, also build or verify the Rust backend:

```bash
npm run install:desktop:backend
npm run verify:desktop:backend
```

## Common commands

### Desktop app

```bash
npm run dev:desktop                 # build/check backend, start Vite, launch Electron
npm run start:desktop               # build/check backend, build renderer, launch Electron
npm run build:desktop               # Vite renderer build only
npm run build:desktop:backend       # Cargo release build copied to app/backend/dist/headless/
npm run build:desktop:installer     # electron-builder Windows installer
npm run build:desktop:installer:dir # unpacked electron-builder output
npm run build:desktop:all           # backend + installer via app scripts
```

Equivalent app-local commands are available from `app/`, including `pnpm run dev`, `pnpm run dev:vite`, `pnpm run dev:electron`, `pnpm run build:backend`, and `pnpm run build:all`.

### Rust backend

```bash
cargo run --manifest-path app/backend/Cargo.toml -- daemon
cargo run --manifest-path app/backend/Cargo.toml -- parse-log <path-to-console.log>
cargo run --manifest-path app/backend/Cargo.toml -- parse-log-full <path-to-console.log>
cargo run --manifest-path app/backend/Cargo.toml -- parse-live <path-to-console.log> [local-steam-id]
cargo test --manifest-path app/backend/Cargo.toml
```

### Web app

```bash
pnpm --dir web run dev    # generates runtime data, then starts Next.js on port 3000
pnpm --dir web run build  # generates runtime data, syncs icons, then builds Next.js
npm run web:data          # regenerate web/generated runtime data from content/
```

## Data pipeline

Game/CMS data lives in committed JSON files under `content/`. The app, web runtime, scraper, and VPK extractor all use that content shape directly. `data/` is for non-CMS assets/config such as icons, parser regions, and local extractor helper scripts.

```text
content/*.json  ->  web generated runtime module    ->  web
content/*.json  ->  Electron/Rust content readers   ->  desktop app
VPK files       ->  data/extract_vpk.py             ->  content/game + data/icons
Steam changelog ->  scripts/scrape-patch-notes.mjs  ->  content/patch-notes + content/game
```

- `node scripts/generate-web-runtime-data.mjs` - build web/generated runtime data from content.
- `pnpm --dir web run dev` - run the web app and Keystatic at `/keystatic`.
- `python data/extract_vpk.py` - extract game data into `content/game` and icons into `data/icons`.
- `node scripts/scrape-patch-notes.mjs` - scrape new patch notes and update content files.

## Runtime data and storage

- Desktop runtime config is stored in `~/.dac/config.json`.
- The Rust backend may also use `~/.dac/outbox`, `~/.dac/replays`, `~/.dac/captures`, `~/.dac/nettable_dumps`, and tracker logs for local-first capture, replay, diagnostics, and retry behavior.
- Supabase stores public product data in tables such as `users`, `player_seasons`, `mmr_snapshots`, `matches`, `match_players`, `match_timelines`, and `lineup_snapshots`.
- Supabase Storage bucket `diagnostic-logs` stores uploaded diagnostics. Raw nettable dump logs upload through the web app to Cloudflare R2.

## Automation

- `.github/workflows/release.yml` runs on `v*` tags, builds the Windows Electron app and Rust backend, and uploads installer `.exe` artifacts to the GitHub Release.

### Cronicle jobs on the Pi

Cronicle is the primary operations path for both Drodo MMR polling (policy documented in [polling.md](polling.md)) and the DAC patch-notes scrape. See [ops/cronicle/README.md](../ops/cronicle/README.md) for setup, schedules, and runbook details.

The `.github/workflows/poll-drodo.yml` and `.github/workflows/scrape-patch-notes.yml` workflows are emergency fallbacks and should remain disabled (schedule-wise) unless intentionally re-enabled for an incident or Cronicle outage. The patch-notes scrape moved here because Steam occasionally serves GitHub-hosted runner IPs an anti-bot response with no changelog content; the Pi's residential IP avoids that.

## Editing content from a phone

The CMS is Keystatic at `/keystatic`. Local development uses local file edits. Production uses GitHub-backed storage when these env vars are set:

```bash
KEYSTATIC_GITHUB_REPO=jackthb/dac-tools
KEYSTATIC_GITHUB_CLIENT_ID=<generated-github-app-client-id>
KEYSTATIC_GITHUB_CLIENT_SECRET=<generated-github-app-client-secret>
KEYSTATIC_SECRET=<generated-random-secret>
NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG=<installed-keystatic-github-app-slug>
```

Keystatic generates the GitHub App values during its GitHub connection flow; copy those values into Vercel for Production before using the deployed editor.

With no Keystatic branch prefix configured, edits are committed directly to the repository's default branch (`main`).

## UI components

The web app is migrating its hand-rolled interactive UI to [Base UI](https://base-ui.com)
(`@base-ui/react`) — headless, accessible React primitives from the MUI/Radix
team — so behaviour like focus management, keyboard navigation, and dismissal is
handled by a maintained library instead of bespoke code. Styling stays in our CSS
Modules using the shared design tokens.

This is intentionally incremental. **Migrated so far:** the nav mega-menu
(`web/components/app/AppNavBar.tsx`, using `NavigationMenu`). **Still to migrate:**
other custom dropdowns, dialogs/modals, tooltips, and popovers across `web/`.
When adding or reworking one of those, reach for the Base UI primitive rather than
hand-rolling state.

## Tech stack

| Layer | Tech |
|-------|------|
| Web | Next.js 16, React 19, Base UI, Vercel |
| CMS | Keystatic + committed JSON |
| Database | Supabase (PostgreSQL + Storage) |
| Desktop | Electron, React 19, Vite |
| Backend | Rust, Cargo |
| CI | GitHub Actions |
