-- Enforce public individual SteamID64s and remove stale fake user rows.
--
-- A SteamID64 for an individual user is the Steam base id plus a 32-bit
-- account id, so valid public user ids are in this inclusive range:
--   76561197960265728 .. 76561202255233023

BEGIN;

-- Child tables with direct Steam IDs must be cleaned before deleting users.
DELETE FROM match_players
WHERE steam_id < 76561197960265728
   OR steam_id > 76561202255233023;

DELETE FROM player_seasons
WHERE steam_id < 76561197960265728
   OR steam_id > 76561202255233023;

DELETE FROM mmr_snapshots
WHERE steam_id < 76561197960265728
   OR steam_id > 76561202255233023;

UPDATE matches
SET observer_steam_id = NULL
WHERE observer_steam_id IS NOT NULL
  AND (
    observer_steam_id < 76561197960265728
    OR observer_steam_id > 76561202255233023
  );

DELETE FROM users
WHERE steam_id < 76561197960265728
   OR steam_id > 76561202255233023;

-- Auth users created by Steam sign-in use either metadata.steam_id or a
-- synthetic <steam_id>@steam.local email. Remove the same invalid identities.
DELETE FROM auth.users
WHERE (
    raw_user_meta_data->>'steam_id' ~ '^\d+$'
    AND (
      (raw_user_meta_data->>'steam_id')::numeric < 76561197960265728
      OR (raw_user_meta_data->>'steam_id')::numeric > 76561202255233023
    )
  )
  OR (
    email ~ '^\d+@steam\.local$'
    AND (
      split_part(email, '@', 1)::numeric < 76561197960265728
      OR split_part(email, '@', 1)::numeric > 76561202255233023
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_steam_id_valid'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_steam_id_valid
      CHECK (steam_id BETWEEN 76561197960265728 AND 76561202255233023)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'player_seasons_steam_id_valid'
      AND conrelid = 'public.player_seasons'::regclass
  ) THEN
    ALTER TABLE public.player_seasons
      ADD CONSTRAINT player_seasons_steam_id_valid
      CHECK (steam_id BETWEEN 76561197960265728 AND 76561202255233023)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'match_players_steam_id_valid'
      AND conrelid = 'public.match_players'::regclass
  ) THEN
    ALTER TABLE public.match_players
      ADD CONSTRAINT match_players_steam_id_valid
      CHECK (steam_id BETWEEN 76561197960265728 AND 76561202255233023)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mmr_snapshots_steam_id_valid'
      AND conrelid = 'public.mmr_snapshots'::regclass
  ) THEN
    ALTER TABLE public.mmr_snapshots
      ADD CONSTRAINT mmr_snapshots_steam_id_valid
      CHECK (steam_id BETWEEN 76561197960265728 AND 76561202255233023)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_observer_steam_id_valid'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_observer_steam_id_valid
      CHECK (
        observer_steam_id IS NULL
        OR observer_steam_id BETWEEN 76561197960265728 AND 76561202255233023
      )
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.users VALIDATE CONSTRAINT users_steam_id_valid;
ALTER TABLE public.player_seasons VALIDATE CONSTRAINT player_seasons_steam_id_valid;
ALTER TABLE public.match_players VALIDATE CONSTRAINT match_players_steam_id_valid;
ALTER TABLE public.mmr_snapshots VALIDATE CONSTRAINT mmr_snapshots_steam_id_valid;
ALTER TABLE public.matches VALIDATE CONSTRAINT matches_observer_steam_id_valid;

COMMIT;
