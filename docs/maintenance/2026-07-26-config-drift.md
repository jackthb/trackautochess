# Config drift — 2026-07-26

Audit-only report. No config files were changed in this PR.

Config files were checked against what the code actually reads: every path
referenced from `package.json` scripts, `electron-builder.json`, `vercel.json`,
`tsconfig.json`, `pnpm-workspace.yaml` and `shared/package.json` exports, plus a
diff of `web/.env.example` against every `process.env.*` read in `web/`,
`scripts/`, `shared/` and `ops/`.

## Summary

| Check | Result |
| --- | --- |
| `package.json` script targets (root + `web` + `app`) | all 12 root and 4 web script targets exist |
| `app/electron-builder.json` `files` / `extraResources` / icons / sign hook | all exist |
| `shared/package.json` `exports` (16 entries) | all exist |
| `web/tsconfig.json` + `app/tsconfig.json` path aliases | resolve correctly |
| `pnpm-workspace.yaml` packages | `app`, `web`, `shared` all present |
| `.github/workflows` schedules vs. documented policy | consistent (poll-drodo and scrape-patch-notes are `workflow_dispatch`-only, as documented) |
| `web/.env.example` vs. code | **drifted — see below** |
| `app/electron-builder.json` `electronVersion` | **pinned separately from `package.json` — see below** |

## 1. `web/.env.example` documents 11 variables that no longer exist in code

The entire ads/sponsorship block (lines 49–73) is stale. Grepping the whole
repository — not just `web/` — turns up **zero** references to any of these
outside `.env.example` and one line of `docs/web.md`. The module they configured,
`web/lib/ads.ts`, has been deleted, and no ad-slot component remains under
`web/components/`.

| Variable | `.env.example` line |
| --- | --- |
| `NEXT_PUBLIC_ADS_ENABLED` | 51 |
| `NEXT_PUBLIC_DIRECT_AD_URL` | 55 |
| `NEXT_PUBLIC_DIRECT_AD_TITLE` | 56 |
| `NEXT_PUBLIC_DIRECT_AD_DESCRIPTION` | 57 |
| `NEXT_PUBLIC_DIRECT_AD_CTA` | 58 |
| `NEXT_PUBLIC_DIRECT_AD_SLOTS` | 59 |
| `NEXT_PUBLIC_ADSTERRA_KEY_BOTTOM` | 69 |
| `NEXT_PUBLIC_ADSTERRA_KEY_SIDEBAR` | 70 |
| `NEXT_PUBLIC_ADSTERRA_KEY_SIDEBAR_LEFT` | 71 |
| `NEXT_PUBLIC_ADSTERRA_KEY_INCONTENT` | 72 |
| `NEXT_PUBLIC_ADSTERRA_KEY_INCONTENT_2` | 73 |

**Change needed:** delete lines 49–73 of `web/.env.example`. The matching stale
sentence in `docs/web.md:60` is tracked in the documentation-drift report.

## 2. `web/.env.example` omits variables the app requires to boot

Read by code, absent from the example file. The first three are the notable ones —
a new contributor copying `.env.example` to `.env.local` gets a web app that
cannot reach Supabase at all.

| Variable | Read at | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `web/lib/supabase.ts:33`, `web/app/layout.tsx:12`, auth callbacks, `api/cron/poll-drodo` | required for any Supabase access |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `web/lib/supabase.ts:37` | required; normalized as the publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | `web/lib/supabase.ts:77`, `api/cron/poll-drodo/route.ts:62`, `web/scripts/embed-content.mts:77` | server-only; required by cron + embedding |
| `NEXT_PUBLIC_SITE_HOST` | `web/lib/twitchStats.ts:12` | distinct from the documented `NEXT_PUBLIC_SITE_URL` |
| `TWITCH_EXTENSION_SHARED_SECRETS` | `web/lib/twitchExtensionAuth.ts:30` | mentioned in a comment as the rotation variable, but never listed as a key |
| `POSTHOG_PROJECT_TOKEN` | `web/lib/posthogServer.ts:49` | server-side override of the `NEXT_PUBLIC_` value |
| `POSTHOG_API_HOST` | `web/lib/posthogServer.ts:10` | server-side override |
| `QUEENS_REVALIDATE_URL` | `web/scripts/poll-drodo.mts:69` | |
| `HEALTHCHECK_URL` | `web/scripts/poll-drodo.mts:45`, `ops/cronicle/scripts/poll-drodo.mjs:337` | |
| `DRODO_POLL_MODE` | `web/scripts/poll-drodo.mts:29`, `ops/cronicle/scripts/poll-drodo.mjs:33` | defaults to `active`; `--mode` flag takes precedence |

**Change needed:** add these to `web/.env.example`, grouped with the sections
they belong to (Supabase, Twitch, PostHog, Drodo polling).

## 3. No `.env.example` covers the root-level scripts

`scripts/generate-supabase-types.mjs` reads `SUPABASE_PROJECT_ID` (line 20) and
`SUPABASE_SCHEMAS` (line 9), and `scripts/import-legacy-mmr-snapshots.mjs` reads
`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. There is no
`.env.example` at the repository root, so these are undiscoverable without
reading the scripts.

**Change needed:** either add a root `.env.example`, or document these two
variables in `docs/README.md` alongside the `npm run generate:supabase-types`
entry.

## 4. `electronVersion` is pinned in two places that can diverge

`app/package.json` declares `"electron": "^33.0.0"` (currently resolving to
33.4.11) while `app/electron-builder.json` hard-codes
`"electronVersion": "33.4.11"`. They agree today, but any `pnpm update` within
the `^33` range silently desynchronizes them, and electron-builder would package
against a version that is not the one installed.

This is also a blocker for the Electron upgrade in the dependency-advisory
report — both values have to move together.

**Change needed:** either drop `electronVersion` from `electron-builder.json`
(electron-builder infers it from the installed package) or pin `app/package.json`
to the exact version so the two cannot drift.

## Checked and found consistent

Recorded so the next audit does not re-derive them:

- All 12 root `package.json` script targets resolve (`scripts/run-desktop.mjs`,
  `scripts/setup-desktop-backend.mjs`, `scripts/build-drodo-core.mjs`,
  `scripts/build-guides/*.mjs`, etc.).
- `web/vercel.json` `ignoreCommand` → `web/scripts/ignore-build.mjs` exists.
- `web/playwright.config.ts` `testDir: "./tests"` → `web/tests/` exists and
  contains the `queens-refresh-polling.spec.ts` that `test:smoke` names.
- `web/package.json` `prebuild` → `web/scripts/sync-icons.mjs` exists; the same
  icon copy is duplicated in `next.config.ts` `syncPublicIcons()`, which is
  deliberate and commented (Vercel may bypass `prebuild`).
- All 16 `shared/package.json` `exports` targets exist on disk.
- `AGENTS.md`'s reference to `web/generated/content-data.ts` matches the actual
  output path in `scripts/generate-web-runtime-data.mjs:7` (the directory is
  empty in a fresh checkout because it is generated).
