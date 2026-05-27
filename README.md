# DAC Tools

Game tracking and analysis tools for Dota Auto Chess.

- **Web** — [trackautochess.com](https://www.trackautochess.com) — player lookup, match history, patch notes, item/unit/synergy guides
- **Desktop App** — Electron + Python tracker that captures game data and syncs to Supabase
- **Scraper** — Hourly automated patch notes from Steam Workshop changelog

## Setup

```bash
pnpm install        # web + app
cd cms && pnpm install   # Sanity Studio
```

## Data Pipeline

Game data lives in **Sanity CMS** and is cached as JSON in `data/`.

```
Sanity CMS  ──pnpm pull──▸  data/*.json  ──build──▸  web / app
VPK (game files)  ──extract_vpk.py──▸  data/*.json + data/icons/
Steam changelog  ──scraper (hourly)──▸  data/patch_notes/ ──migrate──▸ Sanity
```

- `cd cms && pnpm pull` — sync Sanity to JSON
- `cd cms && pnpm migrate` — push JSON to Sanity
- `python data/extract_vpk.py` — extract game data + icons from VPK
- `node scripts/scrape-patch-notes.mjs` — scrape new patch notes + auto-apply game data changes

## Tech Stack

| Layer | Tech |
|-------|------|
| Web | Next.js, Vercel |
| CMS | Sanity |
| Database | Supabase (PostgreSQL) |
| Desktop | Electron, React, Vite |
| Backend | Python, PyAV, PyInstaller |
| CI | GitHub Actions |
