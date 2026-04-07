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


def game_exists(user_id: str, played_at: str, placement: str, wl: str = "", level: str = "", lineup: str = "") -> bool:
    """Check if a player_game with these fields already exists.

    Uses a +/- 12 hour range around played_at since timestamps are approximate.
    Accepts string args for backwards compat with call sites.
    Returns True if duplicate found, False otherwise. Never raises.
    """
    client = _get_client()
    if client is None:
        return False

    try:
        dt = datetime.fromisoformat(played_at)
        range_start = (dt - timedelta(hours=12)).isoformat()
        range_end = (dt + timedelta(hours=12)).isoformat()
        placement_int = _safe_int(placement, 1, 8)
        if placement_int is None:
            return False

        params = {
            "user_id": f"eq.{user_id}",
            "placement": f"eq.{placement_int}",
            "select": "id,played_at",
            "played_at": f"gte.{range_start}",
            "limit": "1",
        }
        level_int = _safe_int(level, 1, 15)
        if level_int is not None:
            params["level"] = f"eq.{level_int}"

        resp = client.get(
            "/rest/v1/games",
            params=params,
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        results = [r for r in resp.json()
                   if r.get("played_at", "") <= range_end]
        found = len(results) > 0
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


def _safe_int(val, lo=None, hi=None):
    """Convert to int or return None. Optionally clamp to [lo, hi]."""
    try:
        n = int(str(val).strip())
        if lo is not None and n < lo:
            return None
        if hi is not None and n > hi:
            return None
        return n
    except (ValueError, TypeError):
        return None


def push_game(row, user_id: str | None = None) -> bool:
    """Insert a game into Supabase.

    Handles string→int conversion for placement, level, and wl splitting.
    Returns True on success, False on error. Never raises.
    """
    client = _get_client()
    if client is None:
        return False

    try:
        placement = _safe_int(row.placement, 1, 8)
        level = _safe_int(row.level, 1, 15)
        wins, losses = None, None
        wl = getattr(row, "wl", "")
        if wl and "-" in str(wl):
            parts = str(wl).split("-", 1)
            wins = _safe_int(parts[0])
            losses = _safe_int(parts[1])

        rank_change = row.rank_change if row.rank_change in ("up", "down", "none") else None

        game_data = {
            "played_at": row.played_at,
            "placement": placement,
            "rank": row.rank or None,
            "rank_change": rank_change,
            "lineup": row.lineup or None,
            "synergies": row.synergies or None,
            "talents": row.talents or None,
            "relic": row.relic or None,
            "level": level,
            "wins": wins,
            "losses": losses,
            "screenshot": row.screenshot or None,
            "replay": row.replay or None,
            "notes": row.notes or None,
        }
        if user_id:
            game_data["user_id"] = int(user_id)
        resp = client.post(
            "/rest/v1/games",
            json=game_data,
            headers={"Prefer": "return=representation"},
        )
        resp.raise_for_status()
        game_id = resp.json()[0]["id"]
        log.info("pushed game %d: placement=%s", game_id, row.placement)
        return True
    except Exception as e:
        log.error("push_game error: %s", e)
        return False


def upload_screenshot(img, user_id: str) -> str | None:
    """Compress a CV2 image to JPEG and upload to Supabase Storage.

    Returns the public URL on success, None on failure. Never raises.
    """
    client = _get_client()
    if client is None:
        return None

    try:
        from PIL import Image as PILImage
        import io
        import numpy as np

        # Convert BGR (cv2) to RGB for Pillow
        rgb = img[:, :, ::-1] if isinstance(img, np.ndarray) else img
        pil_img = PILImage.fromarray(rgb)
        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=60)
        jpeg_bytes = buf.getvalue()

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = f"{user_id}/{timestamp}.jpg"

        resp = client.post(
            f"/storage/v1/object/screenshots/{path}",
            content=jpeg_bytes,
            headers={
                "Content-Type": "image/jpeg",
                "Prefer": "",  # override default return=minimal
            },
        )
        resp.raise_for_status()

        # Build public URL
        base_url = client.base_url
        public_url = f"{base_url}/storage/v1/object/public/screenshots/{path}"
        log.info("uploaded screenshot: %s (%d KB)", path, len(jpeg_bytes) // 1024)
        return str(public_url)
    except Exception as e:
        log.error("upload_screenshot error: %s", e)
        return None


def fetch_games(user_id: str, limit: int = 20) -> list[dict] | None:
    """Fetch recent games for a user.

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
                "select": "*",
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
