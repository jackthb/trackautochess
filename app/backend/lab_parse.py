"""Parser Lab — flat region enumeration + single-region re-parsing.

The Lab tab uses two RPC commands:
  - `lab_parse_full`:  enumerate every region the parser looks at, with bbox in
                       image-fraction coords and the parsed label per region.
  - `lab_parse_region`: re-run a single MY MATCHES region's detector with a
                       bbox override. GAME OVER regions are echoed from the
                       production parser trace so the Lab cannot drift from
                       import behavior.

Both produce a uniform `RegionEntry` shape so the renderer can draw overlays
and inspect any region without knowing about the parser internals.
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from utils import (
    DATA_DIR,
    ICONS_DIR,
    crop as _crop,
    load_regions_config,
    ocr as _ocr,
    setup_tesseract,
    unit_stem as _unit_stem,
)


# ── Region kinds ─────────────────────────────────────────────────────────────
KIND_OCR = "ocr"
KIND_TEMPLATE = "template"
KIND_GRID = "grid"
KIND_BAND = "band"  # single x-strip used as a scan band, not a parsed value


def _b64(img: np.ndarray, ext: str = ".jpg") -> str:
    if img is None or getattr(img, "size", 0) == 0:
        return ""
    params = [cv2.IMWRITE_JPEG_QUALITY, 88] if ext == ".jpg" else []
    ok, buf = cv2.imencode(ext, img, params)
    return f"data:image/jpeg;base64,{base64.b64encode(buf).decode()}" if ok else ""


def _bbox_to_pixels(bbox: tuple[float, float, float, float], h: int, w: int) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = bbox
    return (
        max(0, int(round(x0 * w))),
        max(0, int(round(y0 * h))),
        min(w, int(round(x1 * w))),
        min(h, int(round(y1 * h))),
    )


def _crop_bbox(img: np.ndarray, bbox: tuple[float, float, float, float]) -> np.ndarray:
    h, w = img.shape[:2]
    x0, y0, x1, y1 = _bbox_to_pixels(bbox, h, w)
    if x1 <= x0 or y1 <= y0:
        return np.zeros((1, 1, 3), dtype=np.uint8)
    return img[y0:y1, x0:x1]


# ── Single-region parsers (used by lab_parse_region) ─────────────────────────

def _parse_title(img: np.ndarray, bbox: tuple) -> str:
    crop = _crop_bbox(img, bbox)
    return _ocr(crop, psm=6).strip()


def _parse_mm_placement(img: np.ndarray, bbox: tuple) -> str:
    cell = _crop_bbox(img, bbox)
    if cell.size == 0:
        return ""
    hsv = cv2.cvtColor(cell, cv2.COLOR_BGR2HSV)
    yellow_mask = cv2.inRange(hsv, (15, 80, 150), (40, 255, 255))
    yellow_mask = cv2.dilate(yellow_mask, np.ones((2, 2), np.uint8), iterations=1)
    proc = cv2.bitwise_not(yellow_mask)
    proc = cv2.resize(proc, (proc.shape[1] * 4, proc.shape[0] * 4), interpolation=cv2.INTER_NEAREST)
    proc = cv2.copyMakeBorder(proc, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
    for psm in (13, 8, 6, 7):
        raw = _ocr(proc, psm=psm, whitelist="12345678").strip()
        digits = [c for c in raw if c in "12345678"]
        if digits:
            return digits[0]
    return ""


def _parse_mm_level(img: np.ndarray, bbox: tuple) -> str:
    from cv_parser import _preprocess_for_ocr
    cell = _crop_bbox(img, bbox)
    if cell.size == 0:
        return ""
    proc = _preprocess_for_ocr(cell, scale=3.0)
    raw = _ocr(proc, psm=7, whitelist="0123456789Lv")
    digits = re.findall(r"\d+", raw)
    if digits:
        lv = int(digits[0])
        if 1 <= lv <= 15:
            return str(lv)
    return ""


def _parse_wl(img: np.ndarray, bbox: tuple) -> str:
    from cv_parser import _preprocess_for_ocr
    cell = _crop_bbox(img, bbox)
    if cell.size == 0:
        return ""
    proc = _preprocess_for_ocr(cell, scale=3.0)
    raw = _ocr(proc, psm=7, whitelist="0123456789-")
    m = re.search(r"(\d{1,3})\s*[-–]\s*(\d{1,3})", raw)
    return f"{m.group(1)}-{m.group(2)}" if m else ""


def _parse_rank(img: np.ndarray, bbox: tuple) -> str:
    from cv_parser import _preprocess_for_ocr
    cell = _crop_bbox(img, bbox)
    if cell.size == 0:
        return ""
    proc = _preprocess_for_ocr(cell, scale=3.0)
    raw = _ocr(proc, psm=6)
    rank_re = re.compile(
        r"(Pawn|Knight|Bishop|Rook|King|Queen)[\s\-_]*(\d)",
        re.IGNORECASE,
    )
    m = rank_re.search(raw)
    if m:
        return f"{m.group(1).title()}-{m.group(2)}"
    if "unrank" in raw.lower():
        return "Unranked"
    return ""


def _parse_time_ago(img: np.ndarray, bbox: tuple) -> str:
    from cv_parser import _preprocess_for_ocr, _normalise_time_ago
    cell = _crop_bbox(img, bbox)
    if cell.size == 0:
        return ""
    proc = _preprocess_for_ocr(cell, scale=2.5, invert=True)
    raw = _ocr(proc, psm=6)
    return _normalise_time_ago(raw) or raw.strip()


_UNIT_TEMPLATES_CACHE: dict[str, list[np.ndarray]] | None = None
_RELIC_TEMPLATES_CACHE: dict[str, list[np.ndarray]] | None = None
_SYN_TEMPLATES_CACHE: dict[str, list[np.ndarray]] | None = None
_STEM_TO_NAME_CACHE: dict[str, str] | None = None
_UNITS_DATA_CACHE: dict | None = None


def _ensure_templates():
    global _UNIT_TEMPLATES_CACHE, _RELIC_TEMPLATES_CACHE, _SYN_TEMPLATES_CACHE
    global _STEM_TO_NAME_CACHE, _UNITS_DATA_CACHE
    from cv_parser import (
        _load_templates_multiscale,
        UNIT_ICON_SCALES, RELIC_ICON_SCALES,
        MM_SYNERGY_ICON_SCALES,
    )
    if _UNIT_TEMPLATES_CACHE is None:
        _UNIT_TEMPLATES_CACHE = _load_templates_multiscale(
            ICONS_DIR / "units", UNIT_ICON_SCALES, inner_frac=0.85, color=True)
    if _RELIC_TEMPLATES_CACHE is None:
        _RELIC_TEMPLATES_CACHE = _load_templates_multiscale(
            ICONS_DIR / "relics", RELIC_ICON_SCALES, inner_frac=1.0, color=True)
    if _SYN_TEMPLATES_CACHE is None:
        _SYN_TEMPLATES_CACHE = _load_templates_multiscale(
            ICONS_DIR / "synergies", MM_SYNERGY_ICON_SCALES)
    if _STEM_TO_NAME_CACHE is None:
        units_path = DATA_DIR / "units.json"
        if units_path.exists():
            _UNITS_DATA_CACHE = json.loads(units_path.read_text(encoding="utf-8"))["units"]
            _STEM_TO_NAME_CACHE = {_unit_stem(name): name for name in _UNITS_DATA_CACHE}
        else:
            _UNITS_DATA_CACHE = {}
            _STEM_TO_NAME_CACHE = {}


def _parse_unit_grid_region(img: np.ndarray, bbox: tuple) -> str:
    from cv_parser import _match_unit_grid, UNIT_MATCH_THRESHOLD
    _ensure_templates()
    region = _crop_bbox(img, bbox)
    if region.size == 0:
        return ""
    matches = _match_unit_grid(
        region, _UNIT_TEMPLATES_CACHE,
        threshold=UNIT_MATCH_THRESHOLD, debug=False,
    )
    names = [_STEM_TO_NAME_CACHE.get(stem, stem) for stem, _, _, _ in matches]
    return ", ".join(names)


def _parse_relic_grid_region(img: np.ndarray, bbox: tuple) -> str:
    from cv_parser import _match_relic_grid
    _ensure_templates()
    region = _crop_bbox(img, bbox)
    if region.size == 0:
        return ""
    matches = _match_relic_grid(
        region, _RELIC_TEMPLATES_CACHE,
        threshold=0.55, debug=False,
    )
    return ", ".join(name.replace("_", " ").title() for name, _, _, _ in matches)


def _parse_mm_synergy_region(img: np.ndarray, bbox: tuple) -> str:
    """Match MY MATCHES synergy icons inside the given bbox.

    Uses a high threshold + per-name best-score dedupe so the live re-parse
    label matches what the user would see in the overlay (not a long list of
    every template that scored above noise).
    """
    from cv_parser import _match_templates_multiscale
    _ensure_templates()
    region = _crop_bbox(img, bbox)
    if region.size == 0:
        return ""
    matches = _match_templates_multiscale(
        region, _SYN_TEMPLATES_CACHE,
        threshold=0.72, debug=False,
    )
    best: dict[str, float] = {}
    for name, score, _, _ in matches:
        if score > best.get(name, 0):
            best[name] = score
    names = [name for name, _ in sorted(best.items(), key=lambda kv: -kv[1])]
    return ", ".join(names)


def _parse_sentinel_match(img: np.ndarray, bbox: tuple, template_name: str) -> str:
    """Run a template-match for a sentinel anchor; returns score."""
    region = _crop_bbox(img, bbox)
    if region.size == 0:
        return ""
    template = cv2.imread(str(DATA_DIR / template_name), cv2.IMREAD_GRAYSCALE)
    if template is None:
        return f"template_missing:{template_name}"
    region_gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region
    th, tw = template.shape[:2]
    rh, rw = region_gray.shape[:2]
    if tw > rw or th > rh:
        return "region_smaller_than_template"
    match = cv2.matchTemplate(region_gray, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, _ = cv2.minMaxLoc(match)
    return f"score={max_val:.3f}"


# Game Over categories (`go_*`) are intentionally absent — `parse_region`
# short-circuits on those and echoes the production parser trace instead.
CATEGORY_HANDLERS: dict[str, Any] = {
    "title": _parse_title,
    "mm_tab": _parse_title,
    "mm_placement": _parse_mm_placement,
    "mm_level": _parse_mm_level,
    "mm_wl": _parse_wl,
    "mm_rank": _parse_rank,
    "mm_time": _parse_time_ago,
    "mm_units": _parse_unit_grid_region,
    "mm_synergies": _parse_mm_synergy_region,
    "mm_relics": _parse_relic_grid_region,
    "sentinel_final_ranking": lambda img, bbox: _parse_sentinel_match(img, bbox, "sentinel_ref_final_ranking.png"),
    "sentinel_round_start": lambda img, bbox: _parse_sentinel_match(img, bbox, "sentinel_ref_round_start.png"),
    "ocr": _parse_title,  # generic OCR fallback
}


# ── Region enumeration (used by lab_parse_full) ──────────────────────────────

def _entry(name: str, kind: str, category: str, bbox: tuple, label: str = "",
           row_index: int | None = None) -> dict:
    return {
        "name": name,
        "kind": kind,
        "category": category,
        "bbox": [round(float(v), 5) for v in bbox],
        "label": label,
        "row_index": row_index,
    }


def _enumerate_my_matches(img: np.ndarray) -> list[dict]:
    from cv_parser import (
        MM_TAB_REGION, MM_COL_PLACEMENT, MM_COL_LEVEL, MM_COL_UNITS,
        MM_COL_SYNERGY, MM_COL_RELIC, MM_COL_WL, MM_COL_RANK, MM_COL_TIME,
        MM_PLACEMENT_Y_IN_ROW, MM_LEVEL_Y_IN_ROW, MM_WL_Y_IN_ROW,
        MM_RANK_Y_IN_ROW, MM_TIME_Y_IN_ROW,
        _find_my_matches_rows, _parse_my_matches_row,
    )
    _ensure_templates()
    entries: list[dict] = [
        _entry("mm.tab", KIND_OCR, "mm_tab", MM_TAB_REGION),
    ]

    rows = _find_my_matches_rows(img)
    for i, (y0, y1) in enumerate(rows):
        row_data = _parse_my_matches_row(
            img, y0, y1,
            _UNIT_TEMPLATES_CACHE, _RELIC_TEMPLATES_CACHE, _SYN_TEMPLATES_CACHE,
            ICONS_DIR, _UNITS_DATA_CACHE, _STEM_TO_NAME_CACHE,
            debug=False, row_idx=i,
        )
        rh = y1 - y0
        # Per-row regions
        place_bbox = (MM_COL_PLACEMENT[0], y0 + rh * MM_PLACEMENT_Y_IN_ROW[0],
                      MM_COL_PLACEMENT[1], y0 + rh * MM_PLACEMENT_Y_IN_ROW[1])
        level_bbox = (MM_COL_LEVEL[0], y0 + rh * MM_LEVEL_Y_IN_ROW[0],
                      MM_COL_LEVEL[1], y0 + rh * MM_LEVEL_Y_IN_ROW[1])
        units_bbox = (MM_COL_UNITS[0], y0, MM_COL_UNITS[1], y1)
        syn_bbox = (MM_COL_SYNERGY[0], y0, MM_COL_SYNERGY[1], y1)
        relic_bbox = (MM_COL_RELIC[0], y0, MM_COL_RELIC[1], y1)
        wl_bbox = (MM_COL_WL[0], y0 + rh * MM_WL_Y_IN_ROW[0],
                   MM_COL_WL[1], y0 + rh * MM_WL_Y_IN_ROW[1])
        rank_bbox = (MM_COL_RANK[0], y0 + rh * MM_RANK_Y_IN_ROW[0],
                     MM_COL_RANK[1], y0 + rh * MM_RANK_Y_IN_ROW[1])
        time_bbox = (MM_COL_TIME[0], y0 + rh * MM_TIME_Y_IN_ROW[0],
                     MM_COL_TIME[1], y0 + rh * MM_TIME_Y_IN_ROW[1])

        entries.extend([
            _entry(f"row{i}.placement", KIND_OCR, "mm_placement", place_bbox,
                   row_data.get("placement", ""), i),
            _entry(f"row{i}.level", KIND_OCR, "mm_level", level_bbox,
                   row_data.get("level", ""), i),
            _entry(f"row{i}.units", KIND_GRID, "mm_units", units_bbox,
                   ", ".join(row_data.get("units", [])), i),
            _entry(f"row{i}.synergies", KIND_TEMPLATE, "mm_synergies", syn_bbox,
                   row_data.get("synergies", ""), i),
            _entry(f"row{i}.relic", KIND_GRID, "mm_relics", relic_bbox,
                   row_data.get("relic", ""), i),
            _entry(f"row{i}.wl", KIND_OCR, "mm_wl", wl_bbox,
                   row_data.get("wl", ""), i),
            _entry(f"row{i}.rank", KIND_OCR, "mm_rank", rank_bbox,
                   row_data.get("rank", ""), i),
            _entry(f"row{i}.time", KIND_OCR, "mm_time", time_bbox,
                   row_data.get("time_ago", ""), i),
        ])
    return entries


def _enumerate_game_over(img: np.ndarray) -> list[dict]:
    from cv_parser import parse_game_over_screenshot

    draft = parse_game_over_screenshot(img, icons_dir=ICONS_DIR, debug=False)
    return draft.get("trace", [])


def _production_game_over_region(img: np.ndarray, name: str, category: str) -> dict | None:
    from cv_parser import parse_game_over_screenshot

    draft = parse_game_over_screenshot(img, icons_dir=ICONS_DIR, debug=False)
    for entry in draft.get("trace", []):
        if entry.get("name") == name and entry.get("category") == category:
            return entry
    return None


def _enumerate_sentinel(img: np.ndarray, key: str) -> list[dict]:
    config = load_regions_config()
    block = config.get(key) or {}
    region = block.get("search_region") or []
    if len(region) != 4:
        return []
    template_name = (
        "sentinel_ref_final_ranking.png"
        if key == "sentinel_final_ranking"
        else "sentinel_ref_round_start.png"
    )
    label = _parse_sentinel_match(img, tuple(region), template_name)
    return [_entry(key, KIND_TEMPLATE, key, tuple(region), label)]


def parse_full(img_path: str) -> dict:
    """Run a full parse on the image and return regions list + screen type."""
    setup_tesseract()
    from cv_parser import apply_calibration, detect_screen_type

    img = cv2.imread(img_path)
    if img is None:
        return {"ok": False, "error": f"Cannot read image: {img_path}"}

    apply_calibration(img)
    screen_type = detect_screen_type(img, apply_regions=False)

    if screen_type == "my_matches":
        regions = _enumerate_my_matches(img)
    elif screen_type in ("game_over", "final_ranking"):
        regions = _enumerate_game_over(img)
    else:
        regions = []

    h, w = img.shape[:2]
    return {
        "ok": True,
        "screen_type": screen_type,
        "width": w,
        "height": h,
        "regions": regions,
    }


def parse_region(img_path: str, name: str, category: str,
                 bbox: tuple[float, float, float, float]) -> dict:
    """Re-parse a single region with an overridden bbox."""
    setup_tesseract()
    from cv_parser import apply_calibration

    img = cv2.imread(img_path)
    if img is None:
        return {"ok": False, "error": f"Cannot read image: {img_path}"}

    apply_calibration(img)

    if category.startswith("go_"):
        entry = _production_game_over_region(img, name, category)
        if entry is None:
            return {"ok": False, "error": f"Unknown Game Over region: {name}"}
        # Game Over Lab reparsing is intentionally production-parser only.
        # The bbox is echoed from the production trace so the Lab cannot imply
        # a one-off region edit changed real parser behavior.
        return {
            "ok": True,
            "name": name,
            "category": category,
            "bbox": entry.get("bbox", []),
            "label": entry.get("label", ""),
            "crop_b64": entry.get("crop_b64", ""),
        }

    handler = CATEGORY_HANDLERS.get(category)
    if handler is None:
        return {"ok": False, "error": f"Unknown category: {category}"}

    try:
        label = handler(img, bbox)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    crop = _crop_bbox(img, bbox)
    return {
        "ok": True,
        "name": name,
        "category": category,
        "bbox": [round(float(v), 5) for v in bbox],
        "label": label or "",
        "crop_b64": _b64(crop),
    }
