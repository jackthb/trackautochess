# DAC Tools

Game tracking and analysis tools for Dota Auto Chess.

- **Web** - [trackautochess.com](https://www.trackautochess.com) - player lookup, match history, patch notes, item/unit/synergy guides
- **Desktop App** - Electron + Python tracker that captures game data and syncs to Supabase
- **Scraper** - Hourly automated patch notes from Steam Workshop changelog

## Setup

```bash
pnpm --dir web install
pnpm --dir app install
```

## Data Pipeline

Game data lives in committed JSON files under `content/`. `data/` is the
generated compatibility cache consumed by the web app, desktop app, and Python
tools.

```text
content/*.json  ->  node scripts/generate-data.mjs  ->  data/*.json  ->  web / app
VPK files       ->  data/extract_vpk.py             ->  data/*.json + data/icons/
Steam changelog ->  scripts/scrape-patch-notes.mjs  ->  content/ + data/
```

- `node scripts/generate-data.mjs` - rebuild `data/` from committed content
- `node scripts/import-data-to-content.mjs` - seed/refresh `content/` from `data/`
- `pnpm --dir web run dev` - run the web app and Keystatic at `/keystatic`
- `python data/extract_vpk.py` - extract game data + icons from VPK
- `node scripts/scrape-patch-notes.mjs` - scrape new patch notes and auto-apply game data changes

## Editing content from a phone

The CMS is Keystatic at `/keystatic`. Local development uses local file edits.
Production uses GitHub-backed storage when these env vars are set:

```bash
KEYSTATIC_GITHUB_REPO=jackthb/dac-tools
KEYSTATIC_GITHUB_CLIENT_ID=<generated-github-app-client-id>
KEYSTATIC_GITHUB_CLIENT_SECRET=<generated-github-app-client-secret>
KEYSTATIC_SECRET=<generated-random-secret>
NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG=<installed-keystatic-github-app-slug>
```

Keystatic generates the GitHub App values during its GitHub connection flow;
copy those values into Vercel for Production before using the deployed editor.

With no Keystatic branch prefix configured, edits are committed directly to the
repository's default branch (`main`).

## Tech Stack

| Layer | Tech |
|-------|------|
| Web | Next.js, Vercel |
| CMS | Keystatic + committed JSON |
| Database | Supabase (PostgreSQL) |
| Desktop | Electron, React, Vite |
| Backend | Python, PyAV, PyInstaller |
| CI | GitHub Actions |
