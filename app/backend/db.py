"""Supabase database client for DAC Tools.

Pushes game data to a Supabase Postgres database via the PostgREST API.
Fails silently — DB errors never block the tracker.

Config keys in ~/.dac/config.json:
    supabase_url      — project URL (e.g. https://xyz.supabase.co)
    supabase_key      — anon/public API key
"""

import json
import logging
from dataclasses import asdict
from datetime import datetime, timedelta

from utils import LOCAL_GAMES_DIR, load_config, local_only_mode

log = logging.getLogger("dac.db")

_client = None  # lazy-init
_local_only_logged = False


def _get_client():
    """Lazy-init and return httpx.Client or None."""
    global _client, _local_only_logged
    if local_only_mode():
        if not _local_only_logged:
            log.info("DB skipped — local_only mode (writing JSON to %s)", LOCAL_GAMES_DIR)
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


DUPLICATE_WINDOW_DAYS = 3


def game_exists(user_id: str, played_at: str, placement: str, wl: str = "", level: str = "", lineup: str = "") -> bool:
    """Check if a duplicate player game already exists.

    A match is a duplicate when the *same player* has another game within
    DUPLICATE_WINDOW_DAYS that agrees on placement AND (W-L or level or lineup).
    This catches the case where the same MY MATCHES row is re-imported from
    multiple screenshots: the inferred ``played_at`` can drift by more than a
    day because we subtract whole days from the screenshot timestamp, so the
    previous ±12h window wasn't enough.

    Returns True if duplicate found, False otherwise. Never raises.
    """
    client = _get_client()
    if client is None:
        return False

    try:
        dt = datetime.fromisoformat(played_at)
        range_start = (dt - timedelta(days=DUPLICATE_WINDOW_DAYS)).isoformat()
        range_end = (dt + timedelta(days=DUPLICATE_WINDOW_DAYS)).isoformat()
        placement_int = _safe_int(placement, 1, 8)
        if placement_int is None:
            return False

        params = {
            "user_id": f"eq.{user_id}",
            "placement": f"eq.{placement_int}",
            "select": "id,played_at,level,wins,losses,lineup",
            "played_at": f"gte.{range_start}",
        }

        resp = client.get(
            "/rest/v1/games",
            params=params,
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        candidates = [
            r for r in resp.json() if r.get("played_at", "") <= range_end
        ]

        if not candidates:
            return False

        level_int = _safe_int(level, 1, 15)
        wins, losses = None, None
        if wl and "-" in str(wl):
            w_str, l_str = str(wl).split("-", 1)
            wins = _safe_int(w_str)
            losses = _safe_int(l_str)

        wanted_lineup = (lineup or "").strip()

        for r in candidates:
            matched_field = False
            if level_int is not None and r.get("level") == level_int:
                matched_field = True
            if (
                wins is not None
                and losses is not None
                and r.get("wins") == wins
                and r.get("losses") == losses
            ):
                matched_field = True
            if wanted_lineup and (r.get("lineup") or "").strip() == wanted_lineup:
                matched_field = True
            if matched_field:
                log.debug(
                    "duplicate found: user=%s played_at=%s place=%s match=%s",
                    user_id, played_at, placement, r.get("id"),
                )
                return True
        return False
    except Exception as e:
        log.error("game_exists error: %s", e)
        return False


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


def _save_game_local(row, user_id: str | None) -> None:
    """Mirror every push_game payload to ~/.dac/games/ so testing data is
    preserved even when Supabase is offline / disabled."""
    try:
        LOCAL_GAMES_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        placement = str(getattr(row, "placement", "")) or "x"
        path = LOCAL_GAMES_DIR / f"{ts}__p{placement}.json"
        payload = {
            "saved_at": datetime.now().isoformat(),
            "user_id": str(user_id) if user_id else "",
            "game": asdict(row) if hasattr(row, "__dataclass_fields__") else dict(row.__dict__),
        }
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        log.info("game saved locally: %s", path.name)
    except Exception as e:
        log.warning("_save_game_local failed: %s", e)


def push_game(row, user_id: str | None = None) -> int | None:
    """Insert a game into Supabase.

    Always writes a JSON sidecar to ~/.dac/games/ first so local testing
    captures the payload even when Supabase is disabled.
    Returns the inserted game id on success, or None on error. Never raises.
    """
    _save_game_local(row, user_id)

    client = _get_client()
    if client is None:
        return None

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
        match_id = getattr(row, "match_id", "") or None
        if match_id:
            game_data["match_id"] = match_id
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
        return int(game_id)
    except Exception as e:
        body = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                body = e.response.text
            except Exception:
                pass
        log.error("push_game error: %s | body: %s", e, body)
        return None


def generate_match_id() -> str:
    """Generate a unique match_id for linking all players in a match."""
    import uuid
    return str(uuid.uuid4())[:12]


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


def _save_json_local(directory, filename: str, payload: dict) -> None:
    """Mirror a payload to a local sidecar dir under ~/.dac/. Best-effort."""
    try:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / filename).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
    except Exception as e:
        log.warning("_save_json_local(%s) failed: %s", filename, e)


def push_match(match_record: dict) -> str | None:
    """Insert one row into `matches`. Returns match_id on success, None on
    failure or in local_only mode. Mirrors to ~/.dac/matches/ first."""
    from utils import LOCAL_MATCHES_DIR
    match_id = str(match_record.get("match_id") or "").strip()
    if not match_id:
        log.warning("push_match: missing match_id")
        return None
    _save_json_local(LOCAL_MATCHES_DIR, f"{match_id}.json", match_record)

    client = _get_client()
    if client is None:
        return None

    try:
        row = {
            "match_id": match_id,
            "played_at": match_record.get("played_at"),
            "duration": match_record.get("duration") or None,
            "final_round": match_record.get("final_round") or None,
            "player_count": match_record.get("player_count") or None,
        }
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
}


def push_match_players(match_id: str, players: list[dict]) -> int:
    """Bulk-insert up to 8 rows into `match_players`. Returns count of
    rows POSTed (0 on failure or local_only). Mirrors to local first.

    Uses ignore-duplicates so two observers in the same lobby can both call
    this with the same match_id and the second is a no-op via the UNIQUE
    (match_id, steam_id) constraint."""
    from utils import LOCAL_MATCH_PLAYERS_DIR
    if not players:
        return 0
    for p in players:
        sid = str(p.get("steam_id") or "x")
        placement = p.get("placement") or "X"
        _save_json_local(
            LOCAL_MATCH_PLAYERS_DIR,
            f"{match_id}__p{placement}__{sid}.json",
            p,
        )

    client = _get_client()
    if client is None:
        return 0

    try:
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


def push_live_game(player_row: dict) -> int | None:
    """Insert a trimmed row into `games` from the live-capture path.

    Shape mirrors what the CV path writes via push_game, so the web viewer's
    player profile (`players/[steamId]`) renders it identically. Dedup is
    enforced by the partial unique index idx_games_live_dedup on
    (match_id, user_id) WHERE length(match_id) = 16."""
    client = _get_client()
    if client is None:
        return None

    try:
        steam_id = str(player_row.get("steam_id") or "").strip()
        if not steam_id:
            return None
        placement = _safe_int(player_row.get("placement"), 1, 8)
        level = _safe_int(player_row.get("hero_level"), 1, 15)
        wins = _safe_int(player_row.get("win_round"))
        losses = _safe_int(player_row.get("lose_round"))

        row = {
            "played_at": player_row.get("played_at"),
            "placement": placement,
            "lineup": player_row.get("chess_lineup") or None,
            "synergies": player_row.get("synergies") or None,
            "talents": player_row.get("talents") or None,
            "relic": player_row.get("relic") or None,
            "level": level,
            "wins": wins,
            "losses": losses,
            "match_id": player_row.get("match_id"),
            "user_id": int(steam_id),
        }
        resp = client.post(
            "/rest/v1/games",
            json=row,
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )
        resp.raise_for_status()
        return 1
    except Exception as e:
        body = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                body = e.response.text
            except Exception:
                pass
        log.error("push_live_game error: %s | body: %s", e, body)
        return None


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
