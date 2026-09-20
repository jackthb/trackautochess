# Track Auto Chess

Track and explore Dota Auto Chess matches. This monorepo contains a Windows desktop tracker, a web viewer, and shared game-data and UI utilities.

- **Desktop:** Electron and React with a Rust backend for local game capture, match processing and optional cloud sync.
- **Web:** Next.js pages for players, match history, leaderboards, units, items and patch notes.
- **Content:** committed game data and tools for maintaining it.

## Run the web app

Install Node.js 24 and pnpm 10.32.1, then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir web run dev
```

Open http://localhost:3000. Content pages work without environment variables. Player data, authentication and other database features require your own Supabase setup; see [web/.env.example](web/.env.example) and the [developer guide](docs/README.md).

## Desktop development

Live capture requires Windows and Dota 2 with Dota Auto Chess. Install a current stable Rust toolchain (at least 1.85) and the Visual Studio C++ build tools. After installing the workspace dependencies:

```sh
pnpm --dir app run build:backend
pnpm --dir app run dev
```

The desktop app includes connection defaults for the official service. For local development, set `DAC_LOCAL_ONLY=1` before launching to disable cloud sync. See the [developer guide](docs/README.md) for configuration, storage locations and packaging.

## Repository map

| Directory | Purpose |
| --- | --- |
| `app/` | Electron desktop app and React renderer |
| `app/backend/` | Rust capture and processing backend |
| `web/` | Next.js web viewer and CMS |
| `shared/` | Shared components, styles and utilities |
| `content/` | Committed game and editorial data |
| `scripts/` | Build, validation and content-maintenance tools |
| `supabase/` | Database migrations and configuration |

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and contribution guidance.

## Licence and third-party material

Original project code is available under the [MIT licence](LICENSE). Game artwork, game-derived content, trademarks, fonts and dependencies retain their respective ownership and terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The MIT licence does not grant rights to those materials.

Track Auto Chess is an independent community project and is not affiliated with or endorsed by Valve or Drodo Studio.
