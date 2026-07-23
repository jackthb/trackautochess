# Raspberry Pi Cronicle jobs

This folder packages a self-hosted Cronicle scheduler for background jobs that
run better from a residential IP than a GitHub-hosted runner: the Drodo poller
and the DAC patch-notes scrape. Run it on the Raspberry Pi after pulling this
monorepo.

Cronicle provides the prepackaged pieces we do not want to build ourselves:

- web UI at `http://<pi>:3012`
- schedules
- manual runs
- per-run logs
- success/failure history
- retries/notifications

The Docker image used here (`soulteary/cronicle`) is multi-arch and supports
x86, ARM64, and ARMv7, so it should run on a normal Raspberry Pi Docker setup.

The actual poller script runs locally on the Pi with plain Node.js and talks
directly to Drodo and Supabase. The Vercel API can stay focused on
user-directed refreshes.

The GitHub Actions schedules for `Poll Drodo (MMR snapshots)` and
`Scrape DAC Patch Notes` have both been disabled; each remains manually
runnable only as an emergency/operator-triggered fallback.

**Current status:** Drodo live polling is parked. `scripts/poll-drodo.mjs` exits
immediately unless `DRODO_LIVE_FETCH_ENABLED=1` is set. Public `/courier/get` no
longer returns season MMR, so scheduled jobs should stay off.

Unlike the Drodo poller, the patch-notes scrape commits and pushes to `main`
directly (`git add content/ && git commit && git push`), using the `/workspace`
checkout's own git remote and credentials — the same ones used to `git pull`
this repo onto the Pi. No extra secret is needed in `ops/cronicle/.env` for it.

## One-time Pi setup

From the repository root on the Pi:

```bash
cp ops/cronicle/.env.example ops/cronicle/.env
nano ops/cronicle/.env
chmod 600 ops/cronicle/.env
docker compose -f ops/cronicle/docker-compose.yml up -d
```

No web workspace install or build step is needed for the poller. The Cronicle
container only needs `node` plus the checked-in scripts mounted from this
directory. `scripts/poll-drodo.mjs` imports shared runtime helpers directly from
`shared/drodo-core.mjs`, generated from `shared/drodo-core.ts`; edit the
TypeScript source and run `npm run build:drodo-core` before deploying Pi jobs.

If Cronicle is installed directly on the Pi instead of via Docker, expose the
same scripts path that the jobs below use:

```bash
sudo ln -sfn "$PWD/ops/cronicle/scripts" /opt/cronicle/dac-scripts
```

The job wrappers source `ops/cronicle/.env` themselves, so they work in either
the Docker or direct systemd Cronicle setup.

Open Cronicle:

```text
http://<pi-hostname-or-ip>:3012
```

Default login for the packaged image is `admin` / `admin`. Change it first.

## Cronicle jobs to create

Create three **Shell Script** jobs in the Cronicle UI.

### Daily active poll

Schedule: once per day, before the full poll

```cron
17 3 * * *
```

Command:

```bash
/opt/cronicle/dac-scripts/poll-drodo-active.sh
```

This polls the active cohort whose `next_poll_at` is due:

- Steam players who signed in recently (14-day window).

Queen ladder rank alone does not keep a user in this cohort. The public
`/queens` board is capture-driven; Drodo view refresh is parked.

Unseeded active users are also pulled once and then join the adaptive cadence.

### Daily full poll

Schedule: once per day, off peak

```cron
17 4 * * *
```

Command:

```bash
/opt/cronicle/dac-scripts/poll-drodo-all.sh
```

This walks cached non-missing users whose shared `next_poll_at` is due, oldest
`drodo_last_fetched_at` first. Under the policy in `shared/drodo-core.ts`,
active users are due daily and inactive users weekly. It defaults to up to
10000 users per run (`DRODO_POLL_ALL_BATCH_SIZE`).

At the start of a new Auto Chess season, run the same script once with
`--season-sweep` to ignore `next_poll_at` and check all cached
non-missing users for fresh season activity:

```bash
/opt/cronicle/dac-scripts/poll-drodo-all.sh --season-sweep
```

### DAC patch-notes scrape

Schedule: hourly, at :17 past — same cadence as the disabled GitHub Actions job

```cron
17 * * * *
```

Command:

```bash
/opt/cronicle/dac-scripts/scrape-patch-notes.sh
```

This runs `scripts/scrape-patch-notes.mjs` against the Steam Workshop
changelog and, if it produced new `content/` files, commits and pushes them to
`main`. The wrapper resets `/workspace` to `origin/main` before scraping (this
checkout is long-lived and hourly, unlike a fresh Actions clone), and retries
the push once after a rebase if it's rejected by a concurrent push.

Steam occasionally serves an anti-bot response with no changelog entries to
GitHub-hosted runner IPs; that's the main reason this job moved here — a
residential IP shouldn't trigger it. The script's browser-rendered fallback
(via Playwright) still exists as defense in depth but isn't installed on the
Pi; see `scripts/scrape-patch-notes.mjs` if you want to add it.

## Manual smoke tests

Run from the Pi repo root:

```bash
docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/poll-drodo-active.sh

docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/poll-drodo-all.sh

docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/poll-drodo-all.sh --season-sweep

docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/scrape-patch-notes.sh
```

The poll scripts print a JSON summary and exit non-zero on failure, so
Cronicle marks the run failed and keeps the stderr/stdout logs. The scrape
script exits non-zero on any git or fetch failure (`set -eu`) and exits `0`
with "No new patch notes." when there's nothing to commit.

The shared Drodo parser/polling flow can also be smoke-tested from the repo
root without hitting Drodo or Supabase:

```bash
npm run test:drodo-core
```

## Updating after pulling repo changes

```bash
git pull
docker compose -f ops/cronicle/docker-compose.yml up -d
```

## Optional external dead-man monitoring

Cronicle shows job failures while the Pi is alive. To get alerted when the Pi or
home internet dies, add a hosted Healthchecks.io URL to `ops/cronicle/.env`:

```bash
HEALTHCHECK_URL=https://hc-ping.com/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Use separate Cronicle jobs / env files if you want separate active-vs-daily
Healthchecks alerts.
