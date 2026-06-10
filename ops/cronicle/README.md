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

No web workspace install is needed for the poller. The Cronicle container only
needs `node` plus the checked-in scripts mounted from this directory.

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

### Active/high-priority poll

Schedule: every 10 minutes

```cron
*/10 * * * *
```

Command:

```bash
/opt/cronicle/dac-scripts/poll-drodo-active.sh
```

This polls active users: recently signed-in players, known Queen ladder players,
and users with a known Drodo queen rank whose `next_poll_at` is due. Successful
Queen/active pulls use a hot adaptive schedule: changed rows reset to 10
minutes, unchanged rows back off slowly and cap at 30 minutes. Unseeded active
users are also pulled once and start on the 10-minute cadence.

### Daily full poll

Schedule: once per day, off peak

```cron
17 4 * * *
```

Command:

```bash
/opt/cronicle/dac-scripts/poll-drodo-all.sh
```

This walks cached non-missing users from oldest `drodo_last_fetched_at` first and
uses the same adaptive backoff/snapshot logic as the active poller. It defaults
to up to 10000 users per run (`DRODO_POLL_ALL_BATCH_SIZE`), so it should cover
everyone daily unless the user table grows past that.

## Manual smoke tests

Run from the Pi repo root:

```bash
docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/poll-drodo-active.sh

docker compose -f ops/cronicle/docker-compose.yml exec cronicle \
  /opt/cronicle/dac-scripts/poll-drodo-all.sh
```

The scripts print a JSON summary and exit non-zero on failure, so Cronicle marks
the run failed and keeps the stderr/stdout logs.

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
