# Raspberry Pi Drodo poller with Cronicle

This folder packages a self-hosted Cronicle scheduler for the Drodo background
poller. Run it on the Raspberry Pi after pulling this monorepo.

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

The GitHub Actions schedule for `Poll Drodo (MMR snapshots)` has been disabled;
it remains manually runnable only as an emergency/operator-triggered fallback.

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

Create two **Shell Script** jobs in the Cronicle UI.

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

- Steam players who signed in recently.
- Known Queen ladder players.

Unseeded active users are also pulled once and then join the adaptive cadence.
The five-minute Queen refresh endpoint still updates the visible Queen table
between daily background runs.

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
`drodo_last_fetched_at` first. Under the simple policy in `shared/drodo-core.ts`,
active and inactive cached users are due daily. It defaults to up to 10000 users
per run (`DRODO_POLL_ALL_BATCH_SIZE`).

At the start of a new Auto Chess season, run the same script once with
`--season-sweep` to ignore `next_poll_at` and check all cached
non-missing users for fresh season activity:

```bash
/opt/cronicle/dac-scripts/poll-drodo-all.sh --season-sweep
```

## Manual smoke tests

Run from the Pi repo root:

```bash
docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/poll-drodo-active.sh

docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/poll-drodo-all.sh

docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/poll-drodo-all.sh --season-sweep
```

The scripts print a JSON summary and exit non-zero on failure, so Cronicle marks
the run failed and keeps the stderr/stdout logs.

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
