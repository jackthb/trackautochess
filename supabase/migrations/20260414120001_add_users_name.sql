-- Add Steam display name and custom URL to users table so we don't have to
-- call the Steam API on every page load.
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_url text;

-- Allow the anon role to update the name/custom_url columns (desktop app + web).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'users_update'
    ) THEN
        CREATE POLICY users_update ON users FOR UPDATE USING (true) WITH CHECK (true);
    END IF;
END $$;
