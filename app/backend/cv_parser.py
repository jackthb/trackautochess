"""Deterministic CV parsing for DAC end-of-game screenshots.

Replaces Ollama vision calls for structured GAME OVER table screenshots.
Uses OpenCV template matching for synergy/relic icons and pytesseract for
numeric fields (placement, level, W-L).

Usage (dev test):
    python cv_parser.py /path/to/screenshot.jpg [player_name] [--debug]
"""

import base64
import difflib
import logging
import re
import sys
from pathlib import Path

import cv2
import numpy as np

from utils import (
    DAC_DIR,
    crop as _crop,
    load_regions_config,
    ocr as _ocr,
    setup_tesseract,
    unit_stem as _unit_stem,
)

setup_tesseract()
try:
    import pytesseract
except ImportError:
    pytesseract = None

log = logging.getLogger("dac")


# ── Region constants ─────────────────────────────────────────────────────────
# All values as fractions of image (width, height).
# Calibrated for 16:9 (2560×1440 reference).
# Values here are defaults — runtime config in data/regions_config.json
# (and ~/.dac/regions_config.json overrides) replaces them via apply_calibration().

# Title detection crops (x0, y0, x1, y1)
TITLE_REGION = (0.30, 0.00, 0.70, 0.12)
FINAL_RANK_REGION = (0.0, 0.24, 0.14, 0.32)
ELIMINATED_REGION = (0.0, 0.17, 0.14, 0.25)

# GAME OVER column x-extents (x_start, x_end) as fraction of image width
COL_RANK    = (0.000, 0.025)
COL_PLAYER  = (0.025, 0.155)
COL_LEVEL   = (0.130, 0.165)
COL_SYNERGY = (0.390, 0.500)
COL_RELIC   = (0.485, 0.555)
COL_WL      = (0.573, 0.612)

# Placeholder x-extents for the remaining visible Game Over columns.
# Overwritten at runtime by data/regions_config.json after manual calibration
# in the Parser Lab against 20260205145859_1.jpg.
COL_PLACEMENT = (0.000, 0.025)
COL_AVATAR    = (0.025, 0.078)
COL_TALENT    = (0.225, 0.275)
COL_UNITS     = (0.225, 0.515)
COL_GOLD      = (0.730, 0.765)
COL_DAMAGE    = (0.830, 0.890)
COL_DURATION  = (0.890, 0.940)

# GAME OVER row-relative OCR y-offsets within COL_PLAYER cell
GO_PLAYER_NAME_Y = (0.05, 0.55)
GO_RANK_Y_IN_PLAYER = (0.55, 0.98)

# GAME OVER table row geometry
TABLE_Y_START = 0.155
TABLE_Y_END   = 0.97
N_ROWS = 8
ROW_DIVIDERS: list[float] | None = None

# Template matching
MATCH_THRESHOLD = 0.70
SYNERGY_ICON_SCALES = [32, 36, 40, 44]
RELIC_ICON_SCALES = [12, 14, 16, 20, 24, 28, 32, 40, 50, 60]
GO_RELIC_ICON_SCALES = [20, 24, 28, 32, 36, 40, 44, 50, 60]
ICON_INNER_FRAC = 0.75
SYNERGY_BADGE_Y_MAX_FRAC = 0.50

# GAME OVER synergy slot geometry
GO_SYN_SLOT_X_RANGES = [
    (0.00, 0.22), (0.15, 0.37), (0.30, 0.52),
    (0.45, 0.67), (0.60, 0.82), (0.75, 0.97),
]
GO_SYN_SLOT_Y_RANGE = (0.03, 0.58)
GO_SYN_MATCH_THRESHOLD = 0.65
GO_SYN_FALLBACK_THRESHOLD = 0.48
GO_SYN_FALLBACK_INNER_FRAC = 0.45
GO_SYN_GLOBAL_Y_MAX_FRAC = 0.46

# GAME OVER relic slot geometry: (name, rect, inner_frac, min_size_px)
GO_RELIC_SLOTS = [
    ("top_left",    (0.00, 0.30, 0.22, 0.62), 0.75, 0),
    ("bottom_left", (0.00, 0.30, 0.43, 0.86), 0.70, 0),
    ("middle",      (0.16, 0.42, 0.35, 0.75), 0.55, 0),
    ("large",       (0.35, 0.82, 0.18, 0.88), 0.80, 32),
]
GO_RELIC_INNER_FRAC = 0.60

DEBUG_DIR = DAC_DIR / "debug"


# ── MY MATCHES screen constants ───────────────────────────────────────────────

MM_TAB_REGION     = (0.30, 0.12, 0.55, 0.20)
MM_TABLE_Y_START  = 0.33
MM_TABLE_Y_END    = 0.90
MM_SEP_SCAN_X     = (0.60, 0.70)
MM_ROW_DIVIDERS: list[float] | None = None
MM_SEP_DARK_THRESH = 35

# MY MATCHES per-row column extents
MM_COL_PLACEMENT = (0.390, 0.436)
MM_COL_LEVEL     = (0.452, 0.481)
MM_COL_UNITS     = (0.4814, 0.5945)
MM_COL_SYNERGY   = (0.597, 0.692)
MM_COL_RELIC     = (0.7035, 0.7491)
MM_COL_WL        = (0.752, 0.792)
MM_COL_RANK      = (0.792, 0.863)
MM_COL_TIME      = (0.390, 0.436)

# MY MATCHES row-relative OCR y-offsets within their column cells
MM_PLACEMENT_Y_IN_ROW = (0.15, 0.75)
MM_LEVEL_Y_IN_ROW     = (0.30, 0.75)
MM_WL_Y_IN_ROW        = (0.55, 0.95)
MM_RANK_Y_IN_ROW      = (0.20, 0.80)
MM_TIME_Y_IN_ROW      = (0.65, 1.0)

UNIT_ICON_SCALES    = [24, 28, 32, 36, 40, 44]
UNIT_MATCH_THRESHOLD = 0.65
MM_SYNERGY_ICON_SCALES = [20, 24, 28, 32]

# MY MATCHES synergy grid
MM_SYN_COLS_X = [0.61308, 0.62645, 0.64070, 0.65407, 0.66773]
MM_SYN_ICON_W = 0.0125
MM_SYN_ICON_H = 0.028
MM_SYN_Y_1ROW = 0.21
MM_SYN_Y_2ROW_TOP = 0.0
MM_SYN_Y_2ROW_BOT = 0.59
MM_SYN_BRIGHT_THRESH = 40
# Y range (fraction of row height) where the (count) numerals sit
MM_SYN_COUNT_Y_1ROW = (0.58, 0.86)
MM_SYN_COUNT_Y_2ROW_BOT = (0.37, 0.63)

# MY MATCHES unit grid
MM_UNIT_GRID_START_FRAC = 0.0
MM_UNIT_GRID_SPACING_FRAC = 0.1102
MM_UNIT_SPLIT_Y = 0.514
MM_UNIT_ONE_ROW_Y = (0.215, 0.813)
MM_UNIT_MAX_SLOTS = 9

# MY MATCHES relic grid
MM_RELIC_COLS = 3
MM_RELIC_ROWS = 2
MM_RELIC_SPLIT_Y = 0.49
MM_RELIC_COL_RANGES = [
    (0.000, 0.300),
    (0.351, 0.649),
    (0.702, 1.000),
]


DEFAULT_REGIONS = {
    "TITLE_REGION": TITLE_REGION,
    "FINAL_RANK_REGION": FINAL_RANK_REGION,
    "ELIMINATED_REGION": ELIMINATED_REGION,
    "COL_RANK": COL_RANK,
    "COL_PLAYER": COL_PLAYER,
    "COL_LEVEL": COL_LEVEL,
    "COL_SYNERGY": COL_SYNERGY,
    "COL_RELIC": COL_RELIC,
    "COL_WL": COL_WL,
    "COL_PLACEMENT": COL_PLACEMENT,
    "COL_AVATAR": COL_AVATAR,
    "COL_TALENT": COL_TALENT,
    "COL_UNITS": COL_UNITS,
    "COL_GOLD": COL_GOLD,
    "COL_DAMAGE": COL_DAMAGE,
    "COL_DURATION": COL_DURATION,
    "GO_UNIT_SLOT_XS": [],
    "GO_UNIT_SLOT_YS": [],
    "GO_UNIT_SLOT_PAD_PX": 10,
    "GO_PLAYER_NAME_Y": GO_PLAYER_NAME_Y,
    "GO_RANK_Y_IN_PLAYER": GO_RANK_Y_IN_PLAYER,
    "TABLE_Y_START": TABLE_Y_START,
    "TABLE_Y_END": TABLE_Y_END,
    "ROW_DIVIDERS": None,
    "GO_SYN_SLOT_X_RANGES": GO_SYN_SLOT_X_RANGES,
    "GO_SYN_SLOT_Y_RANGE": GO_SYN_SLOT_Y_RANGE,
    "GO_SYN_MATCH_THRESHOLD": GO_SYN_MATCH_THRESHOLD,
    "GO_SYN_FALLBACK_THRESHOLD": GO_SYN_FALLBACK_THRESHOLD,
    "GO_SYN_FALLBACK_INNER_FRAC": GO_SYN_FALLBACK_INNER_FRAC,
    "GO_SYN_GLOBAL_Y_MAX_FRAC": GO_SYN_GLOBAL_Y_MAX_FRAC,
    "GO_RELIC_SLOTS": GO_RELIC_SLOTS,
    "GO_RELIC_INNER_FRAC": GO_RELIC_INNER_FRAC,
    "MM_TAB_REGION": MM_TAB_REGION,
    "MM_TABLE_Y_START": MM_TABLE_Y_START,
    "MM_TABLE_Y_END": MM_TABLE_Y_END,
    "MM_SEP_SCAN_X": MM_SEP_SCAN_X,
    "MM_SEP_DARK_THRESH": MM_SEP_DARK_THRESH,
    "MM_ROW_DIVIDERS": None,
    "MM_COL_PLACEMENT": MM_COL_PLACEMENT,
    "MM_COL_LEVEL": MM_COL_LEVEL,
    "MM_COL_UNITS": MM_COL_UNITS,
    "MM_COL_SYNERGY": MM_COL_SYNERGY,
    "MM_COL_RELIC": MM_COL_RELIC,
    "MM_COL_WL": MM_COL_WL,
    "MM_COL_RANK": MM_COL_RANK,
    "MM_COL_TIME": MM_COL_TIME,
    "MM_PLACEMENT_Y_IN_ROW": MM_PLACEMENT_Y_IN_ROW,
    "MM_LEVEL_Y_IN_ROW": MM_LEVEL_Y_IN_ROW,
    "MM_WL_Y_IN_ROW": MM_WL_Y_IN_ROW,
    "MM_RANK_Y_IN_ROW": MM_RANK_Y_IN_ROW,
    "MM_TIME_Y_IN_ROW": MM_TIME_Y_IN_ROW,
    "MM_SYN_COLS_X": MM_SYN_COLS_X,
    "MM_SYN_ICON_W": MM_SYN_ICON_W,
    "MM_SYN_ICON_H": MM_SYN_ICON_H,
    "MM_SYN_Y_1ROW": MM_SYN_Y_1ROW,
    "MM_SYN_Y_2ROW_TOP": MM_SYN_Y_2ROW_TOP,
    "MM_SYN_Y_2ROW_BOT": MM_SYN_Y_2ROW_BOT,
    "MM_SYN_BRIGHT_THRESH": MM_SYN_BRIGHT_THRESH,
    "MM_SYN_COUNT_Y_1ROW": MM_SYN_COUNT_Y_1ROW,
    "MM_SYN_COUNT_Y_2ROW_BOT": MM_SYN_COUNT_Y_2ROW_BOT,
    "MM_UNIT_GRID_START_FRAC": MM_UNIT_GRID_START_FRAC,
    "MM_UNIT_GRID_SPACING_FRAC": MM_UNIT_GRID_SPACING_FRAC,
    "MM_UNIT_SPLIT_Y": MM_UNIT_SPLIT_Y,
    "MM_UNIT_ONE_ROW_Y": MM_UNIT_ONE_ROW_Y,
    "MM_UNIT_MAX_SLOTS": MM_UNIT_MAX_SLOTS,
    "MM_RELIC_COL_RANGES": MM_RELIC_COL_RANGES,
    "MM_RELIC_SPLIT_Y": MM_RELIC_SPLIT_Y,
}


def reset_calibration() -> None:
    """Restore built-in parser regions."""
    globals().update(DEFAULT_REGIONS)


def _as_tuple_or_none(value, length: int):
    if isinstance(value, list) and len(value) == length \
            and all(isinstance(v, (int, float)) for v in value):
        return tuple(float(v) for v in value)
    return None


def _as_list_of_pairs(value):
    if isinstance(value, list) and value \
            and all(isinstance(v, list) and len(v) == 2
                    and all(isinstance(c, (int, float)) for c in v)
                    for v in value):
        return [(float(v[0]), float(v[1])) for v in value]
    return None


def apply_calibration(
    img: np.ndarray | None = None,
    *,
    regions_config: dict | None = None,
    **_legacy_kwargs,  # absorb dropped aspect_ratio kwarg
) -> str:
    """Load flat regions config and patch parser globals.

    Schema is single-profile (16:9 only). Returns "16:9" for compat with callers
    that still expect an aspect-ratio string back.
    """
    reset_calibration()

    if regions_config is None:
        regions_config = load_regions_config()
    if not isinstance(regions_config, dict) or not regions_config:
        return "16:9"

    game_over = regions_config.get("game_over") or {}
    my_matches = regions_config.get("my_matches") or {}

    # ── GAME OVER ────────────────────────────────────────────────────────────
    for src, dest, length in [
        ("title_region", "TITLE_REGION", 4),
        ("final_rank_region", "FINAL_RANK_REGION", 4),
        ("eliminated_region", "ELIMINATED_REGION", 4),
        ("col_rank", "COL_RANK", 2),
        ("col_player", "COL_PLAYER", 2),
        ("col_level", "COL_LEVEL", 2),
        ("col_synergy", "COL_SYNERGY", 2),
        ("col_relic", "COL_RELIC", 2),
        ("col_wl", "COL_WL", 2),
        ("col_placement", "COL_PLACEMENT", 2),
        ("col_avatar", "COL_AVATAR", 2),
        ("col_talent", "COL_TALENT", 2),
        ("col_units", "COL_UNITS", 2),
        ("col_gold", "COL_GOLD", 2),
        ("col_damage", "COL_DAMAGE", 2),
        ("col_duration", "COL_DURATION", 2),
        ("syn_slot_y_range", "GO_SYN_SLOT_Y_RANGE", 2),
    ]:
        v = _as_tuple_or_none(game_over.get(src), length)
        if v is not None:
            globals()[dest] = v
    if len(game_over.get("table_area", [])) == 4:
        ta = game_over["table_area"]
        globals()["TABLE_Y_START"] = float(ta[1])
        globals()["TABLE_Y_END"] = float(ta[3])
    rd = game_over.get("row_dividers")
    if isinstance(rd, list) and len(rd) == N_ROWS + 1 \
            and all(isinstance(v, (int, float)) for v in rd):
        globals()["ROW_DIVIDERS"] = [float(v) for v in rd]

    # GAME OVER OCR offsets
    go_off = game_over.get("ocr_offsets") or {}
    for src, dest in [
        ("player_name_y_in_row", "GO_PLAYER_NAME_Y"),
        ("rank_y_in_row", "GO_RANK_Y_IN_PLAYER"),
    ]:
        v = _as_tuple_or_none(go_off.get(src), 2)
        if v is not None:
            globals()[dest] = v

    # GAME OVER synergy slot ranges
    go_slot_x = _as_list_of_pairs(game_over.get("syn_slot_x_ranges"))
    if go_slot_x:
        globals()["GO_SYN_SLOT_X_RANGES"] = go_slot_x

    for src, dest in [
        ("syn_match_threshold", "GO_SYN_MATCH_THRESHOLD"),
        ("syn_fallback_threshold", "GO_SYN_FALLBACK_THRESHOLD"),
        ("syn_fallback_inner_frac", "GO_SYN_FALLBACK_INNER_FRAC"),
        ("syn_global_y_max_frac", "GO_SYN_GLOBAL_Y_MAX_FRAC"),
        ("syn_badge_y_max_frac", "SYNERGY_BADGE_Y_MAX_FRAC"),
        ("relic_inner_frac", "GO_RELIC_INNER_FRAC"),
        ("icon_inner_frac", "ICON_INNER_FRAC"),
        ("match_threshold", "MATCH_THRESHOLD"),
    ]:
        if isinstance(game_over.get(src), (int, float)):
            globals()[dest] = float(game_over[src])

    # Per-slot unit boundaries
    slot_xs = game_over.get("unit_slot_xs")
    if isinstance(slot_xs, list) and all(isinstance(v, (int, float)) for v in slot_xs):
        globals()["GO_UNIT_SLOT_XS"] = [float(v) for v in slot_xs]
    slot_ys = game_over.get("unit_slot_ys")
    if isinstance(slot_ys, list) and all(isinstance(v, (int, float)) for v in slot_ys):
        globals()["GO_UNIT_SLOT_YS"] = [float(v) for v in slot_ys]
    if isinstance(game_over.get("unit_slot_pad_px"), (int, float)):
        globals()["GO_UNIT_SLOT_PAD_PX"] = int(game_over["unit_slot_pad_px"])

    if isinstance(game_over.get("syn_icon_scales"), list):
        globals()["SYNERGY_ICON_SCALES"] = [int(s) for s in game_over["syn_icon_scales"]]
    if isinstance(game_over.get("relic_icon_scales"), list):
        globals()["GO_RELIC_ICON_SCALES"] = [int(s) for s in game_over["relic_icon_scales"]]

    # GAME OVER relic slots
    rs = game_over.get("relic_slots")
    if isinstance(rs, list) and rs:
        slots = []
        for entry in rs:
            if not isinstance(entry, dict):
                continue
            rect = entry.get("rect")
            if not (isinstance(rect, list) and len(rect) == 4):
                continue
            slots.append((
                str(entry.get("name", "")),
                tuple(float(v) for v in rect),
                float(entry.get("inner_frac", 0.75)),
                int(entry.get("min_size", 0)),
            ))
        if slots:
            globals()["GO_RELIC_SLOTS"] = slots

    # ── MY MATCHES ───────────────────────────────────────────────────────────
    if len(my_matches.get("tab_region", [])) == 4:
        globals()["MM_TAB_REGION"] = tuple(float(v) for v in my_matches["tab_region"])
    if len(my_matches.get("table_area", [])) == 4:
        ta = my_matches["table_area"]
        globals()["MM_TABLE_Y_START"] = float(ta[1])
        globals()["MM_TABLE_Y_END"] = float(ta[3])
    v = _as_tuple_or_none(my_matches.get("sep_scan_band"), 2)
    if v is not None:
        globals()["MM_SEP_SCAN_X"] = v
    if isinstance(my_matches.get("sep_dark_thresh"), (int, float)):
        globals()["MM_SEP_DARK_THRESH"] = float(my_matches["sep_dark_thresh"])
    rd = my_matches.get("row_dividers")
    if isinstance(rd, list) and len(rd) >= 2 \
            and all(isinstance(v, (int, float)) for v in rd):
        globals()["MM_ROW_DIVIDERS"] = [float(v) for v in rd]
    for src, dest in [
        ("col_placement", "MM_COL_PLACEMENT"),
        ("col_level", "MM_COL_LEVEL"),
        ("col_units", "MM_COL_UNITS"),
        ("col_synergy", "MM_COL_SYNERGY"),
        ("col_relic", "MM_COL_RELIC"),
        ("col_wl", "MM_COL_WL"),
        ("col_rank", "MM_COL_RANK"),
        ("col_time", "MM_COL_TIME"),
    ]:
        v = _as_tuple_or_none(my_matches.get(src), 2)
        if v is not None:
            globals()[dest] = v

    # MY MATCHES OCR offsets
    mm_off = my_matches.get("ocr_offsets") or {}
    for src, dest in [
        ("placement_y_in_row", "MM_PLACEMENT_Y_IN_ROW"),
        ("level_y_in_row", "MM_LEVEL_Y_IN_ROW"),
        ("wl_y_in_row", "MM_WL_Y_IN_ROW"),
        ("rank_y_in_row", "MM_RANK_Y_IN_ROW"),
        ("time_y_in_row", "MM_TIME_Y_IN_ROW"),
    ]:
        v = _as_tuple_or_none(mm_off.get(src), 2)
        if v is not None:
            globals()[dest] = v

    # MY MATCHES synergy grid
    if len(my_matches.get("syn_cols_x", [])) >= 1 \
            and all(isinstance(v, (int, float)) for v in my_matches["syn_cols_x"]):
        globals()["MM_SYN_COLS_X"] = [float(v) for v in my_matches["syn_cols_x"]]
    for src, dest in [
        ("syn_icon_w", "MM_SYN_ICON_W"),
        ("syn_icon_h", "MM_SYN_ICON_H"),
        ("syn_y_1row", "MM_SYN_Y_1ROW"),
        ("syn_y_2row_top", "MM_SYN_Y_2ROW_TOP"),
        ("syn_y_2row_bot", "MM_SYN_Y_2ROW_BOT"),
        ("syn_bright_thresh", "MM_SYN_BRIGHT_THRESH"),
        ("unit_grid_start_frac", "MM_UNIT_GRID_START_FRAC"),
        ("unit_grid_spacing_frac", "MM_UNIT_GRID_SPACING_FRAC"),
        ("unit_split_y", "MM_UNIT_SPLIT_Y"),
        ("unit_match_threshold", "UNIT_MATCH_THRESHOLD"),
        ("relic_split_y", "MM_RELIC_SPLIT_Y"),
    ]:
        if isinstance(my_matches.get(src), (int, float)):
            globals()[dest] = float(my_matches[src])
    if isinstance(my_matches.get("unit_max_slots"), int):
        globals()["MM_UNIT_MAX_SLOTS"] = my_matches["unit_max_slots"]
    if isinstance(my_matches.get("syn_icon_scales"), list):
        globals()["MM_SYNERGY_ICON_SCALES"] = [int(s) for s in my_matches["syn_icon_scales"]]
    if isinstance(my_matches.get("unit_icon_scales"), list):
        globals()["UNIT_ICON_SCALES"] = [int(s) for s in my_matches["unit_icon_scales"]]
    v = _as_tuple_or_none(my_matches.get("unit_one_row_y"), 2)
    if v is not None:
        globals()["MM_UNIT_ONE_ROW_Y"] = v
    v = _as_tuple_or_none(my_matches.get("syn_count_y_1row"), 2)
    if v is not None:
        globals()["MM_SYN_COUNT_Y_1ROW"] = v
    v = _as_tuple_or_none(my_matches.get("syn_count_y_2row_bot"), 2)
    if v is not None:
        globals()["MM_SYN_COUNT_Y_2ROW_BOT"] = v
    relic_ranges = _as_list_of_pairs(my_matches.get("relic_col_ranges"))
    if relic_ranges:
        globals()["MM_RELIC_COL_RANGES"] = relic_ranges

    return "16:9"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _crop_row(img: np.ndarray, col: tuple[float, float], row_y0: float, row_y1: float) -> np.ndarray:
    """Crop a cell: column x-extent × row y-extent."""
    return _crop(img, col[0], row_y0, col[1], row_y1)


def _preprocess_for_ocr(img: np.ndarray, scale: float = 2.0, invert: bool = True) -> np.ndarray:
    """Upscale and threshold for OCR on game UI text (light text on dark bg)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    h, w = gray.shape[:2]
    scaled = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    if invert:
        # Light text on dark background → invert so text becomes dark on white
        _, thresh = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    else:
        _, thresh = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thresh


def _save_debug(name: str, img: np.ndarray, debug: bool) -> None:
    if debug:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(DEBUG_DIR / f"{name}.png"), img)


# ── Screen type detection ────────────────────────────────────────────────────

def detect_screen_type(
    img: np.ndarray,
    *,
    apply_regions: bool = True,
    regions_config: dict | None = None,
    **_legacy_kwargs,
) -> str:
    """Detect which end-screen type this is.

    Returns: 'game_over', 'final_ranking', 'my_matches', or 'unknown'.
    """
    if apply_regions:
        apply_calibration(img, regions_config=regions_config)

    # Check center-top title area (Game Over / My Matches headings)
    title_crop = _crop(img, *TITLE_REGION)
    text = _ocr(title_crop, psm=6).upper()
    if "GAME" in text and "OVER" in text:
        return "game_over"
    if "MY" in text and "MATCH" in text:
        return "my_matches"

    # Check the narrower tab bar region (MY MATCHES tab is top-left) BEFORE
    # the Final Ranking overlay check — if history is visible, prefer it.
    tab_crop = _crop(img, *MM_TAB_REGION)
    tab_text = _ocr(tab_crop, psm=6).upper()
    if "MY" in tab_text and "MATCH" in tab_text:
        return "my_matches"

    if "FINAL" in text or "RANKING" in text:
        return "final_ranking"

    # Check left panel for "Final Ranking" overlay (appears during gameplay)
    fr_crop = _crop(img, *FINAL_RANK_REGION)
    fr_prep = _preprocess_for_ocr(fr_crop)
    fr_text = _ocr(fr_prep, psm=6).upper()
    if "FINAL" in fr_text or "RANKING" in fr_text:
        return "final_ranking"
    # Fallback: "eliminated" text just above the Final Ranking panel
    elim_crop = _crop(img, *ELIMINATED_REGION)
    elim_prep = _preprocess_for_ocr(elim_crop)
    elim_text = _ocr(elim_prep, psm=6).upper()
    if "ELIMINATED" in elim_text:
        return "final_ranking"

    return "unknown"


# ── Row geometry ─────────────────────────────────────────────────────────────

def _row_y_extent(row_idx: int) -> tuple[float, float]:
    """Return (y_start, y_end) fractions for a given row index (0-based).

    If ROW_DIVIDERS is calibrated (length N_ROWS+1), use those exact splits.
    Otherwise fall back to even division of TABLE_Y_START..TABLE_Y_END.
    """
    if ROW_DIVIDERS is not None and len(ROW_DIVIDERS) == N_ROWS + 1:
        return (ROW_DIVIDERS[row_idx], ROW_DIVIDERS[row_idx + 1])
    row_h = (TABLE_Y_END - TABLE_Y_START) / N_ROWS
    y0 = TABLE_Y_START + row_idx * row_h
    return (y0, y0 + row_h)


def _find_player_row(img: np.ndarray, player_name: str, debug: bool = False) -> int | None:
    """Find which row (0-7) contains the player. Returns row index or None.

    Tries two preprocessing strategies per row: Otsu threshold (best for dark
    bg) and raw grayscale upscale (better when UI background is mid-grey).
    """
    pname = player_name.lower()

    def _ocr_cell(cell: np.ndarray) -> str:
        gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if len(cell.shape) == 3 else cell
        h, w = gray.shape[:2]
        scaled = cv2.resize(gray, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
        if pytesseract is None:
            return ""
        try:
            return pytesseract.image_to_string(scaled, config="--psm 6").lower()
        except Exception:
            return ""

    for i in range(N_ROWS):
        y0, y1 = _row_y_extent(i)
        cell = _crop_row(img, COL_PLAYER, y0, y1)

        # Strategy 1: Otsu threshold + invert
        processed = _preprocess_for_ocr(cell, scale=2.0)
        _save_debug(f"player_row{i}", processed, debug)
        text = _ocr(processed, psm=6).lower()
        log.debug(f"  row {i} OCR (thresh): {text!r}")
        if pname in text:
            return i

        # Strategy 2: raw grayscale upscale (no binarisation)
        text2 = _ocr_cell(cell)
        log.debug(f"  row {i} OCR (raw):    {text2!r}")
        if pname in text2:
            return i

    # Strategy 3: overlapping windows (half-row offset) to catch names
    # split across row boundaries
    log.debug("  Trying overlapping windows...")
    row_h = (TABLE_Y_END - TABLE_Y_START) / N_ROWS
    for i in range(N_ROWS - 1):
        y0 = TABLE_Y_START + (i + 0.5) * row_h
        y1 = y0 + row_h
        cell = _crop_row(img, COL_PLAYER, y0, y1)
        processed = _preprocess_for_ocr(cell, scale=2.0)
        text = _ocr(processed, psm=6).lower()
        log.debug(f"  overlap {i}-{i+1} OCR: {text!r}")
        if pname in text:
            # Name straddles boundary — assign to the row with more overlap
            # (i+1 since name starts at bottom of row i)
            return i + 1

    log.debug(f"  WARNING: player '{player_name}' not found in table")
    return None


# ── Template matching ────────────────────────────────────────────────────────

def _load_icon(path: Path, inner_frac: float = 1.0, color: bool = False) -> np.ndarray:
    """Load a single icon PNG, optionally cropping to inner portion.

    Returns grayscale by default, or BGR if color=True.
    """
    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    # Convert RGBA → BGR (composite on table background colour)
    if len(img.shape) == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3] / 255.0
        bgr = img[:, :, :3].astype(float)
        bg = np.array([57, 39, 38], dtype=np.float64)  # MY MATCHES table bg #262739
        bgr = (bgr * alpha[:, :, np.newaxis] + bg * (1 - alpha[:, :, np.newaxis])).astype(np.uint8)
        img = bgr
    # Crop inner portion to remove border/edge artifacts
    if inner_frac < 1.0:
        h, w = img.shape[:2]
        margin = int((1.0 - inner_frac) / 2 * min(h, w))
        img = img[margin:h - margin, margin:w - margin]
    if color:
        return img if len(img.shape) == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img


def _load_templates_multiscale(
    icons_dir: Path,
    scales: list[int],
    inner_frac: float = ICON_INNER_FRAC,
    color: bool = False,
) -> dict[str, list[np.ndarray]]:
    """Load icon PNGs and create templates at multiple scales.

    scales: target heights in pixels. Width is derived from aspect ratio.
    color: if True, load as BGR for color-aware matching.
    Returns {name: [template_at_scale0, template_at_scale1, ...]}.
    """
    templates = {}
    if not icons_dir.exists():
        return templates
    for f in sorted(icons_dir.iterdir()):
        if f.suffix.lower() != ".png":
            continue
        img = _load_icon(f, inner_frac=inner_frac, color=color)
        if img is None:
            continue
        oh, ow = img.shape[:2]
        aspect = ow / oh
        resized = [cv2.resize(img, (max(int(s * aspect), 1), s),
                              interpolation=cv2.INTER_AREA) for s in scales]
        templates[f.stem] = resized
    return templates


def _match_templates_multiscale(
    region: np.ndarray,
    templates: dict[str, list[np.ndarray]],
    threshold: float = MATCH_THRESHOLD,
    y_max_frac: float = 1.0,
    color: bool = False,
    debug: bool = False,
) -> list[tuple[str, float, int, int]]:
    """Multi-scale template matching. Returns [(name, score, x, y), ...] sorted by x.

    y_max_frac: only keep matches in the top portion of the region (0..1).
    color: if True, match per-channel and average (templates must be BGR).
    """
    if color:
        region_match = region if len(region.shape) == 3 else cv2.cvtColor(region, cv2.COLOR_GRAY2BGR)
    else:
        region_match = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region
    rh, rw = region_match.shape[:2]
    y_max_px = int(rh * y_max_frac)
    matches = []
    for name, tmpls in templates.items():
        for tmpl in tmpls:
            th, tw = tmpl.shape[:2]
            if rh < th or rw < tw:
                continue
            if color:
                # Average score across B, G, R channels
                result = np.zeros((rh - th + 1, rw - tw + 1), dtype=np.float32)
                for ch in range(3):
                    result += cv2.matchTemplate(region_match[:, :, ch], tmpl[:, :, ch],
                                                cv2.TM_CCOEFF_NORMED)
                result /= 3
            else:
                result = cv2.matchTemplate(region_match, tmpl, cv2.TM_CCOEFF_NORMED)
            locs = np.where(result >= threshold)
            for pt_y, pt_x in zip(*locs):
                if pt_y > y_max_px:
                    continue
                score = result[pt_y, pt_x]
                matches.append((name, float(score), int(pt_x), int(pt_y)))

    # De-duplicate overlapping matches: keep highest score per location
    matches.sort(key=lambda m: -m[1])
    kept = []
    used_positions: list[tuple[int, int]] = []
    min_gap = 25
    for name, score, x, y in matches:
        too_close = any(abs(x - ux) < min_gap and abs(y - uy) < min_gap
                        for ux, uy in used_positions)
        if not too_close:
            kept.append((name, score, x, y))
            used_positions.append((x, y))

    kept.sort(key=lambda m: m[2])  # sort left to right
    for name, score, x, y in kept:
        log.debug(f"    match: {name:20s} score={score:.3f} pos=({x},{y})")
    return kept


def _best_template_match(
    region: np.ndarray,
    templates: dict[str, list[np.ndarray]],
    *,
    color: bool = False,
) -> tuple[str, float, tuple[int, int], tuple[int, int]] | None:
    """Return the single best template match in a small, known slot."""
    if region.size == 0:
        return None
    if color:
        region_match = region if len(region.shape) == 3 else cv2.cvtColor(region, cv2.COLOR_GRAY2BGR)
    else:
        region_match = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region

    rh, rw = region_match.shape[:2]
    best: tuple[str, float, tuple[int, int], tuple[int, int]] | None = None
    for name, tmpls in templates.items():
        for tmpl in tmpls:
            th, tw = tmpl.shape[:2]
            if rh < th or rw < tw:
                continue
            if color:
                result = np.zeros((rh - th + 1, rw - tw + 1), dtype=np.float32)
                for ch in range(3):
                    result += cv2.matchTemplate(region_match[:, :, ch], tmpl[:, :, ch],
                                                cv2.TM_CCOEFF_NORMED)
                result /= 3
            else:
                result = cv2.matchTemplate(region_match, tmpl, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(result)
            if best is None or max_val > best[1]:
                best = (name, float(max_val), max_loc, (th, tw))
    return best


def _match_slot_zone(region_bgr, slot_idx, grid_start, grid_spacing, zy0, zy1,
                     templates, threshold, top_n: int = 1):
    """Match one slot in a cropped y-zone.

    When top_n=1 (default), returns (name, score, x, y) or None.
    When top_n>1, returns [(name, score, x, y), ...] sorted by score desc,
    using a minimum threshold of 0.3 for runner-ups.
    Also returns the slot crop as second element: (matches, slot_img).
    """
    rw = region_bgr.shape[1]
    sx = grid_start + slot_idx * grid_spacing
    crop_x0 = max(sx - 5, 0)
    crop_x1 = min(sx + grid_spacing + 5, rw)
    slot_img = region_bgr[zy0:zy1, crop_x0:crop_x1]
    if slot_img.size == 0:
        return None if top_n == 1 else ([], slot_img)

    all_scores: list[tuple[str, float, int, int]] = []
    for name, tmpls in templates.items():
        best_val = 0.0
        best_loc = (0, 0)
        for tmpl in tmpls:
            th, tw = tmpl.shape[:2]
            if slot_img.shape[0] < th or slot_img.shape[1] < tw:
                continue
            result = np.zeros((slot_img.shape[0] - th + 1,
                               slot_img.shape[1] - tw + 1), dtype=np.float32)
            for ch in range(3):
                result += cv2.matchTemplate(slot_img[:, :, ch], tmpl[:, :, ch],
                                            cv2.TM_CCOEFF_NORMED)
            result /= 3.0
            _, max_val, _, max_loc = cv2.minMaxLoc(result)
            if max_val > best_val:
                best_val = max_val
                best_loc = max_loc
        min_thresh = 0.3 if top_n > 1 else threshold
        if best_val >= min_thresh:
            all_scores.append((name, float(best_val), sx, zy0 + best_loc[1]))

    all_scores.sort(key=lambda m: -m[1])

    if top_n == 1:
        if all_scores and all_scores[0][1] >= threshold:
            return all_scores[0]
        return None

    return (all_scores[:top_n], slot_img)


def _detect_two_row(region_bgr, grid_start, grid_spacing, y_mid, rh,
                    templates):
    """Check if any of the first 3 slots in the bottom half has a match >= 0.70.

    Checks multiple slots because the bottom row may not start at slot 0.
    """
    rw = region_bgr.shape[1]
    for slot_idx in range(3):
        sx = grid_start + slot_idx * grid_spacing
        crop_x0 = max(sx - 5, 0)
        crop_x1 = min(sx + grid_spacing + 5, rw)
        slot_img = region_bgr[max(y_mid - 8, 0):rh, crop_x0:crop_x1]
        if slot_img.size == 0:
            continue
        for name, tmpls in templates.items():
            for tmpl in tmpls:
                th, tw = tmpl.shape[:2]
                if slot_img.shape[0] < th or slot_img.shape[1] < tw:
                    continue
                result = np.zeros((slot_img.shape[0] - th + 1,
                                   slot_img.shape[1] - tw + 1), dtype=np.float32)
                for ch in range(3):
                    result += cv2.matchTemplate(slot_img[:, :, ch], tmpl[:, :, ch],
                                                cv2.TM_CCOEFF_NORMED)
                result /= 3.0
                _, max_val, _, _ = cv2.minMaxLoc(result)
                if max_val >= 0.70:
                    return True
    return False


def _match_unit_grid(
    unit_region: np.ndarray,
    templates: dict[str, list[np.ndarray]],
    threshold: float = UNIT_MATCH_THRESHOLD,
    debug: bool = False,
) -> list[tuple[str, float, int, int]]:
    """Per-slot unit matching against individual grid cells.

    Detects one-row vs two-row layout first:
    - One-row (≤9 units): icons sit in middle band. Match each slot once.
    - Two-row (10+ units): icons in top and bottom halves. Split at y_mid,
      match each half independently. One match per slot per half.

    Returns [(name, score, x, y), ...] sorted by y then x.
    """
    region_bgr = unit_region if len(unit_region.shape) == 3 else cv2.cvtColor(unit_region, cv2.COLOR_GRAY2BGR)
    rh, rw = region_bgr.shape[:2]

    grid_start = int(rw * MM_UNIT_GRID_START_FRAC)
    grid_spacing = max(int(rw * MM_UNIT_GRID_SPACING_FRAC), 1)
    y_mid = int(rh * MM_UNIT_SPLIT_Y)

    two_row = _detect_two_row(region_bgr, grid_start, grid_spacing, y_mid, rh,
                              templates)

    if two_row:
        zones = [(0, y_mid, "top"), (max(y_mid - 8, 0), rh, "bot")]
    else:
        # Single row — icons centred vertically
        oy0 = int(rh * MM_UNIT_ONE_ROW_Y[0])
        oy1 = int(rh * MM_UNIT_ONE_ROW_Y[1])
        zones = [(oy0, oy1, "row")]

    log.debug(f"    layout={'two-row' if two_row else 'one-row'}, zones={[(l, y0, y1) for y0, y1, l in zones]}")

    all_matches = []
    for zy0, zy1, zone_label in zones:
        for slot_idx in range(MM_UNIT_MAX_SLOTS):
            m = _match_slot_zone(region_bgr, slot_idx, grid_start, grid_spacing,
                                 zy0, zy1, templates, threshold)
            if m:
                all_matches.append(m)
                log.debug(f"    slot {zone_label}[{slot_idx}]: {m[0]:20s} score={m[1]:.3f}")

    all_matches.sort(key=lambda m: (m[3], m[2]))
    return all_matches


def _match_relic_grid(
    relic_region: np.ndarray,
    templates: dict[str, list[np.ndarray]],
    threshold: float = 0.55,
    debug: bool = False,
) -> list[tuple[str, float, int, int]]:
    """Per-slot relic matching against a 3-column × 2-row grid.

    Crops each of the 6 slots using calibrated positions (MM_RELIC_COL_RANGES
    and MM_RELIC_SPLIT_Y), then finds the best template match per slot.
    Returns [(name, score, x, y), ...] sorted by y then x.
    """
    region_bgr = relic_region if len(relic_region.shape) == 3 else cv2.cvtColor(relic_region, cv2.COLOR_GRAY2BGR)
    rh, rw = region_bgr.shape[:2]
    y_mid = int(rh * MM_RELIC_SPLIT_Y)

    cell_best: dict[tuple[int, int], tuple[str, float, int, int]] = {}
    for col_idx, (xf0, xf1) in enumerate(MM_RELIC_COL_RANGES):
        for row_idx in range(MM_RELIC_ROWS):
            cx0 = int(rw * xf0)
            cx1 = int(rw * xf1)
            cy0 = 0 if row_idx == 0 else y_mid
            cy1 = y_mid if row_idx == 0 else rh
            slot_img = region_bgr[cy0:cy1, cx0:cx1]
            if slot_img.size == 0:
                continue

            # Skip empty slots: dark background with little colour variation
            gray_slot = cv2.cvtColor(slot_img, cv2.COLOR_BGR2GRAY)
            if gray_slot.mean() < 35 and gray_slot.std() < 15:
                log.debug(f"    relic slot {'top' if row_idx == 0 else 'bot'}[{col_idx}]: "
                         f"empty (mean={gray_slot.mean():.0f} std={gray_slot.std():.1f})")
                continue

            for name, tmpls in templates.items():
                for tmpl in tmpls:
                    th, tw = tmpl.shape[:2]
                    if slot_img.shape[0] < th or slot_img.shape[1] < tw:
                        continue
                    result = np.zeros((slot_img.shape[0] - th + 1,
                                       slot_img.shape[1] - tw + 1), dtype=np.float32)
                    for ch in range(3):
                        result += cv2.matchTemplate(slot_img[:, :, ch], tmpl[:, :, ch],
                                                    cv2.TM_CCOEFF_NORMED)
                    result /= 3.0
                    _, max_val, _, max_loc = cv2.minMaxLoc(result)
                    if max_val < threshold:
                        continue
                    key = (col_idx, row_idx)
                    if key not in cell_best or max_val > cell_best[key][1]:
                        cell_best[key] = (name, float(max_val), cx0 + max_loc[0], cy0 + max_loc[1])

    # Single-relic detection: when a column has only weak half-slot matches
    # (both < 0.80), try matching the full-height column. A single relic sits
    # centered vertically and gets split across both halves, producing two
    # low-confidence matches. A full-height match captures the whole icon.
    SINGLE_RELIC_THRESH = 0.80
    for col_idx, (xf0, xf1) in enumerate(MM_RELIC_COL_RANGES):
        top_match = cell_best.get((col_idx, 0))
        bot_match = cell_best.get((col_idx, 1))
        top_score = top_match[1] if top_match else 0
        bot_score = bot_match[1] if bot_match else 0

        # Skip if either half already has a strong match (2-relic column)
        if top_score >= SINGLE_RELIC_THRESH or bot_score >= SINGLE_RELIC_THRESH:
            continue
        # Skip if neither half matched at all
        if not top_match and not bot_match:
            continue

        # Try full-height match for this column
        cx0 = int(rw * xf0)
        cx1 = int(rw * xf1)
        full_slot = region_bgr[0:rh, cx0:cx1]
        if full_slot.size == 0:
            continue

        best_name, best_score, best_x, best_y = "", 0.0, 0, 0
        for name, tmpls in templates.items():
            for tmpl in tmpls:
                th, tw = tmpl.shape[:2]
                if full_slot.shape[0] < th or full_slot.shape[1] < tw:
                    continue
                result = np.zeros((full_slot.shape[0] - th + 1,
                                   full_slot.shape[1] - tw + 1), dtype=np.float32)
                for ch in range(3):
                    result += cv2.matchTemplate(full_slot[:, :, ch], tmpl[:, :, ch],
                                                cv2.TM_CCOEFF_NORMED)
                result /= 3.0
                _, max_val, _, max_loc = cv2.minMaxLoc(result)
                if max_val > best_score:
                    best_score = float(max_val)
                    best_name = name
                    best_x = cx0 + max_loc[0]
                    best_y = max_loc[1]

        if best_score > max(top_score, bot_score) and best_score >= threshold:
            # Full-height match is better — replace both half-slots with single match
            cell_best.pop((col_idx, 0), None)
            cell_best.pop((col_idx, 1), None)
            cell_best[(col_idx, -1)] = (best_name, best_score, best_x, best_y)
            log.debug(f"    relic slot full[{col_idx}]: {best_name:20s} score={best_score:.3f} "
                     f"(was top={top_score:.3f} bot={bot_score:.3f})")

    all_matches = []
    for (col_idx, row_idx) in sorted(cell_best):
        name, score, x, y = cell_best[(col_idx, row_idx)]
        if row_idx == -1:
            zone_label = "full"
        else:
            zone_label = "top" if row_idx == 0 else "bot"
        all_matches.append((name, score, x, y))
        log.debug(f"    relic slot {zone_label}[{col_idx}]: {name:20s} score={score:.3f}")
    all_matches.sort(key=lambda m: (m[3], m[2]))
    return all_matches


def _ocr_synergy_counts(
    region: np.ndarray,
    matches: list[tuple[str, float, int, int]],
    icon_px: int,
    debug: bool = False,
) -> list[tuple[str, int]]:
    """Read count numbers below each matched synergy icon.

    OCR the bottom portion of the synergy cell (below the badge icons)
    as a single line, then parse all "(N)" tokens and associate each
    with the nearest icon by x-position.
    """
    if not matches:
        return []

    h, w = region.shape[:2]
    # Count text starts ~42% down the cell (just above the icon bottoms)
    # and extends to ~78% (below that is the row separator / items bar)
    count_y0 = int(h * 0.42)
    count_y1 = int(h * 0.78)
    # Trim left (icon bleed) and right (relic bleed) margins
    first_icon_x = matches[0][2]
    count_x0 = max(first_icon_x - 5, 0)  # start just before first icon
    count_x1 = int(w * 0.80)
    count_strip = region[count_y0:count_y1, count_x0:count_x1]
    _save_debug("synergy_count_strip", count_strip, debug)

    # Threshold + invert → black text on white, then scale up
    gray = cv2.cvtColor(count_strip, cv2.COLOR_BGR2GRAY) if len(count_strip.shape) == 3 else count_strip
    _, bw = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
    inv = cv2.bitwise_not(bw)
    scale = 4
    scaled = cv2.resize(inv, (inv.shape[1] * scale, inv.shape[0] * scale),
                        interpolation=cv2.INTER_NEAREST)
    # Add white padding to avoid edge artifacts confusing Tesseract
    scaled = cv2.copyMakeBorder(scaled, 20, 20, 20, 20,
                                cv2.BORDER_CONSTANT, value=255)
    _save_debug("synergy_count_strip_proc", scaled, debug)

    # OCR as sparse text with OSD (psm 12 catches isolated characters better)
    raw = _ocr(scaled, psm=12)
    log.debug(f"    Count strip OCR raw: {raw!r}")
    # Extract all digits from "(N)" patterns
    # The OCR may mangle parentheses, so just find all isolated digits
    all_counts = re.findall(r"\d+", raw)
    counts = [int(d) for d in all_counts if 1 <= int(d) <= 12]
    log.debug(f"    Parsed counts: {counts}")
    # Associate counts left-to-right with matches left-to-right
    results = []
    for i, (name, score, x, y) in enumerate(matches):
        count = counts[i] if i < len(counts) else 0
        log.debug(f"    {name} → count={count}")
        results.append((name, count))
    return results


def _ocr_game_over_synergy_counts(region: np.ndarray, debug: bool = False) -> list[int]:
    """OCR visible Game Over synergy counts left-to-right.

    Single PSM + single threshold misses a count when the digit overlaps
    icon-bleed colors (e.g. the 3rd "(3)" in a 4-synergy row reads as
    "GF"/"SP" instead of "3"). Try several (threshold, PSM) combinations
    and keep the result with the most digits — only the COUNT matters
    (downstream zips with template matches by position), so picking the
    OCR with the most numerals reliably gets every synergy a slot.
    """
    h, w = region.shape[:2]

    def _ocr_band(y0_frac: float, y1_frac: float) -> list[int]:
        strip = region[int(h * y0_frac):int(h * y1_frac), 0:w]
        if strip.size == 0:
            return []
        gray = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY) if len(strip.shape) == 3 else strip
        best: list[int] = []
        for thresh_val in (150, 180, 140):
            _, bw = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)
            inv = cv2.bitwise_not(bw)
            scaled = cv2.resize(inv, (inv.shape[1] * 4, inv.shape[0] * 4),
                                interpolation=cv2.INTER_NEAREST)
            scaled = cv2.copyMakeBorder(scaled, 20, 20, 20, 20,
                                        cv2.BORDER_CONSTANT, value=255)
            for psm in (6, 12, 11):
                raw = _ocr(scaled, psm=psm)
                digits = [int(d) for d in re.findall(r"\d+", raw)
                          if 1 <= int(d) <= 12]
                if len(digits) > len(best):
                    best = digits
        return best

    _save_debug("go_synergy_count_strip", region, debug)
    top_counts = _ocr_band(0.42, 0.78)
    bot_counts = _ocr_band(0.80, 0.95)
    counts = top_counts + bot_counts
    log.debug(f"    Game Over counts: top={top_counts} bot={bot_counts} -> {counts}")
    return counts


def _parse_game_over_synergies(
    region: np.ndarray,
    icons_dir: Path,
    syn_templates: dict[str, list[np.ndarray]] | None = None,
    debug: bool = False,
) -> str:
    """Parse Game Over synergy icons using fixed table slots plus OCR counts."""
    counts = _ocr_game_over_synergy_counts(region, debug=debug)
    if not counts:
        if syn_templates is None:
            syn_templates = _load_templates_multiscale(icons_dir / "synergies", SYNERGY_ICON_SCALES)
        syn_matches = _match_templates_multiscale(region, syn_templates,
                                                  y_max_frac=SYNERGY_BADGE_Y_MAX_FRAC,
                                                  debug=debug)
        avg_icon_px = SYNERGY_ICON_SCALES[len(SYNERGY_ICON_SCALES) // 2]
        syn_counts = _ocr_synergy_counts(region, syn_matches, avg_icon_px, debug=debug)
        if syn_counts:
            return "|".join(f"{name}:{count}" for name, count in syn_counts if count > 0)
        return "|".join(f"{name}:0" for name, _, _, _ in syn_matches)

    if syn_templates is None:
        syn_templates = _load_templates_multiscale(icons_dir / "synergies", SYNERGY_ICON_SCALES)
    fallback_templates = _load_templates_multiscale(
        icons_dir / "synergies",
        SYNERGY_ICON_SCALES,
        inner_frac=GO_SYN_FALLBACK_INNER_FRAC,
    )

    h, w = region.shape[:2]
    # Top row is always present; bottom row only when OCR found >6 counts.
    # Matching the whole cell on 1-row layouts picks up item-bar noise.
    if len(counts) > 6:
        y_max = 0.96
    else:
        y_max = GO_SYN_GLOBAL_Y_MAX_FRAC
    matches = _match_templates_multiscale(
        region,
        syn_templates,
        threshold=MATCH_THRESHOLD,
        y_max_frac=y_max,
        debug=debug,
    )

    # Leading-slot fallback (e.g. Naga's icon scores in the 0.40s but OCR
    # confirms a count is present at the leftmost slot). Keep this BEFORE
    # the low-threshold retry so naga is detected from the loose templates.
    if counts and len(matches) < len(counts):
        first_x = matches[0][2] if matches else w
        if first_x > w * 0.12:
            sx0, sx1 = GO_SYN_SLOT_X_RANGES[0]
            sy0, sy1 = GO_SYN_SLOT_Y_RANGE
            slot = region[int(h * sy0):int(h * sy1), int(w * sx0):int(w * sx1)]
            fallback = _best_template_match(slot, fallback_templates)
            if fallback and fallback[1] >= GO_SYN_FALLBACK_THRESHOLD:
                name, score, _, _ = fallback
                matches.insert(0, (name, score, int(w * sx0), int(h * sy0)))
                log.debug(f"    go syn leading fallback: {name:20s} score={score:.3f}")

    # Still under-detected? Mid-slot icons (e.g. assassin) sometimes score in
    # the 0.55-0.70 band. Retry at lower threshold and merge in any matches
    # at unused x-positions, keeping the best score per icon name.
    if counts and len(matches) < len(counts):
        extras = _match_templates_multiscale(
            region,
            syn_templates,
            threshold=0.55,
            y_max_frac=y_max,
            debug=debug,
        )
        used_xs = [m[2] for m in matches]
        used_names = {m[0] for m in matches}
        for name, score, x, y in extras:
            if name in used_names:
                continue
            if any(abs(x - ux) < 30 for ux in used_xs):
                continue
            matches.append((name, score, x, y))
            used_xs.append(x)
            used_names.add(name)

    # _match_templates_multiscale sorts left-to-right which collapses rows.
    # For 2-row layouts, re-sort by (y_band, x) so top-row icons come first.
    row_split = int(h * 0.48)
    matches.sort(key=lambda m: (0 if m[3] < row_split else 1, m[2]))

    parsed: list[tuple[str, int]] = []
    for (name, score, x, y), count in zip(matches, counts):
        parsed.append((name, count))
        log.debug(f"    go syn: {name:20s} score={score:.3f} pos=({x},{y}) count={count}")

    return "|".join(f"{name}:{count}" for name, count in parsed)


def _parse_game_over_relics(
    region: np.ndarray,
    relic_templates: dict[str, list[np.ndarray]] | None,
    icons_dir: Path,
    debug: bool = False,
) -> str:
    """Parse Game Over relics from known slots, conservatively skipping noise."""
    if relic_templates is None:
        relic_templates = _load_templates_multiscale(
            icons_dir / "relics",
            GO_RELIC_ICON_SCALES,
            inner_frac=GO_RELIC_INNER_FRAC,
            color=True,
        )

    h, w = region.shape[:2]
    relics: list[str] = []
    seen: set[str] = set()
    for label, (x0f, x1f, y0f, y1f), threshold, min_h in GO_RELIC_SLOTS:
        slot = region[int(h * y0f):int(h * y1f), int(w * x0f):int(w * x1f)]
        match = _best_template_match(slot, relic_templates, color=True)
        if match is None:
            continue
        name, score, _, tmpl_shape = match
        if score < threshold:
            log.debug(f"    go relic {label}: {name:20s} score={score:.3f} below threshold")
            continue
        if min_h and tmpl_shape[0] < min_h:
            log.debug(f"    go relic {label}: {name:20s} score={score:.3f} too small")
            continue
        if name in seen:
            continue
        seen.add(name)
        relics.append(name.replace("_", " ").title())
        log.debug(f"    go relic {label}: {name:20s} score={score:.3f}")

    return "|".join(relics)


RANK_NAMES = ("Pawn", "Knight", "Bishop", "Rook", "King", "Queen")


# ── Identity hint helpers ────────────────────────────────────────────────────
# Fuzzy-name fallback for the "which row is the logged-in user?" question.
# The companion avatar-comparison leg (PRD identity strategy step 1) is not
# yet wired; until it lands, `current_user_name` is the only identity signal
# the parser uses.

# Strip bracketed clan tags like "[FC4P]" or "(NA)" that often trail a name.
_NAME_TAG_RE = re.compile(r"[\[\(].*?[\]\)]")
# Trim leading/trailing OCR noise: pipes, slashes, dashes, periods, commas.
_NAME_NOISE_RE = re.compile(r"^[\s\|\\/\.,:;\-_'\"`~]+|[\s\|\\/\.,:;\-_'\"`~]+$")
_NAME_WS_RE = re.compile(r"\s+")

# Minimum SequenceMatcher ratio at which we treat an OCR'd row name as the
# logged-in user. Tuned conservatively; below this we leave the row unflagged
# rather than risk linking the wrong row.
IDENTITY_MATCH_THRESHOLD = 0.72


def _normalize_player_name(text: str) -> str:
    """Lowercase, drop bracketed tags + edge punctuation, collapse whitespace."""
    if not text:
        return ""
    cleaned = _NAME_TAG_RE.sub(" ", str(text))
    cleaned = _NAME_NOISE_RE.sub("", cleaned)
    cleaned = _NAME_WS_RE.sub(" ", cleaned).strip().lower()
    return cleaned


def name_match_score(ocr_name: str, target_name: str) -> float:
    """Return 0.0–1.0 similarity between an OCR'd row name and a target name.

    Returns 1.0 on exact normalized match, 0.0 if either side is empty,
    otherwise a difflib SequenceMatcher ratio on the normalized strings.
    """
    a = _normalize_player_name(ocr_name)
    b = _normalize_player_name(target_name)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _row_confidence(row: dict) -> float:
    """Coarse 0.0–1.0 confidence for a parsed Game Over row.

    Rewards rows where the high-signal fields (level, W-L, synergies, relic,
    player name) parsed non-empty. Used downstream to surface "needs review"
    rows in correction UIs without inventing per-field probabilities.
    """
    weights = {
        "level": 1.0,
        "wl": 1.0,
        "synergies": 1.0,
        "relic": 1.0,
        "player_name": 1.0,
        "rank": 0.5,
    }
    score = 0.0
    for key, weight in weights.items():
        if str(row.get(key, "") or "").strip():
            score += weight
    return round(score / sum(weights.values()), 3)


# ── GAME OVER table parser ───────────────────────────────────────────────────

def _trace_region(
    name: str,
    kind: str,
    category: str,
    bbox: tuple[float, float, float, float],
    label: str = "",
    row_index: int | None = None,
    crop: np.ndarray | None = None,
) -> dict:
    entry = {
        "name": name,
        "kind": kind,
        "category": category,
        "bbox": [round(float(v), 5) for v in bbox],
        "label": label or "",
        "row_index": row_index,
    }
    if crop is not None:
        entry["crop_b64"] = _img_to_b64(crop)
    return entry


def _game_over_row_bboxes(row_idx: int) -> dict[str, tuple[float, float, float, float]]:
    y0, y1 = _row_y_extent(row_idx)
    rh = y1 - y0
    return {
        "player": (
            COL_PLAYER[0],
            y0 + rh * GO_PLAYER_NAME_Y[0],
            COL_PLAYER[1],
            y0 + rh * GO_PLAYER_NAME_Y[1],
        ),
        "rank": (
            COL_PLAYER[0],
            y0 + rh * GO_RANK_Y_IN_PLAYER[0],
            COL_PLAYER[1],
            y0 + rh * GO_RANK_Y_IN_PLAYER[1],
        ),
        "level": (COL_LEVEL[0], y0, COL_LEVEL[1], y1),
        "synergies": (COL_SYNERGY[0], y0, COL_SYNERGY[1], y1),
        "relic": (COL_RELIC[0], y0, COL_RELIC[1], y1),
        "wl": (COL_WL[0], y0, COL_WL[1], y1),
        "row": (0.0, y0, 1.0, y1),
        "placement": (COL_PLACEMENT[0], y0, COL_PLACEMENT[1], y1),
        "avatar": (COL_AVATAR[0], y0, COL_AVATAR[1], y1),
        "talent": (COL_TALENT[0], y0, COL_TALENT[1], y1),
        "units": (COL_UNITS[0], y0, COL_UNITS[1], y1),
        "gold": (COL_GOLD[0], y0, COL_GOLD[1], y1),
        "damage": (COL_DAMAGE[0], y0, COL_DAMAGE[1], y1),
        "duration": (COL_DURATION[0], y0, COL_DURATION[1], y1),
    }


def parse_game_over(
    img: np.ndarray,
    player_name: str,
    icons_dir: Path,
    debug: bool = False,
) -> dict | None:
    """Parse a GAME OVER table screenshot.

    Returns dict with keys: placement, level, wl, synergies, relic
    or None on failure.
    """
    apply_calibration(img)
    h, w = img.shape[:2]
    log.debug(f"Image: {w}×{h}")
    # 1. Find player row
    log.info("[cv] Finding player row...")
    row_idx = _find_player_row(img, player_name, debug=debug)
    if row_idx is None:
        log.error(f"[cv] ERROR: could not find player '{player_name}' in table")
        return None
    y0, y1 = _row_y_extent(row_idx)
    log.info(f"[cv] Player found in row {row_idx + 1} (y={y0:.3f}-{y1:.3f})")

    # 2. Placement = row index + 1 (table is ordered by placement)
    placement = row_idx + 1

    # 3. OCR level
    level_cell = _crop_row(img, COL_LEVEL, y0, y1)
    level_proc = _preprocess_for_ocr(level_cell, scale=3.0)
    _save_debug("level_cell", level_proc, debug)
    level_raw = _ocr(level_proc, psm=7, whitelist="0123456789")
    digits = re.findall(r"\d+", level_raw)
    level = ""
    if digits:
        lv = int(digits[0])
        level = str(lv) if 1 <= lv <= 15 else ""
    log.debug(f"  Level OCR: {level_raw!r} → {level!r}")
    # 4. OCR W-L
    wl_cell = _crop_row(img, COL_WL, y0, y1)
    wl_proc = _preprocess_for_ocr(wl_cell, scale=3.0)
    _save_debug("wl_cell", wl_proc, debug)
    wl_raw = _ocr(wl_proc, psm=7, whitelist="0123456789-")
    wl_match = re.search(r"(\d{1,3})\s*[-–]\s*(\d{1,3})", wl_raw)
    wl = f"{wl_match.group(1)}-{wl_match.group(2)}" if wl_match else ""
    log.debug(f"  W-L OCR: {wl_raw!r} → {wl!r}")
    # 5. Template match synergies
    log.info("[cv] Matching synergy icons...")
    syn_cell = _crop_row(img, COL_SYNERGY, y0, y1)
    _save_debug("synergy_cell", syn_cell, debug)
    syn_templates = _load_templates_multiscale(icons_dir / "synergies", SYNERGY_ICON_SCALES)
    log.debug(f"  Loaded {len(syn_templates)} synergy templates at scales {SYNERGY_ICON_SCALES}")
    synergies = _parse_game_over_synergies(
        syn_cell, icons_dir, syn_templates=syn_templates, debug=debug)

    # 6. Template match relics using fixed Game Over slots.
    log.info("[cv] Matching relic icons...")
    relic_cell = _crop_row(img, COL_RELIC, y0, y1)
    _save_debug("relic_cell", relic_cell, debug)
    relic_templates = _load_templates_multiscale(
        icons_dir / "relics",
        GO_RELIC_ICON_SCALES,
        inner_frac=GO_RELIC_INNER_FRAC,
        color=True,
    )
    log.debug(f"  Loaded {len(relic_templates)} relic templates at scales {GO_RELIC_ICON_SCALES}")
    relic = _parse_game_over_relics(relic_cell, relic_templates, icons_dir, debug=debug)
    # 7. Extract rank from this player's own row (below the player name)
    rank = _ocr_player_rank(img, row_idx, debug=debug)
    log.debug(f"  Rank: {rank!r}")
    result = {
        "placement": str(placement),
        "level": level,
        "wl": wl,
        "synergies": synergies,
        "relic": relic,
        "rank": rank,
    }
    log.info(f"[cv] Result: {result}")
    return result


_RANK_RE = re.compile(
    r"(" + "|".join(RANK_NAMES) + r")[\s\-_]*(\d)",
    re.IGNORECASE,
)


def _ocr_player_name(img: np.ndarray, row_idx: int, debug: bool = False) -> str:
    """OCR the player name from the top of one game-over row's COL_PLAYER cell.

    Uses eng+rus when rus.traineddata is available so Cyrillic in-game names
    (e.g. "Мангут Рахал") come back as Cyrillic instead of garbled Latin.
    Tesseract silently falls back to English when rus is missing.
    """
    y0, y1 = _row_y_extent(row_idx)
    rh = y1 - y0
    # Name occupies the upper portion of the cell; rank sits below it.
    cell = _crop(img, COL_PLAYER[0], y0 + rh * GO_PLAYER_NAME_Y[0],
                 COL_PLAYER[1], y0 + rh * GO_PLAYER_NAME_Y[1])
    processed = _preprocess_for_ocr(cell, scale=2.5)
    _save_debug(f"player_name_row{row_idx}", processed, debug)
    text = _ocr(processed, psm=7, lang="eng+rus").strip()
    if not text:
        gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if len(cell.shape) == 3 else cell
        ch, cw = gray.shape[:2]
        scaled = cv2.resize(gray, (cw * 3, ch * 3), interpolation=cv2.INTER_CUBIC)
        try:
            text = pytesseract.image_to_string(scaled, config="--psm 7 -l eng+rus").strip()
        except Exception:
            text = ""
    if text:
        text = text.split("\n")[0].strip()
    log.debug(f"  [player name] row {row_idx}: {text!r}")
    return text


def _ocr_player_rank(img: np.ndarray, row_idx: int, debug: bool = False) -> str:
    """OCR the rank ("Bishop-7", "Knight-3", "Unranked", ...) from the bottom
    of one game-over row's COL_PLAYER cell.

    Falls through multiple PSM modes — PSM 7 alone misses rows where the
    rank text shares the cell with avatar bleed or noisy backgrounds; PSM 6
    and 11/12 catch those.
    """
    y0, y1 = _row_y_extent(row_idx)
    rh = y1 - y0
    # Skip the leftmost ~25% of the player column — that area holds the rank
    # icon (chess piece) which Tesseract reads as noise and pollutes the OCR
    # for the tier text that sits to its right.
    cw = COL_PLAYER[1] - COL_PLAYER[0]
    cell_x0 = COL_PLAYER[0] + cw * 0.25
    cell = _crop(img, cell_x0, y0 + rh * GO_RANK_Y_IN_PLAYER[0],
                 COL_PLAYER[1], y0 + rh * GO_RANK_Y_IN_PLAYER[1])
    processed = _preprocess_for_ocr(cell, scale=3.0)
    _save_debug(f"player_rank_row{row_idx}", processed, debug)

    best_text = ""
    for psm in (7, 6, 11, 12):
        text = _ocr(processed, psm=psm).strip()
        if not text:
            continue
        best_text = best_text or text
        m = _RANK_RE.search(text)
        if m:
            rank = f"{m.group(1).title()}-{m.group(2)}"
            log.debug(f"  [player rank] row {row_idx}: psm={psm} raw={text!r} -> {rank!r}")
            return rank
        # Lenient unranked match — Tesseract sometimes drops a letter
        # ("Unranke", "Ynranked"). "rank" alone is safe because none of the
        # tier names (Pawn/Knight/Bishop/Rook/King/Queen) contain it.
        if "rank" in text.lower():
            log.debug(f"  [player rank] row {row_idx}: psm={psm} raw={text!r} -> 'Unranked'")
            return "Unranked"

    log.debug(f"  [player rank] row {row_idx}: raw={best_text!r} -> ''")
    return ""


# ── Per-column OCR/grid helpers used by both _parse_row_data and the Lab trace ─

_LEVEL_OCR_SUBSTITUTIONS = str.maketrans({
    # Common Tesseract confusions on the DAC level font (yellow stylized digits).
    "S": "5", "s": "5",
    "O": "0", "o": "0",
    "l": "1", "I": "1",
    "Z": "2", "z": "2",
    "B": "8",
    "G": "6",
    "T": "7",
    "q": "9",
})


def _ocr_level_multi_psm(cell: np.ndarray) -> str:
    """OCR a Game Over level cell.

    The digit is yellow on a varied background and the in-game font is
    stylised enough that Tesseract often misreads (e.g. "5"→"S"). Pipeline:
    1. HSV yellow-mask the cell.
    2. Tight-crop the mask to a single bbox covering all yellow blobs that
       are large enough to be digit strokes (keeps "14" together).
    3. Upscale to ~120px tall with white border.
    4. OCR across PSM modes, first with digit whitelist, then without
       whitelist + letter→digit substitution.
    """
    if cell.size == 0:
        return ""
    hsv = cv2.cvtColor(cell, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (15, 80, 150), (40, 255, 255))
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return ""
    big = [c for c in cnts if cv2.contourArea(c) >= 20]
    if not big:
        big = cnts
    xs, ys, xe, ye = [], [], [], []
    for c in big:
        x, y, w, h = cv2.boundingRect(c)
        xs.append(x); ys.append(y); xe.append(x + w); ye.append(y + h)
    pad = 4
    mh, mw = mask.shape[:2]
    x0 = max(min(xs) - pad, 0)
    y0 = max(min(ys) - pad, 0)
    x1 = min(max(xe) + pad, mw)
    y1 = min(max(ye) + pad, mh)
    digit_mask = mask[y0:y1, x0:x1]
    if digit_mask.size == 0:
        return ""
    inv = cv2.bitwise_not(digit_mask)
    target_h = 120
    scale = max(1, target_h // max(inv.shape[0], 1))
    upscaled = cv2.resize(inv, (inv.shape[1] * scale, inv.shape[0] * scale),
                          interpolation=cv2.INTER_NEAREST)
    proc = cv2.copyMakeBorder(upscaled, 40, 40, 40, 40,
                              cv2.BORDER_CONSTANT, value=255)

    def _parse(text: str) -> str:
        digits = re.findall(r"\d+", text)
        if digits:
            lv = int(digits[0])
            if 1 <= lv <= 15:
                return str(lv)
        return ""

    for psm in (10, 13, 7, 8, 6):
        raw = _ocr(proc, psm=psm, whitelist="0123456789")
        out = _parse(raw)
        if out:
            return out
    for psm in (10, 13, 7, 8, 6):
        raw = _ocr(proc, psm=psm)
        out = _parse(raw.translate(_LEVEL_OCR_SUBSTITUTIONS))
        if out:
            return out
    return ""


def _ocr_go_placement(img: np.ndarray, row_idx: int, debug: bool = False) -> str:
    """Return placement for a Game Over row.

    Game Over rows are always sorted by placement 1..8 (top to bottom), so
    the row index uniquely determines the placement. The stylized yellow
    digits in the cell misread frequently (3→7, 6→7), so trusting row order
    is both simpler and more reliable than OCR.
    """
    return str(row_idx + 1)


def _ocr_go_gold(img: np.ndarray, row_idx: int, debug: bool = False) -> str:
    """OCR the gold column ($NNN). Multi-PSM fallback."""
    y0, y1 = _row_y_extent(row_idx)
    cell = _crop_row(img, COL_GOLD, y0, y1)
    if cell.size == 0:
        return ""
    proc = _preprocess_for_ocr(cell, scale=3.0)
    _save_debug(f"go_gold_row{row_idx}", proc, debug)
    for psm in (7, 6, 11, 8):
        raw = _ocr(proc, psm=psm, whitelist="0123456789$")
        m = re.search(r"\$?(\d{1,4})", raw)
        if m:
            return f"${m.group(1)}"
    return ""


def _ocr_go_damage(img: np.ndarray, row_idx: int, debug: bool = False) -> str:
    """OCR the damage column (NNN-NNN). PSM 7 alone misses some rows; fall
    through 6/11/7/8 and return the first PSM whose output matches."""
    y0, y1 = _row_y_extent(row_idx)
    cell = _crop_row(img, COL_DAMAGE, y0, y1)
    if cell.size == 0:
        return ""
    proc = _preprocess_for_ocr(cell, scale=3.0)
    _save_debug(f"go_damage_row{row_idx}", proc, debug)
    for psm in (6, 11, 7, 8):
        raw = _ocr(proc, psm=psm, whitelist="0123456789-")
        m = re.search(r"(\d{1,4})\s*[-–]\s*(\d{1,4})", raw)
        if m:
            return f"{m.group(1)}-{m.group(2)}"
    return ""


def _ocr_go_duration(img: np.ndarray, row_idx: int, debug: bool = False) -> str:
    """OCR the duration column (MM:SS). Multi-PSM fallback."""
    y0, y1 = _row_y_extent(row_idx)
    cell = _crop_row(img, COL_DURATION, y0, y1)
    if cell.size == 0:
        return ""
    proc = _preprocess_for_ocr(cell, scale=3.0)
    _save_debug(f"go_duration_row{row_idx}", proc, debug)
    for psm in (7, 6, 11, 8):
        raw = _ocr(proc, psm=psm, whitelist="0123456789:")
        m = re.search(r"(\d{1,3}):(\d{2})", raw)
        if m:
            return f"{m.group(1)}:{m.group(2)}"
    return ""


_GO_UNITS_LOOKUP: tuple[dict[str, list[np.ndarray]] | None, dict[str, str] | None] = (None, None)
_GO_UNITS_COLOR_SIGS: dict[str, np.ndarray] | None = None

GO_UNIT_MAX_SLOTS = 12
GO_UNIT_Y_BAND = (0.22, 0.62)
GO_UNIT_THRESHOLD = 0.50
GO_UNIT_INNER_FRAC = 0.75
GO_UNIT_COLOR_THRESHOLD = 0.55
# When non-empty, these x-fractions (of the full image width) define the
# left edge of each unit slot. Last slot extends to the right edge of
# col_units. Populated from regions_config.json by apply_calibration.
GO_UNIT_SLOT_XS: list[float] = []
# Pairs of y-fractions per row: [row0_top, row0_bot, row1_top, row1_bot, ...].
# When populated (length == 2 * N_ROWS) overrides the derived y-band.
GO_UNIT_SLOT_YS: list[float] = []
GO_UNIT_SLOT_PAD_PX: int = 10


def _ensure_go_unit_templates(icons_dir: Path):
    """Load and cache unit templates + display-name lookup for Game Over.

    Templates are sampled at heights matching the GO icon size (~45px),
    with a tighter inner crop than MM so the bland icon border doesn't
    inflate Faceless Void's match score everywhere.
    """
    global _GO_UNITS_LOOKUP
    templates, lookup = _GO_UNITS_LOOKUP
    if templates is None:
        templates = _load_templates_multiscale(
            icons_dir / "units",
            [36, 40, 44, 48, 52, 56],
            inner_frac=GO_UNIT_INNER_FRAC,
            color=True,
        )
    if lookup is None:
        import json as _json
        from utils import DATA_DIR
        units_path = DATA_DIR / "units.json"
        if units_path.exists():
            data = _json.loads(units_path.read_text(encoding="utf-8")).get("units", {})
            lookup = {_unit_stem(name): name for name in data}
        else:
            lookup = {}
    _GO_UNITS_LOOKUP = (templates, lookup)
    return templates, lookup


def _go_unit_best_for_slot(slot_img, templates, threshold):
    """Return (stem, score) best match in a tightly-cropped slot, or
    ("", best_score) if nothing crosses the threshold."""
    if slot_img.size == 0:
        return ("", 0.0)
    best_name, best_score = "", 0.0
    for name, tmpls in templates.items():
        for tmpl in tmpls:
            th, tw = tmpl.shape[:2]
            if slot_img.shape[0] < th or slot_img.shape[1] < tw:
                continue
            result = np.zeros((slot_img.shape[0] - th + 1,
                               slot_img.shape[1] - tw + 1), dtype=np.float32)
            for ch in range(3):
                result += cv2.matchTemplate(slot_img[:, :, ch], tmpl[:, :, ch],
                                            cv2.TM_CCOEFF_NORMED)
            result /= 3.0
            _, mv, _, _ = cv2.minMaxLoc(result)
            if mv > best_score:
                best_score = float(mv)
                best_name = name
    if best_score >= threshold:
        return (best_name, best_score)
    return ("", best_score)


def _compute_unit_color_sig(img_bgr: np.ndarray) -> np.ndarray | None:
    """Hue-saturation histogram for an icon, normalized to sum=1.

    Game Over icons are tiny and pixelated; the template PNGs are sharper.
    A small Gaussian blur smooths both sides so the histograms compare on
    actual color distribution, not aliasing artifacts.
    """
    if img_bgr is None or img_bgr.size == 0:
        return None
    if len(img_bgr.shape) < 3:
        img_bgr = cv2.cvtColor(img_bgr, cv2.COLOR_GRAY2BGR)
    blurred = cv2.GaussianBlur(img_bgr, (5, 5), 0)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
    h, w = hsv.shape[:2]
    m = max(1, int(min(h, w) * 0.15))
    inner = hsv[m:h - m, m:w - m]
    if inner.size == 0:
        inner = hsv
    hist = cv2.calcHist([inner], [0, 1], None, [16, 16],
                        [0, 180, 0, 256])
    cv2.normalize(hist, hist, alpha=1.0, norm_type=cv2.NORM_L1)
    return hist


def _ensure_go_unit_color_sigs(icons_dir: Path) -> dict[str, np.ndarray]:
    """Load and cache per-unit color signatures from the icon PNGs."""
    global _GO_UNITS_COLOR_SIGS
    if _GO_UNITS_COLOR_SIGS is not None:
        return _GO_UNITS_COLOR_SIGS
    sigs: dict[str, np.ndarray] = {}
    units_dir = icons_dir / "units"
    if units_dir.exists():
        for p in sorted(units_dir.glob("*.png")):
            icon = _load_icon(p, color=True)
            if icon is None:
                continue
            sig = _compute_unit_color_sig(icon)
            if sig is not None:
                sigs[p.stem] = sig
    _GO_UNITS_COLOR_SIGS = sigs
    return sigs


def _go_unit_color_match(slot_img: np.ndarray,
                         sigs: dict[str, np.ndarray],
                         candidate_stems: list[str] | None = None,
                         ) -> tuple[str, float]:
    """Match a slot by color signature. Returns (stem, distance).

    Distance is Bhattacharyya — 0.0 = identical, 1.0 = disjoint.
    If candidate_stems is given, only compares against those (used as a
    tiebreaker over the template top-K).
    """
    target = _compute_unit_color_sig(slot_img)
    if target is None or not sigs:
        return ("", 1.0)
    stems = candidate_stems if candidate_stems else sigs.keys()
    best_stem, best_dist = "", 1.0
    for stem in stems:
        sig = sigs.get(stem)
        if sig is None:
            continue
        d = cv2.compareHist(sig, target, cv2.HISTCMP_BHATTACHARYYA)
        if d < best_dist:
            best_dist = float(d)
            best_stem = stem
    return (best_stem, best_dist)


def _go_unit_template_top_k(slot_img: np.ndarray,
                            templates: dict[str, list[np.ndarray]],
                            k: int = 5,
                            ) -> list[tuple[str, float]]:
    """Return the top-k templates by best score, sorted desc."""
    if slot_img is None or slot_img.size == 0:
        return []
    blurred = cv2.GaussianBlur(slot_img, (3, 3), 0)
    scored: list[tuple[str, float]] = []
    for name, tmpls in templates.items():
        best = 0.0
        for tmpl in tmpls:
            th, tw = tmpl.shape[:2]
            if blurred.shape[0] < th or blurred.shape[1] < tw:
                continue
            result = np.zeros((blurred.shape[0] - th + 1,
                               blurred.shape[1] - tw + 1), dtype=np.float32)
            for ch in range(3):
                result += cv2.matchTemplate(blurred[:, :, ch],
                                            tmpl[:, :, ch],
                                            cv2.TM_CCOEFF_NORMED)
            result /= 3.0
            _, mv, _, _ = cv2.minMaxLoc(result)
            if mv > best:
                best = float(mv)
        if best > 0:
            scored.append((name, best))
    scored.sort(key=lambda x: -x[1])
    return scored[:k]


def _go_unit_y_band(img_h: int, row_idx: int) -> tuple[int, int]:
    """Pixel y-range covering the unit icons for one Game Over row.

    Uses GO_UNIT_SLOT_YS pair when populated (calibrated per-row top/bottom
    rails), otherwise derives the band from _row_y_extent + GO_UNIT_Y_BAND.
    Symmetric vertical padding with GO_UNIT_SLOT_PAD_PX is added either way.
    """
    pad = GO_UNIT_SLOT_PAD_PX
    if (len(GO_UNIT_SLOT_YS) >= 2 * (row_idx + 1)
            and row_idx >= 0):
        top = GO_UNIT_SLOT_YS[2 * row_idx]
        bot = GO_UNIT_SLOT_YS[2 * row_idx + 1]
        zy0 = max(0, int(round(top * img_h)) - pad)
        zy1 = min(img_h, int(round(bot * img_h)) + pad)
        return (zy0, zy1)
    y0_frac, y1_frac = _row_y_extent(row_idx)
    ry0 = int(y0_frac * img_h)
    ry1 = int(y1_frac * img_h)
    rh = ry1 - ry0
    return (ry0 + int(rh * GO_UNIT_Y_BAND[0]),
            ry0 + int(rh * GO_UNIT_Y_BAND[1]))


def _go_unit_slot_ranges(img_w: int) -> list[tuple[int, int]]:
    """Return [(x0_px, x1_px), ...] for each unit slot, in image coordinates.

    Uses GO_UNIT_SLOT_XS (user-calibrated slot left edges) when available,
    falling back to an even split of col_units when not. Adds
    GO_UNIT_SLOT_PAD_PX of padding to each side so icons that sit right at
    a slot edge aren't clipped.
    """
    pad = GO_UNIT_SLOT_PAD_PX
    if GO_UNIT_SLOT_XS:
        xs = sorted(GO_UNIT_SLOT_XS)
        # Last slot's right edge: use next entry, or col_units right edge.
        right_end = COL_UNITS[1]
        ranges = []
        for i, x in enumerate(xs):
            x_next = xs[i + 1] if i + 1 < len(xs) else right_end
            x0 = int(round(x * img_w)) - pad
            x1 = int(round(x_next * img_w)) + pad
            ranges.append((max(0, x0), min(img_w, x1)))
        return ranges
    # Fallback: even-split of col_units
    col0 = int(round(COL_UNITS[0] * img_w))
    col1 = int(round(COL_UNITS[1] * img_w))
    width = (col1 - col0) / GO_UNIT_MAX_SLOTS
    return [
        (max(0, col0 + int(round(i * width)) - pad),
         min(img_w, col0 + int(round((i + 1) * width)) + pad))
        for i in range(GO_UNIT_MAX_SLOTS)
    ]


GO_UNIT_TEMPLATE_WEIGHT = 0.4   # combined = α·template + (1−α)·(1−color_dist)


def _detect_unit_level(img: np.ndarray, sx0: int, sx1: int,
                       icon_bot_y: int) -> int:
    """Count star-chip clusters below a Game Over unit icon.

    Reuses _find_star_clusters (the MM star detector). The chip strip sits
    just below the icon; we feed _find_star_clusters that strip and return
    the cluster count (== star level).
    """
    cy0 = icon_bot_y + 2
    cy1 = min(icon_bot_y + 18, img.shape[0])
    if cy1 - cy0 < 3 or sx1 - sx0 < 4:
        return 0
    strip = img[cy0:cy1, sx0:sx1]
    if strip.size == 0:
        return 0
    if len(strip.shape) < 3:
        strip = cv2.cvtColor(strip, cv2.COLOR_GRAY2BGR)
    clusters = _find_star_clusters(strip)
    return min(len(clusters), 3)


def _match_go_units_trace(img: np.ndarray, row_idx: int, icons_dir: Path
                          ) -> list[dict]:
    """Per-slot unit detection trace for one Game Over row.

    Every template gets scored on BOTH signals at once and ranked by a
    weighted combined score, so neither signal gates the other:

        combined = α · template_score + (1 − α) · (1 − color_dist)

    Template alone over-matches (Faceless Void), color alone is too coarse;
    combined breaks ties cleanly. Both signals get a small Gaussian blur so
    GO icon pixelation doesn't sink template correlation.

    Acceptance: the winning combined score must clear GO_UNIT_THRESHOLD.

    Trace entry shape:
      {"slot_idx", "sx0", "sx1", "zy0", "zy1",
       "stem", "template_score", "color_dist", "combined",
       "display_name", "accepted",
       "candidates": [(stem, template_score, color_dist, combined), ...]}
    """
    img_h, img_w = img.shape[:2]
    zy0, zy1 = _go_unit_y_band(img_h, row_idx)
    if zy1 - zy0 <= 0:
        return []
    templates, lookup = _ensure_go_unit_templates(icons_dir)
    sigs = _ensure_go_unit_color_sigs(icons_dir)
    α = GO_UNIT_TEMPLATE_WEIGHT

    trace: list[dict] = []
    for slot_idx, (sx0, sx1) in enumerate(_go_unit_slot_ranges(img_w)):
        if sx1 <= sx0:
            continue
        slot_img = img[zy0:zy1, sx0:sx1]
        if slot_img.size == 0:
            continue
        if len(slot_img.shape) < 3:
            slot_img = cv2.cvtColor(slot_img, cv2.COLOR_GRAY2BGR)

        target_sig = _compute_unit_color_sig(slot_img)
        # Score every template on both signals; rank by combined.
        all_template_scores = _go_unit_template_top_k(
            slot_img, templates, k=len(templates),
        )
        candidates: list[tuple[str, float, float, float]] = []
        best_stem, best_tscore, best_dist, best_combined = "", 0.0, 1.0, -1.0
        for stem, tscore in all_template_scores:
            sig = sigs.get(stem)
            if sig is None or target_sig is None:
                dist = 1.0
            else:
                dist = float(cv2.compareHist(sig, target_sig,
                                             cv2.HISTCMP_BHATTACHARYYA))
            combined = α * tscore + (1 - α) * (1 - dist)
            candidates.append((stem, tscore, dist, combined))
            if combined > best_combined:
                best_stem, best_tscore, best_dist = stem, tscore, dist
                best_combined = combined
        candidates.sort(key=lambda x: -x[3])
        accepted = bool(best_stem) and best_combined >= GO_UNIT_THRESHOLD
        level = _detect_unit_level(img, sx0, sx1, zy1) if accepted else 0

        trace.append({
            "slot_idx": slot_idx,
            "sx0": sx0, "sx1": sx1,
            "zy0": zy0, "zy1": zy1,
            "stem": best_stem,
            "template_score": best_tscore,
            "color_dist": best_dist,
            "combined": best_combined,
            "display_name": lookup.get(best_stem, best_stem) if best_stem else "",
            "accepted": accepted,
            "level": level,
            "candidates": candidates[:5],
        })
    return trace


def _match_go_units(img: np.ndarray, row_idx: int, icons_dir: Path,
                    debug: bool = False) -> list[str]:
    """Detect units in one Game Over row.

    Returns names in the MY MATCHES format: `"Name"` for 1-star, `"Name(N)"`
    when level ≥ 2. Reads the same trace the debugger renders, so the two
    cannot disagree.
    """
    trace = _match_go_units_trace(img, row_idx, icons_dir)
    names: list[str] = []
    for entry in trace:
        if entry["accepted"]:
            name = entry["display_name"]
            level = entry.get("level", 0)
            names.append(f"{name}({level})" if level >= 2 else name)
        if debug:
            log.debug(f"  [go units] row {row_idx} slot {entry['slot_idx']}: "
                      f"x=[{entry['sx0']},{entry['sx1']}] "
                      f"stem={entry['stem']!r} t={entry['template_score']:.3f} "
                      f"c={entry['color_dist']:.3f} lvl={entry.get('level',0)} "
                      f"accepted={entry['accepted']}")
    return names


def _parse_row_data(
    img: np.ndarray,
    row_idx: int,
    icons_dir: Path,
    syn_templates: dict[str, list[np.ndarray]] | None = None,
    relic_templates: dict[str, list[np.ndarray]] | None = None,
    debug: bool = False,
) -> dict:
    """Extract level, wl, synergies, relic, plus the new columns for one row."""
    y0, y1 = _row_y_extent(row_idx)

    # OCR level (multi-PSM fallback: bottom rows fail under PSM 7 alone)
    level_cell = _crop_row(img, COL_LEVEL, y0, y1)
    level = _ocr_level_multi_psm(level_cell)

    # OCR W-L
    wl_cell = _crop_row(img, COL_WL, y0, y1)
    wl_proc = _preprocess_for_ocr(wl_cell, scale=3.0)
    wl_raw = _ocr(wl_proc, psm=7, whitelist="0123456789-")
    wl_match = re.search(r"(\d{1,3})\s*[-–]\s*(\d{1,3})", wl_raw)
    wl = f"{wl_match.group(1)}-{wl_match.group(2)}" if wl_match else ""

    # Template match synergies
    if syn_templates is None:
        syn_templates = _load_templates_multiscale(icons_dir / "synergies", SYNERGY_ICON_SCALES)
    syn_cell = _crop_row(img, COL_SYNERGY, y0, y1)
    synergies = _parse_game_over_synergies(
        syn_cell, icons_dir, syn_templates=syn_templates, debug=debug)

    # Relic parsing is slot-based to avoid matching fragments in empty cells.
    relic_cell = _crop_row(img, COL_RELIC, y0, y1)
    relic = _parse_game_over_relics(
        relic_cell, relic_templates, icons_dir, debug=debug)

    placement = _ocr_go_placement(img, row_idx, debug=debug)
    gold = _ocr_go_gold(img, row_idx, debug=debug)
    damage = _ocr_go_damage(img, row_idx, debug=debug)
    duration = _ocr_go_duration(img, row_idx, debug=debug)
    units = _match_go_units(img, row_idx, icons_dir, debug=debug)

    return {
        "placement": placement or str(row_idx + 1),
        "level": level,
        "wl": wl,
        "synergies": synergies,
        "relic": relic,
        "gold": gold,
        "damage": damage,
        "duration": duration,
        "units": units,
    }


def parse_game_over_all(
    img: np.ndarray,
    icons_dir: Path,
    debug: bool = False,
) -> list[dict] | None:
    """Parse ALL 8 players from a GAME OVER table screenshot.

    Returns list of 8 dicts, each with keys:
        player_name, placement, level, wl, synergies, relic, rank
    or None on failure.
    """
    draft = parse_game_over_screenshot(img, icons_dir=icons_dir, debug=debug)
    return draft["rows"]


def parse_game_over_screenshot(
    img: np.ndarray,
    *,
    icons_dir: Path,
    user_avatar=None,
    current_user_name: str | None = None,
    debug: bool = False,
) -> dict:
    """Parse a Game Over screenshot into an editable draft plus trace data.

    This is the production Game Over parse surface. Import, Parser Lab, debug
    views, and fixtures should read this draft rather than reimplementing row
    parsing field-by-field.

    `current_user_name`, when supplied, is fuzzy-matched against each row's
    OCR'd player name; the highest-scoring row above
    `IDENTITY_MATCH_THRESHOLD` is flagged with `is_current_user_candidate`.
    `user_avatar` is reserved for the avatar-comparison leg of identity
    matching (PRD identity strategy step 1) and is currently ignored.
    """
    del user_avatar
    apply_calibration(img)
    h, w = img.shape[:2]
    log.info(f"[cv] parse_game_over_screenshot: {w}x{h}")

    # Pre-load templates once for all rows
    syn_templates = _load_templates_multiscale(icons_dir / "synergies", SYNERGY_ICON_SCALES)
    relic_templates = _load_templates_multiscale(
        icons_dir / "relics",
        GO_RELIC_ICON_SCALES,
        inner_frac=GO_RELIC_INNER_FRAC,
        color=True,
    )

    rows = []
    title_crop = _crop(img, *TITLE_REGION)
    title_proc = _preprocess_for_ocr(title_crop, scale=2.0, invert=True)
    title_label = _ocr(title_proc, psm=7, whitelist="GAMEOVERgameover ").strip()
    trace = [
        _trace_region(
            "title",
            "ocr",
            "title",
            TITLE_REGION,
            label=title_label,
            crop=title_crop,
        )
    ]
    warnings = []

    for i in range(N_ROWS):
        player_name = _ocr_player_name(img, i, debug=debug)
        rank = _ocr_player_rank(img, i, debug=debug)
        row_data = _parse_row_data(img, i, icons_dir,
                                    syn_templates=syn_templates,
                                    relic_templates=relic_templates,
                                    debug=debug)
        bboxes = _game_over_row_bboxes(i)
        row_data["player_name"] = player_name
        row_data["player_name_raw"] = player_name
        row_data["player_label"] = f"Player {i + 1}"
        row_data["rank"] = rank
        row_data["row_index"] = i
        # Populated by the avatar-comparison leg of identity matching once
        # that slice lands; until then it stays None and the fuzzy-name score
        # below is the only identity signal.
        row_data["avatar_match_score"] = None
        row_data["identity_match_score"] = (
            round(name_match_score(player_name, current_user_name), 3)
            if current_user_name
            else None
        )
        row_data["identity_match_source"] = "name" if current_user_name else None
        # Set provisionally to False; the best-scoring row is promoted below.
        row_data["is_current_user_candidate"] = False
        row_data["confidence"] = _row_confidence(row_data)
        rows.append(row_data)

        trace.extend([
            _trace_region(
                f"row{i}",
                "band",
                "go_row",
                bboxes["row"],
                f"Player {i + 1}",
                i,
                _crop(img, *bboxes["row"]),
            ),
            _trace_region(
                f"row{i}.player",
                "ocr",
                "go_player_name",
                bboxes["player"],
                player_name,
                i,
                _crop(img, *bboxes["player"]),
            ),
            _trace_region(
                f"row{i}.rank",
                "ocr",
                "go_player_rank",
                bboxes["rank"],
                rank,
                i,
                _crop(img, *bboxes["rank"]),
            ),
            _trace_region(
                f"row{i}.level",
                "ocr",
                "go_level",
                bboxes["level"],
                row_data.get("level", ""),
                i,
                _crop(img, *bboxes["level"]),
            ),
            _trace_region(
                f"row{i}.synergies",
                "template",
                "go_synergies",
                bboxes["synergies"],
                row_data.get("synergies", ""),
                i,
                _crop(img, *bboxes["synergies"]),
            ),
            _trace_region(
                f"row{i}.relic",
                "template",
                "go_relics",
                bboxes["relic"],
                row_data.get("relic", ""),
                i,
                _crop(img, *bboxes["relic"]),
            ),
            _trace_region(
                f"row{i}.wl",
                "ocr",
                "go_wl",
                bboxes["wl"],
                row_data.get("wl", ""),
                i,
                _crop(img, *bboxes["wl"]),
            ),
            _trace_region(
                f"row{i}.placement",
                "ocr",
                "go_placement",
                bboxes["placement"],
                row_data.get("placement", ""),
                i,
                _crop(img, *bboxes["placement"]),
            ),
            _trace_region(
                f"row{i}.avatar",
                "template",
                "go_avatar",
                bboxes["avatar"],
                "",
                i,
                _crop(img, *bboxes["avatar"]),
            ),
            _trace_region(
                f"row{i}.talent",
                "template",
                "go_talent",
                bboxes["talent"],
                "",
                i,
                _crop(img, *bboxes["talent"]),
            ),
            _trace_region(
                f"row{i}.units",
                "grid",
                "go_units",
                bboxes["units"],
                ", ".join(row_data.get("units") or []),
                i,
                _crop(img, *bboxes["units"]),
            ),
            _trace_region(
                f"row{i}.gold",
                "ocr",
                "go_gold",
                bboxes["gold"],
                row_data.get("gold", ""),
                i,
                _crop(img, *bboxes["gold"]),
            ),
            _trace_region(
                f"row{i}.damage",
                "ocr",
                "go_damage",
                bboxes["damage"],
                row_data.get("damage", ""),
                i,
                _crop(img, *bboxes["damage"]),
            ),
            _trace_region(
                f"row{i}.duration",
                "ocr",
                "go_duration",
                bboxes["duration"],
                row_data.get("duration", ""),
                i,
                _crop(img, *bboxes["duration"]),
            ),
        ])

        if not player_name:
            warnings.append(f"row {i + 1}: player name OCR was empty")
        if not row_data.get("level"):
            warnings.append(f"row {i + 1}: level OCR was empty")
        if not row_data.get("wl"):
            warnings.append(f"row {i + 1}: W-L OCR was empty")

        log.info(f"[cv] Row {i+1}: name={player_name!r} place={row_data['placement']} "
                 f"level={row_data['level']} wl={row_data['wl']} rank={row_data['rank']}")

    if current_user_name:
        scored = [
            (row, row.get("identity_match_score") or 0.0)
            for row in rows
        ]
        best_row, best_score = max(scored, key=lambda item: item[1])
        if best_score >= IDENTITY_MATCH_THRESHOLD:
            best_row["is_current_user_candidate"] = True
            log.info(
                "[cv] identity hint: row %s flagged as current user "
                "(score=%.3f, threshold=%.2f, name=%r vs %r)",
                best_row["row_index"] + 1,
                best_score,
                IDENTITY_MATCH_THRESHOLD,
                best_row.get("player_name"),
                current_user_name,
            )
        else:
            warnings.append(
                f"no row name matched current user {current_user_name!r} above "
                f"threshold {IDENTITY_MATCH_THRESHOLD:.2f} (best={best_score:.2f})"
            )

    return {
        "screen_type": "game_over",
        "screenshot_width": w,
        "screenshot_height": h,
        "rows": rows,
        "warnings": warnings,
        "trace": trace,
    }


# ── MY MATCHES parser ────────────────────────────────────────────────────────

def _find_my_matches_rows(img: np.ndarray, debug: bool = False) -> list[tuple[float, float]]:
    """Find row y-spans by scanning for dark separator bands, then extrapolating.

    The bottom rows often blend into the dark background, so we detect the
    row height from the first few separators and extrapolate to fill the table.
    Returns list of (y0, y1) fractions.
    """
    if MM_ROW_DIVIDERS is not None and len(MM_ROW_DIVIDERS) >= 2:
        return [(MM_ROW_DIVIDERS[i], MM_ROW_DIVIDERS[i + 1])
                for i in range(len(MM_ROW_DIVIDERS) - 1)]

    h, w = img.shape[:2]
    x0_px = int(w * MM_SEP_SCAN_X[0])
    x1_px = int(w * MM_SEP_SCAN_X[1])
    y0_px = int(h * MM_TABLE_Y_START)
    y1_px = int(h * MM_TABLE_Y_END)

    strip = img[y0_px:y1_px, x0_px:x1_px]
    gray = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY) if len(strip.shape) == 3 else strip
    row_means = gray.mean(axis=1)  # mean brightness per scan-line

    # Find contiguous dark bands, then merge nearby ones into separator zones.
    # Separator zones in the table often have brief bright-ish gaps (1-2px)
    # that would fragment them into multiple tiny bands, so we merge bands
    # whose gap is smaller than merge_gap.
    in_dark = False
    band_start = 0
    raw_bands: list[tuple[int, int]] = []  # (start, end) in strip coords
    for i, val in enumerate(row_means):
        if val < MM_SEP_DARK_THRESH and not in_dark:
            in_dark = True
            band_start = i
        elif val >= MM_SEP_DARK_THRESH and in_dark:
            in_dark = False
            if i - band_start >= 2:
                raw_bands.append((band_start, i))

    # Merge bands separated by small gaps
    merge_gap = 15
    merged_bands: list[tuple[int, int]] = []
    for b_start, b_end in raw_bands:
        if merged_bands and b_start - merged_bands[-1][1] <= merge_gap:
            merged_bands[-1] = (merged_bands[-1][0], b_end)
        else:
            merged_bands.append((b_start, b_end))

    # Convert to absolute pixel coords
    sep_zones = [(s + y0_px, e + y0_px) for s, e in merged_bands]

    log.debug(f"  [mm rows] found {len(sep_zones)} separators: {[(s, e, e-s) for s, e in sep_zones]}")
    rows: list[tuple[float, float]] = []
    if len(sep_zones) >= 3:
        # Compute median row height from separator-to-separator distances
        sep_centers = [(s + e) // 2 for s, e in sep_zones]
        gaps = [sep_centers[i + 1] - sep_centers[i]
                for i in range(len(sep_centers) - 1)
                if sep_centers[i + 1] - sep_centers[i] > h * 0.02]
        row_h_px = int(np.median(gaps)) if gaps else int(h * 0.075)

        # Build rows using separator band edges (not centers + inset).
        # Row starts at the end of one separator, ends at the start of the next.
        # False separators sometimes split a real row, producing short fragments.
        # Merge adjacent short fragments when their combined height is close to
        # the expected row height (within 40%). Drop remaining short fragments.
        min_row_h = row_h_px * 0.6 / h
        max_merged_h = row_h_px * 1.4 / h
        raw_rows: list[tuple[float, float]] = []
        for i in range(len(sep_zones) - 1):
            r_y0 = sep_zones[i][1] / h
            r_y1 = sep_zones[i + 1][0] / h
            if r_y1 - r_y0 > 0.01:
                raw_rows.append((r_y0, r_y1))

        # Merge consecutive short fragments when combined height is reasonable,
        # then drop any remaining short fragments.
        pending_short = None  # buffered short fragment awaiting merge
        for r_y0, r_y1 in raw_rows:
            cur_h = r_y1 - r_y0
            if cur_h < min_row_h:
                if pending_short is not None:
                    # Try merging with buffered short
                    combined = r_y1 - pending_short[0]
                    if combined <= max_merged_h:
                        rows.append((pending_short[0], r_y1))
                        pending_short = None
                        continue
                # Buffer this short fragment
                pending_short = (r_y0, r_y1)
            else:
                pending_short = None
                rows.append((r_y0, r_y1))

        # Extrapolate beyond last detected separator using median row height.
        # Allow partial rows (at least 50% of row height remaining).
        # Cap at 7 rows — MY MATCHES shows 7 opponents max.
        last_sep = sep_zones[-1][1]  # end of last separator band
        while len(rows) < 7 and last_sep + row_h_px * 0.5 < h:
            r_y0 = last_sep / h
            r_y1 = min((last_sep + row_h_px) / h, 1.0)
            rows.append((r_y0, r_y1))
            last_sep += row_h_px

        log.debug(f"  [mm rows] row height={row_h_px}px, extrapolated to {len(rows)} total rows")

        # Normalize all rows to uniform height from their top edge
        uniform_h = row_h_px / h
        rows = [(y0, min(y0 + uniform_h, 1.0)) for y0, _ in rows]

    # Fallback: fixed geometry (assume 8 rows of equal height)
    if len(rows) < 3:
        log.debug("  [mm rows] scan failed, using fixed 8-row geometry")
        row_h = (MM_TABLE_Y_END - MM_TABLE_Y_START) / 8
        rows = [(MM_TABLE_Y_START + i * row_h,
                 MM_TABLE_Y_START + (i + 1) * row_h) for i in range(8)]

    return rows


def _load_synergy_tiers() -> dict[str, list[int]]:
    """Load synergy name → tier thresholds from data/synergies.json."""
    from utils import DATA_DIR
    syn_path = DATA_DIR / "synergies.json"
    if not syn_path.exists():
        return {}
    import json
    raw = json.loads(syn_path.read_text(encoding="utf-8"))
    return {v["name"]: sorted(v["tiers"]) for v in raw.values() if v.get("tiers")}


_SYNERGY_TIERS: dict[str, list[int]] | None = None


def _get_synergy_tiers() -> dict[str, list[int]]:
    global _SYNERGY_TIERS
    if _SYNERGY_TIERS is None:
        _SYNERGY_TIERS = _load_synergy_tiers()
    return _SYNERGY_TIERS


def _snap_to_tier(count: int, tiers: list[int]) -> int | None:
    """Snap a raw unit count down to the highest active tier threshold.

    Returns None if count doesn't reach the lowest tier.
    """
    active = None
    for t in tiers:
        if count >= t:
            active = t
        else:
            break
    return active


def _synergies_from_units(unit_names: list[str], units_data: dict) -> str:
    """Count synergies and snap to active tier thresholds.

    Returns 'Warlock:4|Demon Hunter:2|...' sorted by tier descending.
    Only includes synergies that reach at least their lowest tier.
    """
    from collections import Counter
    # Build lookup: snake_case template name -> units_data entry
    # units_data keys are display names ("Sand King"), template names are snake_case ("sand_king")
    _lookup: dict[str, dict] = {}
    for display_name, data in units_data.items():
        snake = display_name.lower().replace(" ", "_").replace("-", "_")
        _lookup[snake] = data
        _lookup[display_name] = data
    counts: Counter = Counter()
    for name in unit_names:
        unit = _lookup.get(name) or _lookup.get(name.lower().replace(" ", "_").replace("-", "_"))
        if unit:
            for syn in unit.get("synergies", []):
                counts[syn] += 1
    tiers = _get_synergy_tiers()
    pairs = []
    for syn_name, raw_count in counts.items():
        tier_list = tiers.get(syn_name)
        if tier_list:
            active = _snap_to_tier(raw_count, tier_list)
            if active is not None:
                pairs.append((syn_name, active))
        else:
            # No tier data — include raw count if >= 1
            if raw_count >= 1:
                pairs.append((syn_name, raw_count))
    pairs.sort(key=lambda x: -x[1])
    return "|".join(f"{s}:{c}" for s, c in pairs)


STAR_SQUARE_SIZE = 9      # star indicator squares are 9x9 px
STAR_SQUARE_MIN_AREA = 55  # minimum contour area (perfect 8x8 fill = 64)
STAR_SQUARE_MAX_GAP = 15   # max x-gap between squares of the same unit
STAR_UX_OFFSET = 20        # star squares are ~20px right of grid slot origin


def _find_star_clusters(
    unit_region: np.ndarray,
    debug: bool = False,
) -> list[list[tuple[int, int]]]:
    """Find colored star-indicator squares and cluster by x-proximity.

    Scans the unit region for bright saturated 9x9 blobs, then groups
    them into clusters where squares within 15px x-distance belong to
    the same unit. Returns list of clusters, each a list of (x, y) centers.
    """
    if len(unit_region.shape) < 3:
        return []
    hsv = cv2.cvtColor(unit_region, cv2.COLOR_BGR2HSV)
    s_ch, v_ch = hsv[:, :, 1], hsv[:, :, 2]
    # Detect both colored (high saturation) and white (low saturation, high value)
    # star squares — use V > 150 which catches both types
    mask = (v_ch > 150).astype(np.uint8) * 255
    # Morphological opening removes stray pixels that merge separate squares
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Filter to ~9x9 squares
    squares: list[tuple[int, int]] = []  # (cx, cy) centers
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = cv2.contourArea(c)
        if (STAR_SQUARE_SIZE - 2 <= w <= STAR_SQUARE_SIZE + 2
                and STAR_SQUARE_SIZE - 2 <= h <= STAR_SQUARE_SIZE + 2
                and area >= STAR_SQUARE_MIN_AREA):
            squares.append((x + w // 2, y + h // 2))

    if not squares:
        return []

    # Cluster by proximity in both x and y
    # Sort by y then x, group into y-bands first, then cluster within by x
    squares.sort(key=lambda s: (s[1], s[0]))
    # Group into y-bands (squares within 5px vertically = same band)
    y_bands: list[list[tuple[int, int]]] = [[squares[0]]]
    for sq in squares[1:]:
        if abs(sq[1] - y_bands[-1][-1][1]) <= 5:
            y_bands[-1].append(sq)
        else:
            y_bands.append([sq])

    # Within each y-band, cluster by x-gap
    clusters: list[list[tuple[int, int]]] = []
    for band in y_bands:
        band.sort(key=lambda s: s[0])
        cluster = [band[0]]
        for sq in band[1:]:
            if sq[0] - cluster[-1][0] <= STAR_SQUARE_MAX_GAP:
                cluster.append(sq)
            else:
                clusters.append(cluster)
                cluster = [sq]
        clusters.append(cluster)

    log.debug(f"    star squares: {len(squares)} found, {len(clusters)} clusters "
              f"({[len(c) for c in clusters]})")
    return clusters


def _assign_stars(
    matches: list[tuple[str, float, int, int]],
    clusters: list[list[tuple[int, int]]],
) -> dict[int, int]:
    """Assign each star cluster to its nearest unit (exclusively).

    Each cluster is assigned to the closest unit (by x) that is above
    the cluster. Returns {match_index: star_count}.
    """
    result: dict[int, int] = {}
    if not clusters or not matches:
        return result
    # For each cluster, find the closest unit above it
    for cluster in clusters:
        cx = sum(x for x, _ in cluster) / len(cluster)
        cy = sum(y for _, y in cluster) / len(cluster)
        count = len(cluster)
        if count > 3:
            continue  # noise
        best_idx = -1
        best_xdist = float("inf")
        best_ydist = float("inf")
        for mi, (_, _, ux, uy) in enumerate(matches):
            if cy < uy - 10:
                continue  # cluster must be near/below the unit (10px tolerance)
            xdist = abs(cx - (ux + STAR_UX_OFFSET))
            ydist = cy - uy  # positive = cluster below unit (normal case)
            above = ydist >= 0
            prev_above = best_ydist >= 0 if best_idx >= 0 else False
            # Prefer closest by x; break ties: above > tolerance, then
            # closest above (smallest positive ydist)
            better = False
            if xdist < best_xdist:
                better = True
            elif xdist == best_xdist:
                if above and not prev_above:
                    better = True
                elif above == prev_above:
                    if above:
                        better = ydist < best_ydist
                    else:
                        better = ydist > best_ydist
            if better:
                best_xdist = xdist
                best_ydist = ydist
                best_idx = mi
        if best_idx >= 0:
            # Only assign if this cluster has more stars than any previous
            if count > result.get(best_idx, 0):
                result[best_idx] = count
    return result


def _match_syn_slot(img: np.ndarray, col_x: float, icon_y: float,
                    syn_templates: dict[str, list[np.ndarray]]) -> tuple[str, float] | None:
    """Template-match a single synergy grid slot. Returns (name, score) or None."""
    h, w = img.shape[:2]
    x0 = max(int(col_x * w) - 2, 0)
    y0 = max(int(icon_y * h) - 2, 0)
    x1 = min(int((col_x + MM_SYN_ICON_W) * w) + 2, w)
    y1 = min(int((icon_y + MM_SYN_ICON_H) * h) + 2, h)
    crop = img[y0:y1, x0:x1]
    if crop.size == 0 or crop.mean() < MM_SYN_BRIGHT_THRESH:
        return None
    crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
    best_name, best_score = "", 0.0
    for name, tmpls in syn_templates.items():
        for tmpl in tmpls:
            th, tw = tmpl.shape[:2]
            if crop_gray.shape[0] < th or crop_gray.shape[1] < tw:
                continue
            result = cv2.matchTemplate(crop_gray, tmpl, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, _ = cv2.minMaxLoc(result)
            if max_val > best_score:
                best_score = max_val
                best_name = name
    if best_score < 0.60:
        return None
    return best_name, best_score


def _ocr_mm_syn_counts(img: np.ndarray, row_y0: float, row_y1: float,
                       n_icons: int, two_row: bool = False,
                       debug: bool = False, row_idx: int = 0) -> list[int]:
    """OCR the count numbers below single-row synergy icons.

    Reads "(N)" tokens from a strip below the icons and returns counts
    matched left-to-right with the icon columns.
    """
    h, w = img.shape[:2]
    row_h = row_y1 - row_y0
    # Count text position depends on 1-row vs 2-row layout.
    if two_row:
        # Counts for top-row icons sit between the two icon rows
        count_y0 = int((row_y0 + row_h * MM_SYN_COUNT_Y_2ROW_BOT[0]) * h)
        count_y1 = int((row_y0 + row_h * MM_SYN_COUNT_Y_2ROW_BOT[1]) * h)
    else:
        # Counts sit below the single row of icons
        count_y0 = int((row_y0 + row_h * MM_SYN_COUNT_Y_1ROW[0]) * h)
        count_y1 = int((row_y0 + row_h * MM_SYN_COUNT_Y_1ROW[1]) * h)
    # x spans from first icon to last icon
    count_x0 = int(MM_SYN_COLS_X[0] * w)
    count_x1 = int((MM_SYN_COLS_X[-1] + MM_SYN_ICON_W) * w)
    strip = img[count_y0:count_y1, count_x0:count_x1]
    if strip.size == 0:
        return []
    _save_debug(f"mm_syn_count_{row_idx}", strip, debug)
    gray = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY) if len(strip.shape) == 3 else strip
    _, bw = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY)
    inv = cv2.bitwise_not(bw)
    scale = 4
    scaled = cv2.resize(inv, (inv.shape[1] * scale, inv.shape[0] * scale),
                        interpolation=cv2.INTER_NEAREST)
    scaled = cv2.copyMakeBorder(scaled, 20, 20, 20, 20,
                                cv2.BORDER_CONSTANT, value=255)
    _save_debug(f"mm_syn_count_proc_{row_idx}", scaled, debug)
    raw = _ocr(scaled, psm=12)
    log.debug(f"  [row {row_idx}] syn count OCR raw: {raw!r}")
    # Extract digits from "(N)" patterns
    all_counts = re.findall(r"\d+", raw)
    counts = [int(d) for d in all_counts if 1 <= int(d) <= 12]
    return counts


def _infer_syn_count(name: str, syn_tiers: dict[str, list[int]]) -> int:
    """Infer synergy count for bottom-row icons (lowest count synergies).

    Returns the lowest tier threshold for this synergy, since bottom-row
    synergies are in decreasing order and have the fewest units.
    """
    tiers = syn_tiers.get(name, [])
    return tiers[0] if tiers else 1


def _load_syn_tiers() -> dict[str, list[int]]:
    """Load synergy tier thresholds keyed by icon template stem."""
    import json as _json
    from utils import DATA_DIR as data_dir
    syn_path = data_dir / "synergies.json"
    if not syn_path.exists():
        return {}
    data = _json.loads(syn_path.read_text(encoding="utf-8"))
    # Map JSON key (e.g. "is_aqir") to icon stem (e.g. "aqir")
    stem_map = {
        "demon hunter": "demonhunter",
        "elemental": "element",
        "faceless": "nraqi",
        "pandaren": "pandaman",
    }
    result = {}
    for v in data.values():
        name = v["name"].lower()
        stem = stem_map.get(name, name.replace(" ", ""))
        result[stem] = v.get("tiers", [])
    return result


def _parse_mm_synergies(
    img: np.ndarray,
    row_y0: float,
    row_y1: float,
    syn_templates: dict[str, list[np.ndarray]],
    icons_dir: Path,
    debug: bool = False,
    row_idx: int = 0,
) -> str:
    """Parse synergy icons + counts from a MY MATCHES row using grid detection.

    Checks 5 fixed column positions at 1 or 2 y-bands. OCRs counts for the
    top row; infers counts for the bottom row from synergy tier data.
    Returns formatted "Synergy:count|Synergy:count" string, or "" on failure.
    """
    if not syn_templates:
        return ""

    _save_debug(f"mm_syn_{row_idx}",
                _crop_row(img, MM_COL_SYNERGY, row_y0, row_y1), debug)

    row_h = row_y1 - row_y0

    # Detect 2-row mode: check column 0 at the bottom y-band with a high
    # confidence threshold (real icons match at 0.85+, noise at ~0.53).
    bot_y = row_y0 + row_h * MM_SYN_Y_2ROW_BOT
    bot_probe = _match_syn_slot(img, MM_SYN_COLS_X[0], bot_y, syn_templates)
    has_bottom = bot_probe is not None and bot_probe[1] >= 0.80

    two_row = has_bottom
    top_y = row_y0 + row_h * (MM_SYN_Y_2ROW_TOP if two_row else MM_SYN_Y_1ROW)

    # Match top row (up to 5 icons)
    top_matches: list[tuple[str, float]] = []
    for col_x in MM_SYN_COLS_X:
        m = _match_syn_slot(img, col_x, top_y, syn_templates)
        if m is not None:
            top_matches.append(m)
        else:
            break  # no more icons in this row

    # Match bottom row if 2-row mode
    bot_matches: list[tuple[str, float]] = []
    if two_row:
        for col_x in MM_SYN_COLS_X:
            m = _match_syn_slot(img, col_x, bot_y, syn_templates)
            if m is not None:
                bot_matches.append(m)
            else:
                break

    if not top_matches and not bot_matches:
        return ""

    log.debug(f"  [row {row_idx}] syn grid: {len(top_matches)} top"
              f" + {len(bot_matches)} bottom ({'2-row' if two_row else '1-row'})")

    # OCR counts for top row
    top_counts = _ocr_mm_syn_counts(img, row_y0, row_y1,
                                    len(top_matches), two_row=two_row,
                                    debug=debug, row_idx=row_idx)
    log.debug(f"  [row {row_idx}] syn top counts: {top_counts}")

    # Build results for top row; infer missing counts from tier data
    syn_tiers = _load_syn_tiers()
    results: list[tuple[str, int]] = []
    for i, (name, score) in enumerate(top_matches):
        count = top_counts[i] if i < len(top_counts) else 0
        if count == 0:
            # OCR failed — infer from tier data (lowest tier since order is decreasing)
            count = _infer_syn_count(name, syn_tiers)
        log.debug(f"    top[{i}] {name} score={score:.3f} count={count}")
        results.append((name, count))

    # Infer counts for bottom row
    if bot_matches:
        for i, (name, score) in enumerate(bot_matches):
            inferred = _infer_syn_count(name, syn_tiers)
            log.debug(f"    bot[{i}] {name} score={score:.3f} inferred={inferred}")
            results.append((name, inferred))

    synergies = "|".join(f"{name}:{count}" for name, count in results)
    log.debug(f"  [row {row_idx}] mm_synergies parsed: {synergies!r}")
    return synergies


# ── Time-ago helpers ──────────────────────────────────────────────────────────

def _normalise_time_ago(raw: str) -> str:
    """Clean up OCR noise in a relative-time string.

    Accepts strings like "3hrs ago", "2 days ago", "5h", "1d", "just now",
    "1 min", "45m" — returns a canonical lowercase form or "" if unrecognised.
    """
    import re as _re
    s = raw.strip().lower()
    # Strip stray punctuation that OCR introduces
    s = _re.sub(r"[^a-z0-9 ]", " ", s)
    s = _re.sub(r"\s+", " ", s).strip()
    # Patterns in order of specificity
    patterns = [
        # "just now" / "now"
        (_re.compile(r"\bjust\s*now\b|\bnow\b"), lambda m: "0m ago"),
        # "X min(s) ago" / "Xm ago"
        (_re.compile(r"(\d+)\s*m(?:in(?:s|ute)?s?)?\s*ago"), lambda m: f"{m.group(1)}m ago"),
        (_re.compile(r"(\d+)\s*m\b"), lambda m: f"{m.group(1)}m ago"),
        # "X hr(s) ago" / "Xh ago" / "X hours ago"
        (_re.compile(r"(\d+)\s*h(?:r(?:s)?|our(?:s)?)?\s*ago"), lambda m: f"{m.group(1)}h ago"),
        (_re.compile(r"(\d+)\s*h\b"), lambda m: f"{m.group(1)}h ago"),
        # "X day(s) ago" / "Xd ago" / "yesterday"
        (_re.compile(r"\byesterday\b"), lambda m: "1d ago"),
        (_re.compile(r"(\d+)\s*d(?:ay(?:s)?)?\s*ago"), lambda m: f"{m.group(1)}d ago"),
        (_re.compile(r"(\d+)\s*d\b"), lambda m: f"{m.group(1)}d ago"),
        # "X week(s) ago"
        (_re.compile(r"(\d+)\s*w(?:eek(?:s)?)?\s*ago"), lambda m: f"{int(m.group(1))*7}d ago"),
    ]
    for pat, fmt in patterns:
        m = pat.search(s)
        if m:
            try:
                return fmt(m)
            except Exception:
                pass
    return ""


def parse_time_ago(s: str) -> tuple[str, int]:
    """Parse a normalised time-ago string into (unit, value).

    Returns:
        ("minutes", N), ("hours", N), ("days", N), or ("unknown", 0)
    """
    import re as _re
    if not s:
        return ("unknown", 0)
    m = _re.match(r"(\d+)([mhd]) ago", s)
    if not m:
        return ("unknown", 0)
    val = int(m.group(1))
    unit_char = m.group(2)
    return {"m": "minutes", "h": "hours", "d": "days"}[unit_char], val


def infer_timestamps(rows: list[dict], screenshot_time) -> list[str]:
    """Infer an ISO datetime string for each MY MATCHES row.

    Algorithm:
    - Rows with a minute/hour-resolution time_ago (e.g. "3h ago") → subtract
      directly from screenshot_time.
    - Rows with a day-resolution time_ago (e.g. "3d ago") or unknown → use
      screenshot_time - N days as the base, then subtract 1 hr per position
      within the same-day group.  MY MATCHES shows the most recent game at the
      top (row 0), so row 0 of a group gets the base time and each subsequent
      row is 1 hr older.  A descending sort by played_at then reproduces the
      screenshot order (newest first).

    Args:
        rows: list of row dicts from parse_my_matches (each may have "time_ago")
        screenshot_time: datetime when the screenshot was taken

    Returns:
        list of ISO-8601 datetime strings, one per row (same length as rows).
    """
    from datetime import datetime as _dt, timedelta, date as _date

    if not isinstance(screenshot_time, _dt):
        screenshot_time = _dt.now()

    # First pass: resolve each row to (target_date, high_res_dt_or_None, base_dt_for_day)
    resolved: list[tuple[_date, _dt | None, _dt | None]] = []
    for row in rows:
        unit, val = parse_time_ago(row.get("time_ago", ""))
        if unit == "minutes":
            dt = screenshot_time - timedelta(minutes=val)
            resolved.append((dt.date(), dt, None))
        elif unit == "hours":
            dt = screenshot_time - timedelta(hours=val)
            resolved.append((dt.date(), dt, None))
        elif unit == "days":
            base_dt = screenshot_time - timedelta(days=val)
            resolved.append((base_dt.date(), None, base_dt))
        else:
            # Unknown — fall back to screenshot time as base
            resolved.append((screenshot_time.date(), None, screenshot_time))

    # Second pass: for day-only rows, each successive row in the same group is
    # 1 hr older than the previous (row 0 of a group = newest = base_dt).
    day_counters: dict[_date, int] = {}
    result: list[str] = []
    for target_date, high_res_dt, base_dt in resolved:
        if high_res_dt is not None:
            result.append(high_res_dt.strftime("%Y-%m-%d %H:%M:%S"))
        else:
            n = day_counters.get(target_date, 0)
            day_counters[target_date] = n + 1
            dt = base_dt - timedelta(hours=n)
            result.append(dt.strftime("%Y-%m-%d %H:%M:%S"))

    return result


def _parse_my_matches_row(
    img: np.ndarray,
    row_y0: float,
    row_y1: float,
    unit_templates: dict[str, list[np.ndarray]],
    relic_templates: dict[str, list[np.ndarray]],
    syn_templates: dict[str, list[np.ndarray]],
    icons_dir: Path,
    units_data: dict,
    stem_to_name: dict[str, str],
    debug: bool = False,
    row_idx: int = 0,
) -> dict:
    """Parse a single MY MATCHES row. Returns a dict of fields."""
    result: dict = {
        "placement": "",
        "level": "",
        "units": [],
        "synergies": "",
        "relic": "",
        "wl": "",
        "rank": "",
        "rank_change": "none",
        "time_ago": "",
    }

    # Save full row strip for debug
    _save_debug(f"mm_row_{row_idx}", _crop(img, 0.0, row_y0, 1.0, row_y1), debug)

    # 1. Placement OCR — isolate the big yellow digit via HSV color mask
    place_cell = _crop(img, MM_COL_PLACEMENT[0], row_y0 + (row_y1 - row_y0) * MM_PLACEMENT_Y_IN_ROW[0],
                       MM_COL_PLACEMENT[1], row_y0 + (row_y1 - row_y0) * MM_PLACEMENT_Y_IN_ROW[1])
    hsv_place = cv2.cvtColor(place_cell, cv2.COLOR_BGR2HSV)
    yellow_mask = cv2.inRange(hsv_place, (15, 80, 150), (40, 255, 255))
    yellow_mask = cv2.dilate(yellow_mask, np.ones((2, 2), np.uint8), iterations=1)
    place_proc = cv2.bitwise_not(yellow_mask)
    place_proc = cv2.resize(place_proc,
                            (place_proc.shape[1] * 4, place_proc.shape[0] * 4),
                            interpolation=cv2.INTER_NEAREST)
    place_proc = cv2.copyMakeBorder(place_proc, 20, 20, 20, 20,
                                    cv2.BORDER_CONSTANT, value=255)
    _save_debug(f"mm_place_{row_idx}", place_proc, debug)
    # Try multiple psm modes — single-char (13) works best, fallback through others
    place_raw = ""
    for _psm in [13, 8, 6, 7]:
        raw = _ocr(place_proc, psm=_psm, whitelist="12345678").strip()
        digits = [c for c in raw if c in "12345678"]
        if digits:
            result["placement"] = digits[0]
            place_raw = raw
            break
    log.debug(f"  [row {row_idx}] placement OCR: {place_raw!r} → {result['placement']!r}")
    if debug:
        result.setdefault("_debug", {})["place_raw"] = place_raw
        result["_debug"]["place_cell"] = place_cell
        result["_debug"]["place_proc"] = place_proc
    # 2. Level OCR — "LvXX" or just the digit
    level_cell = _crop(img, MM_COL_LEVEL[0], row_y0 + (row_y1 - row_y0) * MM_LEVEL_Y_IN_ROW[0],
                       MM_COL_LEVEL[1], row_y0 + (row_y1 - row_y0) * MM_LEVEL_Y_IN_ROW[1])
    level_proc = _preprocess_for_ocr(level_cell, scale=3.0)
    _save_debug(f"mm_level_{row_idx}", level_proc, debug)
    level_raw = _ocr(level_proc, psm=7, whitelist="0123456789Lv")
    level_digits = re.findall(r"\d+", level_raw)
    if level_digits:
        lv = int(level_digits[0])
        if 1 <= lv <= 15:
            result["level"] = str(lv)
    log.debug(f"  [row {row_idx}] level OCR: {level_raw!r} → {result['level']!r}")
    if debug:
        result["_debug"]["level_raw"] = level_raw
        result["_debug"]["level_cell"] = level_cell
        result["_debug"]["level_proc"] = level_proc
    # 3. Unit icon matching — grid-based (one match per slot)
    unit_region = _crop(img, MM_COL_UNITS[0], row_y0,
                        MM_COL_UNITS[1], row_y1)
    _save_debug(f"mm_units_{row_idx}", unit_region, debug)
    matches = _match_unit_grid(
        unit_region, unit_templates,
        threshold=UNIT_MATCH_THRESHOLD,
        debug=debug,
    )
    unit_names_raw = [stem_to_name.get(stem, stem) for stem, _, _, _ in matches]

    # Detect star levels by finding colored 9x9 squares in the unit region
    star_clusters = _find_star_clusters(unit_region, debug=debug)
    star_map = _assign_stars(matches, star_clusters)
    unit_names = []
    for i, (stem, score, ux, uy) in enumerate(matches):
        name = stem_to_name.get(stem, stem)
        stars = star_map.get(i, 1)
        log.debug(f"    star detect {name}: {stars}★ (ux={ux})")
        unit_names.append(f"{name}({stars})" if stars > 1 else name)

    result["units"] = unit_names
    log.debug(f"  [row {row_idx}] units ({len(unit_names)}): {unit_names}")
    if debug:
        result["_debug"]["unit_matches"] = [(stem_to_name.get(s, s), round(sc, 3), ux, uy)
                                             for s, sc, ux, uy in matches]
        result["_debug"]["unit_region"] = unit_region
    # 4. Synergies — try direct icon parsing first, fall back to unit derivation
    parsed_syn = _parse_mm_synergies(img, row_y0, row_y1, syn_templates, icons_dir,
                                     debug=debug, row_idx=row_idx)
    if parsed_syn:
        result["synergies"] = parsed_syn
    elif unit_names_raw and units_data:
        # Fallback: derive from unit lineup
        result["synergies"] = _synergies_from_units(unit_names_raw, units_data)
    log.debug(f"  [row {row_idx}] synergies: {result['synergies']!r}")
    # 5. Relic icon matching (per-slot grid)
    relic_cell = _crop(img, MM_COL_RELIC[0], row_y0, MM_COL_RELIC[1], row_y1)
    _save_debug(f"mm_relic_{row_idx}", relic_cell, debug)
    if relic_templates:
        relic_matches = _match_relic_grid(
            relic_cell, relic_templates, threshold=0.55, debug=debug,
        )
        result["relic"] = "|".join(
            name.replace("_", " ").title() for name, _, _, _ in relic_matches
        )
        result["relic_scores"] = {
            name.replace("_", " ").title(): round(s, 3)
            for name, s, _, _ in relic_matches
        }
        log.debug(f"  [row {row_idx}] relics: {[(n.replace('_', ' ').title(), f'{s:.3f}') for n, s, _, _ in relic_matches]}")
    # 6. W-L OCR — bottom half of cell (top half has gold "$XXX")
    wl_y0 = row_y0 + (row_y1 - row_y0) * MM_WL_Y_IN_ROW[0]
    wl_y1 = row_y0 + (row_y1 - row_y0) * MM_WL_Y_IN_ROW[1]
    wl_cell = _crop(img, MM_COL_WL[0], wl_y0, MM_COL_WL[1], wl_y1)
    wl_proc = _preprocess_for_ocr(wl_cell, scale=3.0)
    _save_debug(f"mm_wl_{row_idx}", wl_proc, debug)
    wl_raw = _ocr(wl_proc, psm=7, whitelist="0123456789-")
    wl_m = re.search(r"(\d{1,3})\s*[-–]\s*(\d{1,3})", wl_raw)
    if wl_m:
        result["wl"] = f"{wl_m.group(1)}-{wl_m.group(2)}"
    log.debug(f"  [row {row_idx}] wl OCR: {wl_raw!r} → {result['wl']!r}")
    if debug:
        result["_debug"]["wl_raw"] = wl_raw
        result["_debug"]["wl_cell"] = wl_cell
        result["_debug"]["wl_proc"] = wl_proc
    # 7. Rank OCR
    rank_y0 = row_y0 + (row_y1 - row_y0) * MM_RANK_Y_IN_ROW[0]
    rank_y1 = row_y0 + (row_y1 - row_y0) * MM_RANK_Y_IN_ROW[1]
    rank_cell = _crop(img, MM_COL_RANK[0], rank_y0, MM_COL_RANK[1], rank_y1)
    rank_proc = _preprocess_for_ocr(rank_cell, scale=3.0)
    _save_debug(f"mm_rank_{row_idx}", rank_proc, debug)
    rank_raw = _ocr(rank_proc, psm=6)
    rank_names = ("Pawn", "Knight", "Bishop", "Rook", "King", "Queen")
    rank_re = re.compile(r"(" + "|".join(rank_names) + r")[\s\-]*(\d)", re.IGNORECASE)
    rank_m = rank_re.search(rank_raw)
    if rank_m:
        result["rank"] = f"{rank_m.group(1).title()}-{rank_m.group(2)}"
    # Detect rank change by color: green ▲ = up, red ▼ = down
    rc_float = rank_cell.astype(float)
    b_ch = rc_float[:, :, 0]  # BGR channel 0 = blue
    g_ch = rc_float[:, :, 1]  # BGR channel 1 = green
    r_ch = rc_float[:, :, 2]  # BGR channel 2 = red
    green_mask = (g_ch > 100) & (g_ch > r_ch * 1.3) & (g_ch > b_ch * 1.3)
    red_mask = (r_ch > 100) & (r_ch > g_ch * 1.3) & (r_ch > b_ch * 1.3)
    total = rank_cell.shape[0] * rank_cell.shape[1]
    green_pct = green_mask.sum() / total
    red_pct = red_mask.sum() / total
    if green_pct > 0.005:
        result["rank_change"] = "up"
    elif red_pct > 0.005:
        result["rank_change"] = "down"
    log.debug(f"  [row {row_idx}] rank color: green={green_pct:.3f} red={red_pct:.3f}")
    log.debug(f"  [row {row_idx}] rank OCR: {rank_raw!r} → {result['rank']!r} ({result['rank_change']})")
    if debug:
        result["_debug"]["rank_raw"] = rank_raw
        result["_debug"]["rank_cell"] = rank_cell
        result["_debug"]["rank_proc"] = rank_proc
        result["_debug"]["rank_green_pct"] = green_pct
        result["_debug"]["rank_red_pct"] = red_pct
        result["_debug"]["row_strip"] = _crop(img, 0.0, row_y0, 1.0, row_y1)
    # 8. Time-ago OCR — same x as placement, bottom portion of row
    rh = row_y1 - row_y0
    time_cell = _crop(img, MM_COL_TIME[0], row_y0 + rh * MM_TIME_Y_IN_ROW[0],
                      MM_COL_TIME[1], row_y0 + rh * MM_TIME_Y_IN_ROW[1])
    time_proc = _preprocess_for_ocr(time_cell, scale=2.5, invert=True)
    _save_debug(f"mm_time_{row_idx}", time_proc, debug)
    time_raw = _ocr(time_proc, psm=6)
    result["time_ago"] = _normalise_time_ago(time_raw)
    log.debug(f"  [row {row_idx}] time_ago OCR: {time_raw!r} → {result['time_ago']!r}")
    return result


def _img_to_b64(img: np.ndarray) -> str:
    """Encode an OpenCV image as a base64 data URI."""
    ok, buf = cv2.imencode(".png", img)
    return ("data:image/png;base64," + base64.b64encode(buf).decode()) if ok else ""


def _generate_debug_html(img: np.ndarray, rows: list[tuple[float, float]],
                         parsed: list[dict]) -> None:
    """Generate an HTML debug report from the actual parse results.

    Writes to DEBUG_DIR / report.html with embedded images and OCR data.
    """
    h, w = img.shape[:2]
    parts = []

    # CSS
    parts.append("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>F7 Debug Report</title>
<style>
body { background:#111; color:#eee; font-family:system-ui,monospace; padding:20px; max-width:1400px; margin:0 auto }
h1 { color:#e94560; font-size:20px; border-bottom:2px solid #333; padding-bottom:10px }
details { margin-bottom:12px; background:#1a1a1a; padding:4px 16px; border-radius:8px; border:1px solid #222 }
summary { cursor:pointer; padding:8px 0; font-size:14px; font-weight:bold; border-bottom:1px solid #333; color:#e94560 }
summary:hover { color:#fff }
img { vertical-align:middle; image-rendering:pixelated; border:1px solid #444; border-radius:4px }
.kv { margin:2px 0 }
.kv .k { color:#888 }
.kv .v { color:#eee }
.ok { color:#0f0 }
.bad { color:#f00 }
.crop-row { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-start; margin:8px 0 }
.crop-box { display:inline-block; text-align:center; margin:4px }
.crop-label { font-size:10px; color:#888; margin-bottom:2px }
.ocr-table { border-collapse:collapse; width:100%; font-size:12px; margin:8px 0 }
.ocr-table th { background:#0f3460; padding:6px 8px; text-align:left }
.ocr-table td { padding:4px 8px }
.ocr-table tr:nth-child(even) { background:#1a1a2e }
.ocr-table tr:nth-child(odd) { background:#16213e }
.summary-bar { margin-top:8px; padding:8px; background:#0f3460; border-radius:6px; font-size:13px }
</style></head><body>""")

    parts.append(f'<h1>F7 Debug Report ({w}&times;{h})</h1>')

    # Overview — scaled-down screenshot
    thumb = cv2.resize(img, (w // 3, h // 3))
    parts.append(f'<details open><summary>Input Screenshot</summary>')
    parts.append(f'<img src="{_img_to_b64(thumb)}" style="max-height:400px">')
    parts.append(f'</details>')

    # Row boundaries overview
    annotated = img.copy()
    for i, (y0, y1) in enumerate(rows):
        py0, py1 = int(y0 * h), int(y1 * h)
        cv2.line(annotated, (0, py0), (w, py0), (0, 255, 0), 2)
        cv2.line(annotated, (0, py1), (w, py1), (0, 0, 255), 2)
        cv2.putText(annotated, f"Row {i}", (20, py0 + 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
    ann_thumb = cv2.resize(annotated, (w // 3, h // 3))
    parts.append(f'<details open><summary>Row Detection ({len(rows)} rows)</summary>')
    parts.append(f'<img src="{_img_to_b64(ann_thumb)}" style="max-height:400px">')
    for i, (y0, y1) in enumerate(rows):
        parts.append(f'<div class="kv"><span class="k">Row {i}:</span> '
                     f'<span class="v">y={y0:.4f}-{y1:.4f} ({int(y0*h)}-{int(y1*h)}px)</span></div>')
    parts.append(f'</details>')

    # Per-row details
    for row_i, rd in enumerate(parsed):
        dbg = rd.get("_debug", {})
        parts.append(f'<details open><summary>Row {row_i}: '
                     f'Place={rd["placement"]} Level={rd["level"]} '
                     f'W-L={rd["wl"]} Rank={rd["rank"]}</summary>')

        # Row strip
        row_strip = dbg.get("row_strip")
        if row_strip is not None:
            parts.append(f'<img src="{_img_to_b64(row_strip)}" style="max-height:100px;width:100%">')

        # Crops side by side
        parts.append('<div class="crop-row">')
        crop_items = [
            ("Placement (raw)", dbg.get("place_cell")),
            ("Placement (proc)", dbg.get("place_proc")),
            ("Level (raw)", dbg.get("level_cell")),
            ("Level (proc)", dbg.get("level_proc")),
            ("Units", dbg.get("unit_region")),
            ("W-L (raw)", dbg.get("wl_cell")),
            ("W-L (proc)", dbg.get("wl_proc")),
            ("Rank (raw)", dbg.get("rank_cell")),
            ("Rank (proc)", dbg.get("rank_proc")),
        ]
        for label, crop_img in crop_items:
            if crop_img is not None:
                parts.append(f'<div class="crop-box"><div class="crop-label">{label}</div>'
                             f'<img src="{_img_to_b64(crop_img)}" style="max-height:80px"></div>')
        parts.append('</div>')

        # OCR results table
        parts.append('<table class="ocr-table"><tr><th>Field</th><th>Raw OCR</th>'
                     '<th>Parsed</th></tr>')
        ocr_fields = [
            ("Placement", dbg.get("place_raw", ""), rd["placement"]),
            ("Level", dbg.get("level_raw", ""), rd["level"]),
            ("W-L", dbg.get("wl_raw", ""), rd["wl"]),
            ("Rank", dbg.get("rank_raw", ""), rd["rank"]),
        ]
        for field, raw, parsed_val in ocr_fields:
            color = "ok" if parsed_val else "bad"
            parts.append(f'<tr><td>{field}</td><td><code>{raw!r}</code></td>'
                         f'<td class="{color}">{parsed_val or "(empty)"}</td></tr>')
        parts.append('</table>')

        # Unit matches with scores
        unit_matches = dbg.get("unit_matches", [])
        if unit_matches:
            parts.append(f'<div class="kv"><span class="k">Units ({len(unit_matches)}):</span></div>')
            parts.append('<table class="ocr-table"><tr><th>Unit</th><th>Score</th>'
                         '<th>Grid X,Y</th></tr>')
            for name, score, ux, uy in unit_matches:
                sc_color = "#0f0" if score >= 0.80 else ("#ff0" if score >= 0.70 else "#f00")
                parts.append(f'<tr><td>{name}</td>'
                             f'<td style="color:{sc_color}">{score:.3f}</td>'
                             f'<td>{ux},{uy}</td></tr>')
            parts.append('</table>')

        # Rank change color info
        gp = dbg.get("rank_green_pct", 0)
        rp = dbg.get("rank_red_pct", 0)
        parts.append(f'<div class="kv"><span class="k">Rank change:</span> '
                     f'<span class="v">{rd["rank_change"]} '
                     f'(green={gp:.3f} red={rp:.3f})</span></div>')

        # Other fields
        parts.append(f'<div class="kv"><span class="k">Synergies:</span> '
                     f'<span class="v">{rd["synergies"] or "(none)"}</span></div>')
        parts.append(f'<div class="kv"><span class="k">Relic:</span> '
                     f'<span class="v">{rd["relic"] or "(none)"}</span></div>')

        # Summary bar
        units = rd.get("units", [])
        parts.append(f'<div class="summary-bar"><strong>Row {row_i}:</strong> '
                     f'Place={rd["placement"]} Level={rd["level"]} '
                     f'W-L={rd["wl"]} Rank={rd["rank"]}({rd["rank_change"]}) '
                     f'Units={len(units)} Syn={rd["synergies"] or "-"} '
                     f'Relics={rd["relic"] or "-"}</div>')
        parts.append('</details>')

    # Summary table
    parts.append(f'<details open><summary>Summary ({len(parsed)} rows)</summary>')
    cols = ["#", "Place", "Level", "W-L", "Rank", "Change", "Units", "Synergies", "Relics"]
    parts.append('<table class="ocr-table">')
    parts.append('<tr>' + ''.join(f'<th>{c}</th>' for c in cols) + '</tr>')
    for i, rd in enumerate(parsed):
        units = rd.get("units", [])
        parts.append(f'<tr><td>{i}</td><td>{rd["placement"]}</td><td>{rd["level"]}</td>'
                     f'<td>{rd["wl"]}</td><td>{rd["rank"]}</td><td>{rd["rank_change"]}</td>'
                     f'<td style="max-width:200px;word-break:break-word">{", ".join(units)}</td>'
                     f'<td>{rd["synergies"]}</td><td>{rd["relic"]}</td></tr>')
    parts.append('</table></details>')
    parts.append('</body></html>')

    html = "\n".join(parts)
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    report_path = DEBUG_DIR / "report.html"
    report_path.write_text(html)
    log.info(f"[mm] Debug report: {report_path} ({len(html)} bytes)")


def parse_my_matches(
    img: np.ndarray,
    player_name: str,
    icons_dir: Path,
    units_data: dict | None = None,
    debug: bool = False,
) -> list[dict]:
    """Parse a MY MATCHES history screenshot.

    Returns list of row dicts (one per visible game row), each containing:
      placement, level, units (list), synergies, wl, rank.
    Returns empty list on failure.
    """
    apply_calibration(img)
    h, w = img.shape[:2]
    log.debug(f"[mm] Image: {w}×{h}")
    # Load units data if not provided
    if units_data is None:
        from utils import DATA_DIR as data_dir
        units_path = data_dir / "units.json"
        if units_path.exists():
            import json
            units_data = json.loads(units_path.read_text(encoding="utf-8"))["units"]
        else:
            units_data = {}

    # Build stem→name lookup
    stem_to_name = {_unit_stem(name): name for name in units_data}

    # Load unit icon templates
    units_icons_dir = icons_dir / "units"
    log.info(f"[mm] Loading unit templates from {units_icons_dir}...")
    unit_templates = _load_templates_multiscale(units_icons_dir, UNIT_ICON_SCALES,
                                                 inner_frac=0.85, color=True)
    if not unit_templates:
        log.warning(f"[mm] WARNING: no unit icons found in {units_icons_dir}")
        log.info("     Run: python download_unit_icons.py")

    # Load relic icon templates
    relic_templates = _load_templates_multiscale(icons_dir / "relics", RELIC_ICON_SCALES,
                                                  inner_frac=1.0, color=True)
    log.debug(f"[mm] Loaded {len(relic_templates)} relic templates")

    # Load synergy icon templates
    syn_templates = _load_templates_multiscale(icons_dir / "synergies", MM_SYNERGY_ICON_SCALES)
    log.debug(f"[mm] Loaded {len(syn_templates)} synergy templates at scales {MM_SYNERGY_ICON_SCALES}")

    # Find row boundaries
    rows = _find_my_matches_rows(img, debug=debug)
    log.info(f"[mm] Detected {len(rows)} rows")

    parsed = []
    for i, (y0, y1) in enumerate(rows):
        log.debug(f"\n[mm] --- Row {i} (y={y0:.3f}-{y1:.3f}) ---")
        row_data = _parse_my_matches_row(
            img, y0, y1,
            unit_templates, relic_templates, syn_templates, icons_dir,
            units_data, stem_to_name,
            debug=debug, row_idx=i,
        )
        # Skip rows where we got nothing useful (empty rows at bottom of table)
        if not (row_data["placement"] or (len(row_data["units"]) >= 3 and row_data["wl"])):
            log.debug(f"  [row {i}] insufficient data, skipping")
            continue
        parsed.append(row_data)

    log.info(f"[mm] Parsed {len(parsed)} non-empty rows")

    if debug:
        try:
            _generate_debug_html(img, rows, parsed)
        except Exception as e:
            log.warning(f"[mm] Failed to generate debug HTML: {e}")

    # Strip _debug data from returned results (it contains large numpy arrays)
    for rd in parsed:
        rd.pop("_debug", None)

    return parsed


# ── Public API ───────────────────────────────────────────────────────────────

def parse_screenshot_cv(
    image_path: Path,
    player_name: str,
    icons_dir: Path,
    debug: bool = False,
) -> dict | None:
    """Parse an end-of-game screenshot using CV.

    Returns dict with keys: placement, level, wl, synergies, relic
    or None if screen type is unsupported or parsing fails.
    """
    img = cv2.imread(str(image_path))
    if img is None:
        print(f"[cv] ERROR: cannot read image: {image_path}")
        return None

    apply_calibration(img)
    screen_type = detect_screen_type(img)
    print(f"[cv] Screen type: {screen_type}")

    if screen_type == "game_over":
        return parse_game_over(img, player_name, icons_dir, debug=debug)

    # MY MATCHES is handled by parse_my_matches() separately;
    # final_ranking and unknown → return None (caller falls back to Ollama)
    return None


# ── Dev test entry point ─────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python cv_parser.py <screenshot.jpg> [player_name] [--debug]")
        sys.exit(1)

    image_path = Path(sys.argv[1])
    player_name = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("-") else "jack"
    debug = "--debug" in sys.argv

    from utils import ICONS_DIR as icons_dir
    print(f"Image:  {image_path}")
    print(f"Player: {player_name}")
    print(f"Icons:  {icons_dir}")
    print(f"Debug:  {debug}")
    print()

    img = cv2.imread(str(image_path))
    if img is None:
        print(f"ERROR: cannot read image: {image_path}")
        sys.exit(1)

    screen_type = detect_screen_type(img)
    print(f"Screen type: {screen_type}")
    print()

    if screen_type == "my_matches":
        rows = parse_my_matches(img, player_name, icons_dir, debug=debug)
        if not rows:
            print("No rows parsed.")
            sys.exit(1)
        print(f"\n=== MY MATCHES — {len(rows)} row(s) ===")
        for i, row in enumerate(rows):
            print(f"\n  Row {i + 1}:")
            for k, v in row.items():
                if k == "units":
                    print(f"    {'units':12s}: {', '.join(v) if v else '(none)'}")
                else:
                    print(f"    {k:12s}: {v}")
    else:
        result = parse_screenshot_cv(image_path, player_name, icons_dir, debug=debug)
        if result is None:
            print("Parsing failed or unsupported screen type.")
            sys.exit(1)
        print("\n=== Parsed Fields ===")
        for k, v in result.items():
            print(f"  {k:12s}: {v}")


if __name__ == "__main__":
    main()
