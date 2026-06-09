# DAC Tools web viewer

This is the Next.js 16 App Router site for [trackautochess.com](https://www.trackautochess.com). It serves public DAC player lookup, leaderboards, match history, game-content guides, patch notes, and the Keystatic editor.

## Development

Install dependencies from the web workspace, then start Next.js:

```bash
pnpm install
pnpm run dev
```

`pnpm run dev` runs `scripts/generate-web-runtime-data.mjs` first, then starts the dev server on [http://localhost:3000](http://localhost:3000). Keystatic is available at `/keystatic`.

## Build and tests

```bash
pnpm run build     # generate runtime data, sync icons, and run next build
pnpm run start     # serve the production build
pnpm run test:e2e  # build, then run Playwright tests
```

## Data flow

- Runtime game data is generated from `../content/` by `../scripts/generate-web-runtime-data.mjs`.
- Icon assets are synced during production builds by `web/scripts/sync-icons.mjs`.
- The web app imports shared UI and utility code from the local `@dac/shared` package in `../shared`.
- Supabase access is handled through server/client helpers under `web/lib/` and API routes under `web/app/api/`.

## Content editing

Keystatic is configured in `web/app/keystatic/keystatic.ts` and edits committed JSON content. Local development writes files directly. Production can use GitHub-backed storage when the root README's Keystatic environment variables are configured.

## Analytics and monetization

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

Ad slots are controlled by `web/lib/ads.ts`. Set `NEXT_PUBLIC_ADS_ENABLED=false` to pause every slot, or set the `NEXT_PUBLIC_DIRECT_AD_*` variables to run a first-party sponsor/job placement without third-party ad scripts. Adsterra keys remain optional and unset slots render nothing.
