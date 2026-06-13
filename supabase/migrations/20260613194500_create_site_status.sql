-- Site-wide status banner, editable at runtime with no redeploy.
--
-- A singleton row the site reads on every page (via /api/site-status) to show
-- a banner — e.g. "something is broken, working on it". Flip `active` / edit
-- `message` from the Supabase dashboard and it appears/updates within ~a minute
-- for everyone, no deploy required.

CREATE TABLE IF NOT EXISTS site_status (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    active boolean NOT NULL DEFAULT false,
    message text,
    level text NOT NULL DEFAULT 'warning' CHECK (level IN ('info', 'warning', 'error')),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE site_status ENABLE ROW LEVEL SECURITY;

-- Public read only. Writes happen via the Supabase dashboard (service role).
DROP POLICY IF EXISTS site_status_anon_select ON site_status;
CREATE POLICY site_status_anon_select ON site_status FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS site_status_auth_select ON site_status;
CREATE POLICY site_status_auth_select ON site_status FOR SELECT TO authenticated USING (true);

-- Seed the current Queens apology, active. ON CONFLICT DO NOTHING so re-running
-- the migration never resurrects a banner that was later turned off.
INSERT INTO site_status (id, active, message, level)
VALUES (
    1,
    true,
    'Sorry — the Queens page is currently broken. We''re working on a fix.',
    'warning'
)
ON CONFLICT (id) DO NOTHING;
