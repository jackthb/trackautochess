-- Banned flag for users. Banned users are hidden from the public site
-- (profile 404, leaderboard, search, OG images, cron poll) and rejected
-- when their Steam OpenID flow tries to mint a Supabase session.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS users_banned_idx
  ON users (banned)
  WHERE banned = true;
