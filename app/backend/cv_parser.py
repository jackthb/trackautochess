"""Deterministic CV parsing for DAC end-of-game screenshots.

Replaces Ollama vision calls for structured GAME OVER table screenshots.
Uses OpenCV template matching for synergy/relic icons and pytesseract for
numeric fields (placement, level, W-L).

Usage (dev test):
    python cv_parser.py /path/to/screenshot.jpg [player_name] [--debug]
"""

import base64
import logging
import re
import sys
from pathlib import Path

import cv2
import numpy as np

try:
    import pytesseract
except ImportError:
    pytesseract = None

from utils import crop as _crop, ocr as _ocr, unit_stem as _unit_stem

log = logging.getLogger("dac")


# ── Region constants ─────────────────────────────────────────────────────────
# All values as fractions of image (width, height).
# Calibrated on 3440×1440 GAME OVER table (dac1.jpg).

# Title detection crops (x0, y0, x1, y1)
TITLE_REGION = (0.30, 0.00, 0.70, 0.12)
FINAL_RANK_REGION = (0.0, 0.24, 0.14, 0.32)  # left panel "Final Ranking" overlay
ELIMINATED_REGION = (0.0, 0.17, 0.14, 0.25)  # "You have been eliminated" text above

# Column x-extents (x_start, x_end) as fraction of image width
COL_RANK    = (0.000, 0.025)
COL_PLAYER  = (0.025, 0.155)
COL_LEVEL   = (0.130, 0.165)   # gold circle with level number
COL_SYNERGY = (0.390, 0.500)   # 5 synergy badge icons with counts
COL_RELIC   = (0.485, 0.555)   # relic reward icons (2x2 grid + large icon)
COL_WL      = (0.573, 0.612)   # W-L column only (not Gold/Damage)

# Table row geometry
TABLE_Y_START = 0.155   # where row 1 data begins (below header)
TABLE_Y_END   = 0.97
N_ROWS = 8

# Template matching
MATCH_THRESHOLD = 0.70
# On-screen synergy badge icon is ~45px at 3440px wide
# We try multiple scales to find best match
SYNERGY_ICON_SCALES = [32, 36, 40, 44]
RELIC_ICON_SCALES = [12, 14, 16, 20, 24, 28, 32, 40, 50, 60]
# Crop inner portion of reference icon (remove border area)
ICON_INNER_FRAC = 0.75  # keep central 75% of reference icon
# Synergy badges occupy the top ~45% of each row cell
SYNERGY_BADGE_Y_MAX_FRAC = 0.50

# Debug output directory (created when --debug is used)
DEBUG_DIR = Path.home() / ".dac" / "debug"


# ── MY MATCHES screen constants ───────────────────────────────────────────────
# Calibrated on 3440×1440. All values as fractions of image dimensions.

MM_TAB_REGION     = (0.30, 0.12, 0.55, 0.20)  # tab bar containing "MY MATCHES"
MM_TABLE_Y_START  = 0.33   # top of first data row
MM_TABLE_Y_END    = 0.90   # bottom of last data row
MM_SEP_SCAN_X     = (0.60, 0.70)   # x-band scanned for dark row separators
MM_SEP_DARK_THRESH = 35            # mean brightness below this → separator band

# Per-row column extents (x_start, x_end as fraction of image width)
# Calibrated from user pixel measurements on 3440×1440 screenshot.
MM_COL_PLACEMENT = (0.390, 0.436)
MM_COL_LEVEL     = (0.452, 0.481)
MM_COL_UNITS     = (0.4814, 0.5945)
MM_COL_SYNERGY   = (0.597, 0.692)
MM_COL_RELIC     = (0.7035, 0.7491)
MM_COL_WL        = (0.752, 0.792)
MM_COL_RANK      = (0.792, 0.863)
# "X hrs ago" / "X days ago" text — same x as placement, bottom portion of row.
# Calibrated on 3440×1440.
MM_COL_TIME      = (0.390, 0.436)

UNIT_ICON_SCALES    = [24, 28, 32, 36, 40, 44]
UNIT_MATCH_THRESHOLD = 0.65
MM_SYNERGY_ICON_SCALES = [20, 24, 28, 32]  # smaller than GAME OVER (32-44)

# Synergy icon grid for MY MATCHES rows.
# Calibrated from sentinel picker on 3440×1440.
# 5 columns max per sub-row; 6+ synergies → 2 sub-rows (5 top + rest bottom).
# Synergies appear in decreasing count order (left→right, top→bottom).
MM_SYN_COLS_X = [0.61308, 0.62645, 0.64070, 0.65407, 0.66773]  # icon x0
MM_SYN_ICON_W = 0.0125   # icon width (fraction of image width)
MM_SYN_ICON_H = 0.028    # icon height (fraction of image height)
# Y position of icon top edge as fraction of row height
MM_SYN_Y_1ROW = 0.21     # single-row mode
MM_SYN_Y_2ROW_TOP = 0.0  # 2-row mode, top row (starts at row top)
MM_SYN_Y_2ROW_BOT = 0.59 # 2-row mode, bottom row
# Brightness threshold: mean pixel value above this → icon present
MM_SYN_BRIGHT_THRESH = 40

# Grid layout for unit icons in MY MATCHES rows.
# Calibrated on 3440×1440 from manual coordinate picking.
# Unit column is ~389px wide, 9 slots spaced ~43px apart.
MM_UNIT_GRID_START_FRAC = 0.0     # grid origin x at column left edge
MM_UNIT_GRID_SPACING_FRAC = 0.1102 # slot spacing as fraction of unit column width
MM_UNIT_SPLIT_Y = 0.514            # two-row split point (fraction of row height)
MM_UNIT_ONE_ROW_Y = (0.215, 0.813) # single-row icon y range (fraction of row height)
MM_UNIT_MAX_SLOTS = 9              # max slots per sub-row

# Relic grid layout for MY MATCHES rows.
# Calibrated on 3440×1440 from coord picker measurements.
# 3 columns × 2 rows = 6 slots max. Positions as fractions of relic cell dims.
MM_RELIC_COLS = 3
MM_RELIC_ROWS = 2
MM_RELIC_SPLIT_Y = 0.49            # row split (fraction of cell height)
# Column slot x-ranges as fractions of relic cell width (gaps between cols)
MM_RELIC_COL_RANGES = [
    (0.000, 0.300),   # col 0: x=0.7035..0.7172
    (0.351, 0.649),   # col 1: x=0.7195..0.7331
    (0.702, 1.000),   # col 2: x=0.7355..0.7491
]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _crop_row(img: np.ndarray, col: tuple[float, float], row_y0: float, row_y1: float) -> np.ndarray:
    """Crop a cell: column x-extent × row y-extent."""
    return _crop(img, col[0], row_y0, col[1], row_y1)


def _ocr_data(img: np.ndarray, psm: int = 6) -> dict:
    """OCR with bounding box data. Returns pytesseract output dict."""
    if pytesseract is None:
        return {"text": [], "top": [], "height": [], "conf": []}
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    try:
        return pytesseract.image_to_data(gray, config=f"--psm {psm}",
                                          output_type=pytesseract.Output.DICT)
    except Exception:
        return {"text": [], "top": [], "height": [], "conf": []}


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

def detect_screen_type(img: np.ndarray) -> str:
    """Detect which end-screen type this is.

    Returns: 'game_over', 'final_ranking', 'my_matches', or 'unknown'.
    """
    # Check center-top title area (Game Over / My Matches headings)
    title_crop = _crop(img, *TITLE_REGION)
    text = _ocr(title_crop, psm=6).upper()
    if "GAME" in text and "OVER" in text:
        return "game_over"
    if "FINAL" in text or "RANKING" in text:
        return "final_ranking"
    if "MY" in text and "MATCH" in text:
        return "my_matches"

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

    # Also scan the narrower tab bar region (MY MATCHES tab is top-left)
    tab_crop = _crop(img, *MM_TAB_REGION)
    tab_text = _ocr(tab_crop, psm=6).upper()
    if "MY" in tab_text and "MATCH" in tab_text:
        return "my_matches"
    return "unknown"


# ── Row geometry ─────────────────────────────────────────────────────────────

def _row_y_extent(row_idx: int) -> tuple[float, float]:
    """Return (y_start, y_end) fractions for a given row index (0-based)."""
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


# ── Left-panel rank extraction ────────────────────────────────────────────────

# The Game Over screen has a player list in the left sidebar (x=0..17%).
# Each row shows: position, player name, level, rank (e.g. "Bishop-1").
# We scan rows to find the player name, then extract the adjacent rank.
RANK_PANEL_X = (0.0, 0.17)
RANK_PANEL_Y = (0.165, 0.68)
RANK_PANEL_ROWS = 8
RANK_NAMES = ("Pawn", "Knight", "Bishop", "Rook", "King", "Queen")


def extract_rank_from_panel(img: np.ndarray, player_name: str, debug: bool = False) -> str:
    """Extract player rank (e.g. 'Bishop-1') from the left sidebar.

    Scans panel rows for the player name, then reads the rank word+digit
    on the same row (or ±1 row if not found immediately).
    Returns empty string if rank cannot be read.
    """
    h, w = img.shape[:2]
    px0, px1 = int(w * RANK_PANEL_X[0]), int(w * RANK_PANEL_X[1])
    py0, py1 = int(h * RANK_PANEL_Y[0]), int(h * RANK_PANEL_Y[1])
    panel_h = py1 - py0
    row_h = panel_h // RANK_PANEL_ROWS
    pname = player_name.lower()

    def _ocr_strip(y0: int, y1: int) -> str:
        strip = img[y0:y1, px0:px1]
        gray = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY) if len(strip.shape) == 3 else strip
        _, bright = cv2.threshold(gray, 140, 255, cv2.THRESH_BINARY)
        scaled = cv2.resize(bright, (bright.shape[1] * 3, bright.shape[0] * 3),
                            interpolation=cv2.INTER_CUBIC)
        inv = cv2.bitwise_not(scaled)
        try:
            import pytesseract as _pt
            return _pt.image_to_string(inv, config="--psm 6").strip().replace("\n", " ")
        except Exception:
            return ""

    # Find row containing player name
    player_row = None
    for i in range(RANK_PANEL_ROWS):
        ry0 = py0 + i * row_h
        ry1 = ry0 + row_h
        text = _ocr_strip(ry0, ry1)
        log.debug(f"  [rank panel] row {i}: {text!r}")
        if pname in text.lower():
            player_row = i
            break

    if player_row is None:
        log.debug(f"  [rank panel] player '{player_name}' not found in sidebar")
        return ""

    # Search for rank text in the player's row, expanding only DOWNWARD
    # (rank badge sits below the player name in the same row).
    # Avoid expanding upward — that reads the previous player's rank.
    rank_re = re.compile(
        r"(" + "|".join(RANK_NAMES) + r")[\s\-]*(\d)",
        re.IGNORECASE,
    )
    for extra in (0, 0.5, 1.0):
        ry0 = py0 + player_row * row_h
        ry1 = min(py1, py0 + int((player_row + 1 + extra) * row_h))
        text = _ocr_strip(ry0, ry1)
        # Find ALL rank matches and pick the LAST one (closest to player,
        # since player name is at top and rank badge is below)
        matches = list(rank_re.finditer(text))
        if matches:
            m = matches[-1]
            rank = f"{m.group(1).title()}-{m.group(2)}"
            log.debug(f"  [rank panel] found rank={rank!r} in: {text!r}")
            return rank

    log.debug("  [rank panel] rank word not found near player row")
    return ""


# ── GAME OVER table parser ───────────────────────────────────────────────────

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
    syn_matches = _match_templates_multiscale(syn_cell, syn_templates,
                                               y_max_frac=SYNERGY_BADGE_Y_MAX_FRAC,
                                               debug=debug)
    avg_icon_px = SYNERGY_ICON_SCALES[len(SYNERGY_ICON_SCALES) // 2]
    syn_counts = _ocr_synergy_counts(syn_cell, syn_matches, avg_icon_px, debug=debug)
    synergies = "|".join(f"{name}:{count}" for name, count in syn_counts if count > 0)
    if not synergies:
        # If count OCR failed, still report names with count 0
        synergies = "|".join(f"{name}:0" for name, _, _, _ in syn_matches)

    # 6. Template match relics (global multiscale — Game Over layout differs from MY MATCHES)
    log.info("[cv] Matching relic icons...")
    relic_cell = _crop_row(img, COL_RELIC, y0, y1)
    _save_debug("relic_cell", relic_cell, debug)
    relic_templates = _load_templates_multiscale(icons_dir / "relics", RELIC_ICON_SCALES,
                                                  inner_frac=1.0, color=True)
    log.debug(f"  Loaded {len(relic_templates)} relic templates at scales {RELIC_ICON_SCALES}")
    relic_matches = _match_templates_multiscale(relic_cell, relic_templates, threshold=0.45,
                                                 color=True, debug=debug)
    # Keep best score per unique relic name, take top 5
    best_per_name: dict[str, float] = {}
    for name, score, x, y in relic_matches:
        if name not in best_per_name or score > best_per_name[name]:
            best_per_name[name] = score
    ranked = sorted(best_per_name.items(), key=lambda x: -x[1])[:5]
    relic = "|".join(name.replace("_", " ").title() for name, score in ranked)
    log.debug(f"  Relic ranking: {[(n, f'{s:.3f}') for n, s in ranked]}")
    # 7. Extract rank from left sidebar
    rank = extract_rank_from_panel(img, player_name, debug=debug)
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


# ── MY MATCHES parser ────────────────────────────────────────────────────────

def _find_my_matches_rows(img: np.ndarray, debug: bool = False) -> list[tuple[float, float]]:
    """Find row y-spans by scanning for dark separator bands, then extrapolating.

    The bottom rows often blend into the dark background, so we detect the
    row height from the first few separators and extrapolate to fill the table.
    Returns list of (y0, y1) fractions.
    """
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
    raw = json.loads(syn_path.read_text())
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
    # Calibrated from sentinel picker on 3440x1440.
    if two_row:
        # Counts for top-row icons sit between the two icon rows
        count_y0 = int((row_y0 + row_h * 0.37) * h)
        count_y1 = int((row_y0 + row_h * 0.63) * h)
    else:
        # Counts sit below the single row of icons
        count_y0 = int((row_y0 + row_h * 0.58) * h)
        count_y1 = int((row_y0 + row_h * 0.86) * h)
    # x spans from first icon to last icon
    count_x0 = int(0.613 * w)
    count_x1 = int(0.680 * w)
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
    data = _json.loads(syn_path.read_text())
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
    - Rows with an hour-resolution time_ago (e.g. "3h ago") → subtract from
      screenshot_time, round to the nearest minute.
    - Rows with a day-resolution time_ago (e.g. "3d ago") or unknown → assign
      artificial sequential times: 01:00, 02:00, 03:00 … on that day.
      The ordering follows the row order in the list (top = earliest index).

    Args:
        rows: list of row dicts from parse_my_matches (each may have "time_ago")
        screenshot_time: datetime when the screenshot was taken

    Returns:
        list of ISO-8601 datetime strings, one per row (same length as rows).
    """
    from datetime import datetime as _dt, timedelta, date as _date, time as _time

    if not isinstance(screenshot_time, _dt):
        screenshot_time = _dt.now()

    # First pass: resolve each row to (date, high_res_dt_or_None)
    resolved: list[tuple[_date, _dt | None]] = []
    for row in rows:
        unit, val = parse_time_ago(row.get("time_ago", ""))
        if unit == "minutes":
            dt = screenshot_time - timedelta(minutes=val)
            resolved.append((dt.date(), dt))
        elif unit == "hours":
            dt = screenshot_time - timedelta(hours=val)
            resolved.append((dt.date(), dt))
        elif unit == "days":
            target_date = (screenshot_time - timedelta(days=val)).date()
            resolved.append((target_date, None))
        else:
            # Unknown — fall back to screenshot date with no time
            resolved.append((screenshot_time.date(), None))

    # Second pass: for day-only rows, assign sequential 01:00, 02:00, … per day
    day_counters: dict[_date, int] = {}
    result: list[str] = []
    for target_date, high_res_dt in resolved:
        if high_res_dt is not None:
            result.append(high_res_dt.strftime("%Y-%m-%d %H:%M:%S"))
        else:
            n = day_counters.get(target_date, 0)
            day_counters[target_date] = n + 1
            hour = 1 + n  # 01:00, 02:00, 03:00, …
            dt = _dt.combine(target_date, _time(min(hour, 23), 0))
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
    place_cell = _crop(img, MM_COL_PLACEMENT[0], row_y0 + (row_y1 - row_y0) * 0.15,
                       MM_COL_PLACEMENT[1], row_y0 + (row_y1 - row_y0) * 0.75)
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
    level_cell = _crop(img, MM_COL_LEVEL[0], row_y0 + (row_y1 - row_y0) * 0.30,
                       MM_COL_LEVEL[1], row_y0 + (row_y1 - row_y0) * 0.75)
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
    wl_y0 = row_y0 + (row_y1 - row_y0) * 0.55
    wl_y1 = row_y0 + (row_y1 - row_y0) * 0.95
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
    rank_y0 = row_y0 + (row_y1 - row_y0) * 0.20
    rank_y1 = row_y0 + (row_y1 - row_y0) * 0.80
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
    time_cell = _crop(img, MM_COL_TIME[0], row_y0 + rh * 0.65, MM_COL_TIME[1], row_y1)
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
    h, w = img.shape[:2]
    log.debug(f"[mm] Image: {w}×{h}")
    # Load units data if not provided
    if units_data is None:
        from utils import DATA_DIR as data_dir
        units_path = data_dir / "units.json"
        if units_path.exists():
            import json
            units_data = json.loads(units_path.read_text())["units"]
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
