"""Supabase database client for DAC Tools.

Pushes game data to a Supabase Postgres database via the PostgREST API.
Uses httpx for inserts, psycopg2 for schema setup. Fails silently —
DB errors never block the tracker.

Config keys in ~/.dac/config.json:
    supabase_url      — project URL (e.g. https://xyz.supabase.co)
    supabase_key      — anon/public API key
    supabase_db_url   — direct Postgres connection string
                        (e.g. postgresql://postgres.xxx:pw@host:5432/postgres)
"""

import json
from dataclasses import asdict
from pathlib import Path

_client = None  # lazy-init

GAMES_TABLE_SQL = """\
CREATE TABLE IF NOT EXISTS games (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date        text NOT NULL,
    placement   text NOT NULL,
    rank        text,
    rank_change text CHECK (rank_change IN ('up', 'down', 'none')),
    lineup      text,
    synergies   text,
    talents     text,
    relic       text,
    level       text,
    wl          text,
    screenshot  text,
    notes       text,
    created_at  timestamptz DEFAULT now()
);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'games' AND policyname = 'anon_insert'
    ) THEN
        CREATE POLICY anon_insert ON games FOR INSERT TO anon WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'games' AND policyname = 'anon_select'
    ) THEN
        CREATE POLICY anon_select ON games FOR SELECT TO anon USING (true);
    END IF;
END $$;
"""


def _load_config() -> dict:
    """Return config dict from ~/.dac/config.json."""
    config_path = Path.home() / ".dac" / "config.json"
    if not config_path.exists():
        return {}
    try:
        return json.loads(config_path.read_text())
    except Exception:
        return {}


def setup_db() -> bool:
    """Create the games table if it doesn't exist. Requires supabase_db_url.

    Returns True on success, False on error.
    """
    config = _load_config()
    db_url = config.get("supabase_db_url", "")
    if not db_url:
        print("[db] No supabase_db_url configured, skipping setup.")
        return False

    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(GAMES_TABLE_SQL)
        conn.close()
        print("[db] games table ready.")
        return True
    except Exception as e:
        print(f"[db] setup error: {e}")
        return False


def _get_client():
    """Lazy-init and return httpx.Client or None."""
    global _client
    if _client is not None:
        return _client

    config = _load_config()
    url = config.get("supabase_url", "")
    key = config.get("supabase_key", "")
    if not url or not key:
        return None

    import httpx
    client = httpx.Client(
        base_url=url.rstrip("/"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        timeout=15,
    )
    _client = client
    return client


def push_game(row) -> bool:
    """Insert a GameRow into the Supabase games table.

    Returns True on success, False on error. Never raises.
    """
    client = _get_client()
    if client is None:
        return False

    try:
        data = {k: str(v) if v else None for k, v in asdict(row).items()}
        resp = client.post("/rest/v1/games", json=data)
        resp.raise_for_status()
        print(f"[db] pushed game: placement={data.get('placement')}")
        return True
    except Exception as e:
        print(f"[db] push error: {e}")
        return False


if __name__ == "__main__":
    setup_db()
