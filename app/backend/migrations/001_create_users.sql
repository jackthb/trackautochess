-- Create users table
CREATE TABLE IF NOT EXISTS users (
    steam_id    text PRIMARY KEY,
    created_at  timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'anon_insert'
    ) THEN
        CREATE POLICY anon_insert ON users FOR INSERT TO anon WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'anon_select'
    ) THEN
        CREATE POLICY anon_select ON users FOR SELECT TO anon USING (true);
    END IF;
END $$;

-- Add user_id column to games and link to users
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS user_id text;

ALTER TABLE games
    ADD CONSTRAINT fk_games_user
    FOREIGN KEY (user_id) REFERENCES users (steam_id);
