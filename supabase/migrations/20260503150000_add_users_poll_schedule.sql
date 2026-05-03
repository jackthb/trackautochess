-- Adaptive polling schedule for Drodo profile pulls. A cron job picks the
-- next batch of users where next_poll_at <= now() and updates the schedule
-- after each pull: when the profile changed (mmr / season_games /
-- chicken_count) the interval resets to 1 hour, otherwise it multiplies
-- by 1.5 capped at 7 days. Manual refreshes also reset to 1 hour.
--
-- Defaulting next_poll_at to now() means the first cron tick after this
-- migration immediately picks up every existing user; the adaptive logic
-- spreads them out from there.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS next_poll_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS poll_interval_seconds integer NOT NULL DEFAULT 3600;

CREATE INDEX IF NOT EXISTS users_next_poll_at_idx
  ON users (next_poll_at)
  WHERE drodo_last_fetched_at IS NOT NULL;
