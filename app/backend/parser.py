"""Parse end-of-game screenshots using Ollama vision (two-call approach)."""

import base64
import json
from pathlib import Path

import httpx

from models import GameRow  # alias for PlayerGameRow
from image_utils import synergy_crops_b64

PROMPTS_DIR = Path(__file__).parent / "prompts"
_ANALYZER_DATA = Path(__file__).parent.parent.parent / "analyzer" / "dac_analyzer" / "data"


# ── helpers ──────────────────────────────────────────────────────────────────

def _load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")


def _load_synergies() -> list[str]:
    units_path = _ANALYZER_DATA / "units.json"
    if not units_path.exists():
        return []
    data = json.loads(units_path.read_text())
    return sorted({s for u in data["units"].values() for s in u["synergies"]})


def _image_to_base64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode()


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0].strip()
    return text


def _ollama(
    model: str,
    base_url: str,
    prompt: str,
    images: list[str],
) -> str | None:
    """Single Ollama chat call. Returns response text or None on error."""
    url = f"{base_url.rstrip('/')}/api/chat"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt, "images": images}],
        "stream": False,
        "options": {"num_ctx": 4096},
    }
    try:
        r = httpx.post(url, json=payload, timeout=120.0)
        r.raise_for_status()
        return r.json()["message"]["content"]
    except httpx.ConnectError:
        print(f"[tracker] ERROR: Ollama not reachable at {base_url}. Run: ollama serve")
        return None
    except httpx.HTTPStatusError as e:
        print(f"[tracker] ERROR: Ollama HTTP {e.response.status_code}: {e.response.text[:200]}")
        return None


# ── step 1: synergy detection ─────────────────────────────────────────────────

def _detect_synergies(
    image_path: Path,
    model: str,
    base_url: str,
) -> str:
    """
    Focused call using only synergy-area crops.
    Returns a pipe-separated "Name:Count" string, or "" on failure.
    """
    synergy_list = ", ".join(_load_synergies())
    crops = synergy_crops_b64(image_path)

    prompt = f"""You are looking at two close-up crops from a Dota Auto Chess end screen.
One of them shows synergy badges — each badge has a colored icon and a count number in parentheses like (4) or (2).

Known synergy names (use ONLY these, exact spelling):
{synergy_list}

Instructions:
- Find the image that contains synergy badges with count numbers.
- For each badge, identify the synergy name from its icon and read the count.
- Each badge is a DIFFERENT synergy — do not assign the same synergy name to two different badges.
  If two icons look similar, pick the most likely different names from the known list.
- There are typically 4-6 badges total. Report all of them.
- Return ONLY a JSON array, no other text: [{{"name": "Warlock", "count": 4}}, ...]
- If you cannot read synergies clearly, return: []"""

    raw = _ollama(model, base_url, prompt, crops)
    if not raw:
        return ""

    try:
        items = json.loads(_strip_fences(raw))
        if not isinstance(items, list):
            return ""
        # Merge any duplicate synergy names (sum their counts)
        merged: dict[str, int] = {}
        for item in items:
            if isinstance(item, dict) and item.get("name") and item.get("count"):
                name = str(item["name"])
                try:
                    count = int(item["count"])
                except (ValueError, TypeError):
                    count = 0
                merged[name] = merged.get(name, 0) + count
        pairs = [f"{name}:{count}" for name, count in sorted(merged.items(), key=lambda x: -x[1])]
        return "|".join(pairs)
    except (json.JSONDecodeError, KeyError):
        print(f"[tracker] WARNING: synergy parse failed. Raw: {raw[:200]}")
        return ""


# ── step 2: main fields ───────────────────────────────────────────────────────

def _parse_main_fields(
    image_path: Path,
    player_name: str,
    synergies_str: str,
    model: str,
    base_url: str,
) -> dict | None:
    """
    Main parse call on the full screenshot.
    Synergies are pre-determined — this call only extracts the other fields.
    Returns a dict with keys: placement, comp, talents, relic, level, wl, notes.
    """
    prompt = _load_prompt("parse_endgame_main.txt")
    prompt = prompt.replace("$PLAYER_NAME", player_name)
    prompt = prompt.replace("$SYNERGIES_RESULT", synergies_str or "(not detected)")

    b64 = _image_to_base64(image_path)
    raw = _ollama(model, base_url, prompt, [b64])
    if not raw:
        return None

    try:
        return json.loads(_strip_fences(raw))
    except json.JSONDecodeError as e:
        print(f"[tracker] ERROR: Could not parse main fields response: {e}")
        print(f"[tracker] Raw: {raw[:400]}")
        return None


# ── CV path ──────────────────────────────────────────────────────────────────

def parse_screenshot_cv(
    image_path: Path,
    player_name: str,
    date_str: str,
    icons_dir: Path,
) -> GameRow | None:
    """Parse a screenshot using deterministic CV (no Ollama).

    Returns GameRow or None if CV can't handle this screen type.
    """
    try:
        from cv_parser import parse_screenshot_cv as _cv_parse
    except ImportError as e:
        print(f"[tracker] CV parser not available: {e}")
        return None

    data = _cv_parse(image_path, player_name, icons_dir)
    if data is None:
        return None

    synergies_str = data.get("synergies", "")
    comp = _comp_from_synergies(synergies_str)

    raw_level = data.get("level")
    try:
        level_int = int(str(raw_level).strip())
        level = str(level_int) if 1 <= level_int <= 15 else ""
    except (ValueError, TypeError):
        level = ""

    return GameRow(
        played_at=date_str,
        placement=data.get("placement", ""),
        lineup=data.get("lineup", "") or comp,
        synergies=synergies_str,
        talents="",
        relic=data.get("relic", ""),
        level=level,
        wl=data.get("wl", ""),
        notes="",
    )


# ── public API (Ollama) ─────────────────────────────────────────────────────

def parse_screenshot(
    image_path: Path,
    player_name: str,
    date_str: str,
    model: str = "qwen2.5vl:7b",
    ollama_url: str = "http://localhost:11434",
) -> GameRow | None:
    """
    Two-call parse of an end-of-game screenshot.
    Call 1: synergy icon crops → synergy names + counts.
    Call 2: full screenshot + pre-filled synergies → all other fields.
    Returns GameRow or None on failure.
    """
    print("[tracker]   Step 1/2: detecting synergies from icon crops...")
    synergies_str = _detect_synergies(image_path, model, ollama_url)
    print(f"[tracker]   Synergies: {synergies_str or '(none detected)'}")

    print("[tracker]   Step 2/2: parsing main fields from full screenshot...")
    data = _parse_main_fields(image_path, player_name, synergies_str, model, ollama_url)
    if data is None:
        return None

    placement = str(data.get("placement") or "")
    if not placement or placement == "null":
        print("[tracker] WARNING: placement not found. Check screenshot.")
        placement = ""

    # Build comp from synergies directly (don't trust model formatting)
    comp = _comp_from_synergies(synergies_str)

    # Cap level at 1-15: in-game board level is at most ~11 in normal games.
    # Chess rank "Lv XX" badges are always 20+, so this safely rejects them.
    raw_level = data.get("level")
    try:
        level_int = int(str(raw_level).strip())
        level = str(level_int) if 1 <= level_int <= 15 else ""
    except (ValueError, TypeError):
        level = ""

    return GameRow(
        played_at=date_str,
        placement=placement,
        lineup=comp,
        synergies=synergies_str,
        talents=data.get("talents") or "",
        relic=data.get("relic") or "",
        level=level,
        wl=data.get("wl") or "",
        notes=data.get("notes") or "",
    )


def parse_history_screenshot(
    image_path: Path,
    player_name: str,
    screenshot_date: str,
    model: str = "qwen2.5vl:7b",
    ollama_url: str = "http://localhost:11434",
) -> list[GameRow]:
    """
    Parse a MY MATCHES history screen screenshot.
    Returns a list of GameRow (one per visible row), oldest-first order reversed to newest-first.
    """
    prompt = _load_prompt("parse_history.txt")
    prompt = prompt.replace("$PLAYER_NAME", player_name)

    b64 = _image_to_base64(image_path)
    raw = _ollama(model, ollama_url, prompt, [b64])
    if not raw:
        return []

    try:
        rows_data = json.loads(_strip_fences(raw))
        if not isinstance(rows_data, list):
            print(f"[tracker] ERROR: expected list, got: {type(rows_data)}")
            return []
    except json.JSONDecodeError as e:
        print(f"[tracker] ERROR: Could not parse history response: {e}")
        print(f"[tracker] Raw: {raw[:400]}")
        return []

    rows = []
    for i, d in enumerate(rows_data):
        synergies_str = str(d.get("synergies") or "")
        comp = _comp_from_synergies(synergies_str)

        raw_level = d.get("level")
        try:
            level_int = int(str(raw_level).strip())
            level = str(level_int) if 1 <= level_int <= 15 else ""
        except (ValueError, TypeError):
            level = ""

        date_label = str(d.get("date") or "")
        # Use screenshot date + row index as a unique date if relative time shown
        date_str = f"{screenshot_date} (row {i+1}: {date_label})" if date_label else screenshot_date

        notes_parts = ["imported from history"]
        if d.get("gold"):
            notes_parts.append(f"gold:{d.get('gold')}")
        if d.get("rank"):
            notes_parts.append(f"rank:{d.get('rank')}")

        rows.append(GameRow(
            played_at=date_str,
            placement=str(d.get("placement") or ""),
            lineup=comp,
            synergies=synergies_str,
            talents="",
            relic="",
            level=level,
            wl=str(d.get("wl") or ""),
            notes="|".join(notes_parts),
        ))

    print(f"[tracker] Parsed {len(rows)} rows from history screenshot.")
    return rows


def _comp_from_synergies(synergies_str: str) -> str:
    """Build a human-readable comp name from the synergies string.

    e.g. "Warlock:4|Demon Hunter:2|Archer:2|Demon:1" → "4 Warlocks, 2 Demon Hunters, 2 Archers"
    (drops single-count synergies from the label)
    """
    if not synergies_str:
        return ""
    parts = []
    for pair in synergies_str.split("|"):
        name, _, count_str = pair.partition(":")
        try:
            count = int(count_str)
        except ValueError:
            continue
        if count >= 2:
            label = f"{name}s" if not name.endswith("s") else name
            parts.append(f"{count} {label}")
    return ", ".join(parts) if parts else synergies_str.split("|")[0].replace(":", ":")
