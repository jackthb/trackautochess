# DAC Tools web viewer

This is the Next.js 16 App Router site for [trackautochess.com](https://www.trackautochess.com). It serves public DAC player lookup, leaderboards, match history, game-content guides, patch notes, and the Keystatic editor.

## Development

Install dependencies from the repository root, then start Next.js from the web workspace:

```bash
pnpm install
pnpm --dir web run dev
```

`pnpm --dir web run dev` runs `scripts/generate-web-runtime-data.mjs` first, then starts the dev server on [http://localhost:3000](http://localhost:3000). Keystatic is available at `/keystatic`.

## Build and tests

```bash
pnpm --dir web run build     # generate runtime data, sync icons, and run next build
pnpm --dir web run start     # serve the production build
pnpm --dir web run test:e2e  # build, then run Playwright tests
```

## Data flow

- Runtime game data is generated from `../content/` by `../scripts/generate-web-runtime-data.mjs`.
- Icon assets are synced during production builds by `web/scripts/sync-icons.mjs`.
- The web app imports shared UI and utility code from the local `@dac/shared` package in `../shared`.
- Supabase access is handled through server/client helpers under `web/lib/` and API routes under `web/app/api/`.

## Game assistant

The site includes an admin-gated Game assistant widget. It streams answers from Vercel AI Gateway (`alibaba/qwen3.7-flash` by default). Named synergy questions are grounded in committed game content (plus that synergy's units). Other questions fall back to general Dota Auto Chess knowledge.

**Production:** Vercel OIDC authenticates AI Gateway automatically. Enable AI Gateway on the `trackautochess` project. Keep `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` set so `admin_access` can show the widget. No `AI_GATEWAY_API_KEY` is required on Vercel.

**Local:**

1. Link the `trackautochess` Vercel project if needed (`vercel link` from `web/` or the repo root).
2. Refresh OIDC credentials: `vercel env pull .env.local --yes`. The token lasts about 24 hours. If `web/.env.development.local` also has `VERCEL_OIDC_TOKEN`, remove that line so it cannot shadow the pulled token.
3. Sign in with a Steam account that has PostHog `admin_access` (in development, any signed-in Steam user is treated as admin).
4. Open the `?` button at the bottom-right and send a message.

Optional environment:

- `CHAT_GENERATION_MODEL` overrides the Gateway model slug.
- `AI_GATEWAY_API_KEY` is a static fallback when `VERCEL_OIDC_TOKEN` is not available.

## Content editing

Keystatic is configured in `web/app/keystatic/keystatic.ts` and edits committed JSON content. Local development writes files directly. Production can use GitHub-backed storage when the Keystatic environment variables are configured — see "Editing content from a phone" in [README.md](README.md), or `web/.env.example`.

## Analytics

The site uses PostHog through privacy-scoped helpers in `web/lib/analytics.ts`. Product events intentionally avoid raw Steam IDs, profile names, search text, tokens, and private admin/dashboard URLs. Set `NEXT_PUBLIC_PRODUCT_ANALYTICS=false` to pause custom product events.

### PostHog managed proxy setup

Use a neutral proxy hostname such as `t.trackautochess.com`. Avoid hostnames containing `analytics`, `tracking`, `telemetry`, `posthog`, or `ph`.

1. In PostHog, go to organization proxy settings and create a managed proxy for `t.trackautochess.com`.
2. At your DNS provider, add the CNAME target PostHog generates. Do not route this subdomain through Vercel. If using Cloudflare DNS, keep the record DNS-only rather than proxied.
3. Wait for PostHog to mark the proxy as live.
4. Set production env vars:

```bash
NEXT_PUBLIC_POSTHOG_API_HOST=https://t.trackautochess.com
NEXT_PUBLIC_POSTHOG_HOST=https://eu.posthog.com
```
