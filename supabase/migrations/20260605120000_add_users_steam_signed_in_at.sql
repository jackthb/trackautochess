ALTER TABLE users
  ADD COLUMN IF NOT EXISTS steam_signed_in_at timestamptz;

UPDATE users u
SET steam_signed_in_at = COALESCE(u.steam_signed_in_at, au.created_at)
FROM auth.users au
WHERE au.email = (u.steam_id::text || '@steam.local')
  AND u.steam_signed_in_at IS NULL;

CREATE INDEX IF NOT EXISTS users_signed_in_next_poll_at_idx
  ON users (next_poll_at)
  WHERE drodo_last_fetched_at IS NOT NULL
    AND steam_signed_in_at IS NOT NULL;
