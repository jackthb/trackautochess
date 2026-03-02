"""Supabase database client for DAC Tools.

Pushes game data to a Supabase Postgres database via the PostgREST API.
Fails silently — DB errors never block the tracker.

Config keys in ~/.dac/config.json:
    supabase_url      — project URL (e.g. https://xyz.supabase.co)
    supabase_key      — anon/public API key
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


def game_exists(user_id: str, date: str, placement: str, wl: str, level: str) -> bool:
    """Check if a game with these fields already exists in Supabase.

    Returns True if duplicate found, False otherwise. Never raises.
    """
    client = _get_client()
    if client is None:
        return False

    try:
        resp = client.get(
            "/rest/v1/games",
            params={
                "user_id": f"eq.{user_id}",
                "date": f"eq.{date}",
                "placement": f"eq.{placement}",
                "wl": f"eq.{wl}",
                "level": f"eq.{level}",
                "select": "id",
                "limit": "1",
            },
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return len(resp.json()) > 0
    except Exception:
        return False


def ensure_user(user_id: str) -> bool:
    """Upsert a user row so the FK constraint is satisfied. Never raises."""
    client = _get_client()
    if client is None:
        print("[db] ensure_user: no client configured")
        return False
    try:
        resp = client.post(
            "/rest/v1/users",
            json={"steam_id": int(user_id)},
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )
        resp.raise_for_status()
        print(f"[db] ensure_user: ok ({user_id})")
        return True
    except Exception as e:
        print(f"[db] ensure_user error: {e}")
        return False


def push_game(row, user_id: str | None = None) -> bool:
    """Insert a GameRow into the Supabase games table.

    Returns True on success, False on error. Never raises.
    """
    client = _get_client()
    if client is None:
        return False

    try:
        data = {k: str(v) if v else None for k, v in asdict(row).items()}
        if user_id:
            data["user_id"] = user_id
        resp = client.post("/rest/v1/games", json=data)
        resp.raise_for_status()
        print(f"[db] pushed game: placement={data.get('placement')}")
        return True
    except Exception as e:
        print(f"[db] push error: {e}")
        return False


def fetch_games(user_id: str, limit: int = 20) -> list[dict] | None:
    """Fetch recent games for a user from Supabase.

    Returns list of game dicts on success, None on error.
    """
    client = _get_client()
    if client is None:
        return None

    try:
        resp = client.get(
            "/rest/v1/games",
            params={
                "user_id": f"eq.{user_id}",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[db] fetch error: {e}")
        return None


if __name__ == "__main__":
    print("DB module loaded. Use push_game() and fetch_games() via PostgREST.")
