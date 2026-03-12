"""Supabase database client for DAC Tools.

Pushes game data to a Supabase Postgres database via the PostgREST API.
Fails silently — DB errors never block the tracker.

Config keys in ~/.dac/config.json:
    supabase_url      — project URL (e.g. https://xyz.supabase.co)
    supabase_key      — anon/public API key
"""

import logging
from dataclasses import asdict
from datetime import datetime, timedelta

from utils import load_config

log = logging.getLogger("dac.db")

_client = None  # lazy-init


def _get_client():
    """Lazy-init and return httpx.Client or None."""
    global _client
    if _client is not None:
        return _client

    config = load_config()
    url = config.get("supabase_url", "")
    key = config.get("supabase_key", "")
    if not url or not key:
        log.warning("supabase_url or supabase_key missing from config — DB disabled")
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
    log.info("DB client configured: %s", url)
    return client


def game_exists(user_id: str, played_at: str, placement: str, wl: str, level: str, lineup: str = "") -> bool:
    """Check if a game with these fields already exists in Supabase.

    Uses a +/- 12 hour range around played_at since timestamps are approximate.
    Includes lineup when available to distinguish same-session games.
    Returns True if duplicate found, False otherwise. Never raises.
    """
    client = _get_client()
    if client is None:
        return False

    try:
        dt = datetime.fromisoformat(played_at)
        range_start = (dt - timedelta(hours=12)).isoformat()
        range_end = (dt + timedelta(hours=12)).isoformat()
        params = {
            "and": f"(played_at.gte.{range_start},played_at.lte.{range_end})",
            "user_id": f"eq.{user_id}",
            "placement": f"eq.{placement}",
            "wl": f"eq.{wl}",
            "level": f"eq.{level}",
            "select": "id",
            "limit": "1",
        }
        if lineup:
            params["lineup"] = f"eq.{lineup}"
        resp = client.get(
            "/rest/v1/games",
            params=params,
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        found = len(resp.json()) > 0
        if found:
            log.debug("duplicate found: user=%s played_at=%s place=%s", user_id, played_at, placement)
        return found
    except Exception as e:
        log.error("game_exists error: %s", e)
        return False


def ensure_user(user_id: str) -> bool:
    """Upsert a user row so the FK constraint is satisfied. Never raises."""
    client = _get_client()
    if client is None:
        return False
    try:
        resp = client.post(
            "/rest/v1/users",
            json={"steam_id": int(user_id)},
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )
        resp.raise_for_status()
        log.info("ensure_user: ok (%s)", user_id)
        return True
    except Exception as e:
        log.error("ensure_user error: %s", e)
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
            data["user_id"] = int(user_id)
        resp = client.post("/rest/v1/games", json=data)
        resp.raise_for_status()
        log.info("pushed game: placement=%s", data.get("placement"))
        return True
    except Exception as e:
        log.error("push_game error: %s", e)
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
                "order": "played_at.desc",
                "limit": str(limit),
            },
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        games = resp.json()
        log.debug("fetched %d game(s) for user %s", len(games), user_id)
        return games
    except Exception as e:
        log.error("fetch_games error: %s", e)
        return None
