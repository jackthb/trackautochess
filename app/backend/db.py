"""Supabase database client for DAC Tools.

Pushes game data to a Supabase Postgres database via the PostgREST API.
Fails silently — DB errors never block the tracker.

Config keys in ~/.dac/config.json:
    supabase_url      — project URL (e.g. https://xyz.supabase.co)
    supabase_key      — anon/public API key
"""

import json
import logging
import re
from datetime import datetime, timedelta

from utils import load_config, local_only_mode

log = logging.getLogger("dac.db")

_client = None  # lazy-init
_local_only_logged = False
QUEEN_LADDER_UPDATE_MIN_INTERVAL = timedelta(hours=24)



def _get_client():
    """Lazy-init and return httpx.Client or None."""
    global _client, _local_only_logged
    if local_only_mode():
        if not _local_only_logged:
            log.info("DB skipped — local_only mode")
            _local_only_logged = True
        return None
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


def ensure_user(user_id: str, name: str | None = None, custom_url: str | None = None) -> bool:
    """Upsert a user row so the FK constraint is satisfied.

    If *name* or *custom_url* are provided the row is updated on conflict so the
    stored Steam metadata stays fresh. Never raises.
    """
    client = _get_client()
    if client is None:
        return False
    try:
        row: dict = {"steam_id": int(user_id)}
        if name:
            row["name"] = name
        if custom_url:
            row["custom_url"] = custom_url

        # merge-duplicates will UPDATE the name/custom_url columns when the
        # steam_id already exists; ignore-duplicates would skip the update.
        resolution = "merge-duplicates" if name or custom_url else "ignore-duplicates"
        resp = client.post(
            "/rest/v1/users",
            json=row,
            headers={"Prefer": f"resolution={resolution},return=minimal"},
        )
        resp.raise_for_status()
        log.info("ensure_user: ok (%s, name=%s)", user_id, name)
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


def _parse_iso_datetime(value) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        normalized = value.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        return parsed.astimezone() if parsed.tzinfo is not None else parsed
    except ValueError:
        return None


def _normalize_season_key(value) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    match = re.search(r"\d+", raw)
    if match:
        return f"s{int(match.group(0))}"
    return raw


def _queen_ladder_recently_updated(client, now: datetime) -> bool:
    """Return True when the DB already has a Queen ladder scan from the last day.

    This is intentionally global, not per-client: if a few beta EXEs are
    running at once, the first accepted in-game ladder sync owns the website's
    Queen ladder row set for the cadence window.
    """
    try:
        resp = client.get(
            "/rest/v1/users",
            params={
                "select": "queen_ladder_last_seen_at",
                "queen_ladder_last_seen_at": "not.is.null",
                "order": "queen_ladder_last_seen_at.desc",
                "limit": "1",
            },
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        rows = resp.json()
        if not isinstance(rows, list) or not rows:
            return False
        last_seen = _parse_iso_datetime(rows[0].get("queen_ladder_last_seen_at"))
        if last_seen is None:
            return False
        if last_seen.tzinfo is None and now.tzinfo is not None:
            last_seen = last_seen.replace(tzinfo=now.tzinfo)
        return now - last_seen < QUEEN_LADDER_UPDATE_MIN_INTERVAL
    except Exception as e:
        # The throttle is a max-cadence guard. If we cannot prove the last
        # update is old enough, skip rather than risk hammering the ladder.
        log.warning("queen ladder throttle check failed; skipping update: %s", e)
        return True


def _clear_queen_ladder_snapshot(client) -> bool:
    """Clear previous in-game Queen ladder fields before writing a new scan."""
    try:
        resp = client.patch(
            "/rest/v1/users",
            params={"queen_ladder_last_seen_at": "not.is.null"},
            json={
                "queen_ladder_rank": None,
                "queen_ladder_mmr": None,
                "queen_ladder_season": None,
                "queen_ladder_last_seen_at": None,
            },
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        body = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                body = e.response.text
            except Exception:
                pass
        log.error("clear queen ladder snapshot error: %s | body: %s", e, body)
        return False


def generate_live_match_id(end_board: dict) -> str:
    """Deterministic match_id from end_board contents.

    SHA-256 of the sorted (steam_id, placement) pairs from end_board.data,
    truncated to 16 hex chars. Two installs in the same DAC lobby produce
    the same match_id, so cross-observer dedup works without coordination.
    Falls back to a uuid when the payload is missing/malformed.
    """
    import hashlib
    import uuid
    data = end_board.get("data") if isinstance(end_board, dict) else None
    if not isinstance(data, dict) or not data:
        return str(uuid.uuid4()).replace("-", "")[:16]
    pairs: list[tuple[str, int]] = []
    for sid, p in data.items():
        if not isinstance(p, dict):
            continue
        rank = p.get("curr_rank") or p.get("rank") or 0
        try:
            rank_i = int(rank)
        except (TypeError, ValueError):
            rank_i = 0
        pairs.append((str(sid), rank_i))
    pairs.sort()
    canonical = json.dumps(pairs, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def push_match(match_record: dict) -> str | None:
    """Insert one row into `matches`. Returns match_id on success, None on
    failure or in local_only mode."""
    match_id = str(match_record.get("match_id") or "").strip()
    if not match_id:
        log.warning("push_match: missing match_id")
        return None

    row = {
        "match_id": match_id,
        "played_at": match_record.get("played_at"),
        "duration": match_record.get("duration") or None,
        "final_round": match_record.get("final_round") or None,
        "player_count": match_record.get("player_count") or None,
        "capture_status": match_record.get("capture_status") or "complete",
        "is_finished": bool(match_record.get("is_finished", True)),
        "verification_source": match_record.get("verification_source") or "end_board",
        "verified_at": match_record.get("verified_at") or match_record.get("played_at"),
        "capture_started_at": match_record.get("capture_started_at"),
        "capture_ended_at": match_record.get("capture_ended_at") or match_record.get("played_at"),
        "observer_steam_id": match_record.get("observer_steam_id") or None,
    }
    if row["observer_steam_id"] is not None:
        try:
            row["observer_steam_id"] = int(str(row["observer_steam_id"]).strip())
        except (TypeError, ValueError):
            row["observer_steam_id"] = None
    client = _get_client()
    if client is None:
        return None

    try:
        resp = client.post(
            "/rest/v1/matches",
            json=row,
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )
        resp.raise_for_status()
        log.info("pushed match %s", match_id)
        return match_id
    except Exception as e:
        body = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                body = e.response.text
            except Exception:
                pass
        log.error("push_match error: %s | body: %s", e, body)
        return None


# Columns that match the match_players table schema. Anything not in this set
# is dropped before POST so a future end_board with extra fields doesn't break
# the insert (PostgREST 400s on unknown columns).
_MATCH_PLAYER_COLUMNS = {
    "match_id", "steam_id", "placement", "mmr_level", "hero_level",
    "chess_lineup", "chess_hand", "synergies", "relic", "relic_history",
    "talents", "win_round", "lose_round", "draw_round", "kills", "deaths",
    "hero_damage", "hero_damaged", "mvp_chess_name", "mvp_chess_items",
    "max_lineup_value", "max_lineup_value_lineup", "duration", "final_round",
    "zhugong", "total_money", "candy",
    "played_at", "screenshot", "notes", "replay", "created_at",
}


def push_match_players(match_id: str, players: list[dict]) -> int:
    """Bulk-insert up to 8 rows into `match_players`. Returns count of
    rows POSTed (0 on failure or local_only).

    Uses ignore-duplicates so two observers in the same lobby can both call
    this with the same match_id and the second is a no-op via the UNIQUE
    (match_id, steam_id) constraint."""
    if not players:
        return 0

    rows = []
    for p in players:
        r = {k: v for k, v in p.items() if k in _MATCH_PLAYER_COLUMNS}
        # steam_id stored as bigint server-side
        if "steam_id" in r:
            try:
                r["steam_id"] = int(str(r["steam_id"]).strip())
            except (TypeError, ValueError):
                continue
        r["match_id"] = match_id
        rows.append(r)
    if not rows:
        return 0

    client = _get_client()
    if client is None:
        return 0

    try:
        resp = client.post(
            "/rest/v1/match_players",
            json=rows,
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )
        resp.raise_for_status()
        log.info("pushed %d match_players row(s) for match %s", len(rows), match_id)
        return len(rows)
    except Exception as e:
        body = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                body = e.response.text
            except Exception:
                pass
        log.error("push_match_players error: %s | body: %s", e, body)
        return 0



def upsert_queen_ladder_players(players: list[dict]) -> int:
    """Upsert player identities discovered from the in-game Queen ladder.

    The ranking_top_table payload is the only place the desktop app can see
    the top Queen ladder without somebody searching each player manually. We
    cache the Steam IDs plus lightweight ladder metadata in `users`; the web
    cron can later hydrate full Drodo profiles from those users rows.
    """
    if not players:
        return 0

    client = _get_client()
    if client is None:
        return 0

    now_dt = datetime.now().astimezone()
    if _queen_ladder_recently_updated(client, now_dt):
        log.info("queen ladder upsert skipped — updated within the last hour")
        return 0

    seen: set[int] = set()
    rows = []
    now = now_dt.isoformat()
    for p in players:
        try:
            steam_id = int(str(p.get("steam_id") or "").strip())
        except (TypeError, ValueError):
            continue
        if steam_id in seen:
            continue
        seen.add(steam_id)

        row: dict = {
            "steam_id": steam_id,
            "queen_ladder_last_seen_at": p.get("seen_at") or now,
        }
        name = str(p.get("name") or "").strip()
        if name:
            row["name"] = name
        season = _normalize_season_key(p.get("season"))
        if season:
            row["queen_ladder_season"] = season
        rank = _safe_int(p.get("rank"), lo=1)
        if rank is not None:
            row["queen_ladder_rank"] = rank
        mmr = _safe_int(p.get("mmr"), lo=0)
        if mmr is not None:
            row["queen_ladder_mmr"] = mmr
            # The Queen ladder consists of Queen players; setting these fields
            # lets public leaderboards show them immediately, before a Drodo
            # profile refresh fills in richer season stats.
            row.setdefault("drodo_mmr", mmr)
            row.setdefault("drodo_mmr_level", 38)
        rows.append(row)

    if not rows:
        return 0

    if not _clear_queen_ladder_snapshot(client):
        return 0

    try:
        resp = client.post(
            "/rest/v1/users",
            json=rows,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        resp.raise_for_status()
        log.info("upserted %d queen ladder user row(s)", len(rows))
        return len(rows)
    except Exception as e:
        body = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                body = e.response.text
            except Exception:
                pass
        log.error("upsert_queen_ladder_players error: %s | body: %s", e, body)
        return 0

def lookup_users_by_name(names: list[str]) -> dict[str, int]:
    """Look up existing users by display name (case-insensitive).

    Returns dict mapping lowercased name → steam_id for names that matched.
    Only matches users that already exist in the database.
    """
    client = _get_client()
    if client is None or not names:
        return {}

    try:
        # Fetch all users that have a name set
        resp = client.get(
            "/rest/v1/users",
            params={
                "name": f"not.is.null",
                "select": "steam_id,name",
            },
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        users = resp.json()

        # Build a lookup: lowercased DB name → steam_id
        db_lookup: dict[str, int] = {}
        for u in users:
            if u.get("name"):
                db_lookup[u["name"].lower()] = u["steam_id"]

        # Match OCR'd names against DB names
        result: dict[str, int] = {}
        for name in names:
            if not name:
                continue
            key = name.lower().strip()
            if key in db_lookup:
                result[key] = db_lookup[key]
        return result
    except Exception as e:
        log.error("lookup_users_by_name error: %s", e)
        return {}


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


def upload_diagnostic_log(
    user_id: str,
    name: str,
    data: bytes,
    content_type: str = "application/gzip",
    subdir: str | None = None,
    upsert: bool = True,
) -> str | None:
    """Upload a diagnostic log blob to the PRIVATE ``diagnostic-logs`` bucket.

    Mirrors ``upload_screenshot``. Returns the object path
    (``diagnostic-logs/{user_id}/{subdir}/{name}``) on success so it can be
    referenced from a PostHog event and looked up in the Supabase dashboard.
    The bucket is private, so no public URL is built. Returns None on failure
    and never raises.

    ``subdir`` lets the caller pin a stable per-session folder so periodic
    re-uploads overwrite the same object (with ``upsert``) instead of piling up
    one object per upload. Defaults to a fresh timestamp when omitted.
    """
    client = _get_client()
    if client is None:
        return None

    try:
        subdir = subdir or datetime.now().strftime("%Y%m%d_%H%M%S")
        path = f"{user_id}/{subdir}/{name}"

        headers = {
            "Content-Type": content_type,
            "Prefer": "",  # override default return=minimal
        }
        if upsert:
            # Overwrite an existing object at this path instead of 400ing.
            headers["x-upsert"] = "true"

        resp = client.post(
            f"/storage/v1/object/diagnostic-logs/{path}",
            content=data,
            headers=headers,
        )
        resp.raise_for_status()

        object_path = f"diagnostic-logs/{path}"
        log.info("uploaded diagnostic log: %s (%d KB)", object_path, len(data) // 1024)
        return object_path
    except Exception as e:
        log.error("upload_diagnostic_log error: %s", e)
        return None
