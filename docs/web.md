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

## Twitch integrations

The site exposes public, CORS-enabled Twitch chat bot endpoints. They accept a Steam ID64, Steam profile URL, or Steam vanity name and cache responses at the edge for 30 minutes.

- `/api/twitch/:steamId/mmr` takes the Steam input in the path segment.
- `/api/twitch/mmr?steam=...` takes it as a query parameter, which is easier to wire into bot marketplaces because profile URLs only need query escaping.

Both return a one-line `text/plain` response for chat bot commands. For example, a Nightbot `!mmr` command can use `$(urlfetch https://www.trackautochess.com/api/twitch/76561198000000000/mmr)` and chat will receive the player's Steam ID, current MMR/rank when available, and Track Auto Chess profile link. StreamElements can use the equivalent `$(customapi https://www.trackautochess.com/api/twitch/76561198000000000/mmr)` response. Bots that do not support URL-fetch/custom API variables, such as basic OWN3D custom-command templates, need either an equivalent HTTP-request feature or a small custom Twitch IRC bot that calls this endpoint.

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
