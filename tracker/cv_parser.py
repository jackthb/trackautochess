"""Deterministic CV parsing for DAC end-of-game screenshots.

Replaces Ollama vision calls for structured GAME OVER table screenshots.
Uses OpenCV template matching for synergy/relic icons and pytesseract for
numeric fields (placement, level, W-L).

Usage (dev test):
    python cv_parser.py /path/to/screenshot.jpg [player_name] [--debug]
"""

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
DEBUG_DIR = Path("/tmp/cv_debug")


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

UNIT_ICON_SCALES    = [24, 28, 32, 36, 40, 44]
UNIT_MATCH_THRESHOLD = 0.65

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
    # Convert RGBA → BGR (composite on black)
    if len(img.shape) == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3] / 255.0
        bgr = img[:, :, :3].astype(float)
        bgr = (bgr * alpha[:, :, np.newaxis]).astype(np.uint8)
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


def _match_unit_grid(
    unit_region: np.ndarray,
    templates: dict[str, list[np.ndarray]],
    threshold: float = UNIT_MATCH_THRESHOLD,
    debug: bool = False,
) -> list[tuple[str, float, int, int]]:
    """Per-slot unit matching against individual grid cells.

    Matches each slot against the full row height. Templates are small
    enough to find icons whether they're in a single-row or two-row layout.
    Uses matchTemplate which naturally finds the best y-position within
    the slot. Assigns to top/bottom zone based on match y-position to
    allow two units per slot in two-row layouts.

    Returns [(name, score, x, y), ...] sorted by y then x.
    """
    region_bgr = unit_region if len(unit_region.shape) == 3 else cv2.cvtColor(unit_region, cv2.COLOR_GRAY2BGR)
    rh, rw = region_bgr.shape[:2]

    grid_start = int(rw * MM_UNIT_GRID_START_FRAC)
    grid_spacing = max(int(rw * MM_UNIT_GRID_SPACING_FRAC), 1)
    y_mid = int(rh * MM_UNIT_SPLIT_Y)

    # Match each slot against full row height
    # cell_best keyed by (slot_idx, y_zone) to allow two matches per slot
    cell_best: dict[tuple[int, int], tuple[str, float, int, int]] = {}
    for slot_idx in range(MM_UNIT_MAX_SLOTS):
        sx = grid_start + slot_idx * grid_spacing
        crop_x0 = max(sx - 5, 0)
        crop_x1 = min(sx + grid_spacing + 5, rw)
        slot_img = region_bgr[0:rh, crop_x0:crop_x1]
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
                _, max_val, _, max_loc = cv2.minMaxLoc(result)
                if max_val < threshold:
                    continue
                match_y = max_loc[1]
                y_zone = 0 if match_y < y_mid else 1
                key = (slot_idx, y_zone)
                if key not in cell_best or max_val > cell_best[key][1]:
                    cell_best[key] = (name, float(max_val), sx, match_y)

    all_matches = []
    for (slot_idx, y_zone) in sorted(cell_best):
        name, score, x, y = cell_best[(slot_idx, y_zone)]
        zone_label = "top" if y_zone == 0 else "bot"
        all_matches.append((name, score, x, y))
        log.debug(f"    slot {zone_label}[{slot_idx}]: {name:20s} score={score:.3f}")
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
        last_sep = sep_zones[-1][1]  # end of last separator band
        while last_sep + row_h_px * 0.5 < h:
            r_y0 = last_sep / h
            r_y1 = min((last_sep + row_h_px) / h, 1.0)
            rows.append((r_y0, r_y1))
            last_sep += row_h_px

        log.debug(f"  [mm rows] row height={row_h_px}px, extrapolated to {len(rows)} total rows")
    # Fallback: fixed geometry (assume 8 rows of equal height)
    if len(rows) < 3:
        log.debug("  [mm rows] scan failed, using fixed 8-row geometry")
        row_h = (MM_TABLE_Y_END - MM_TABLE_Y_START) / 8
        rows = [(MM_TABLE_Y_START + i * row_h,
                 MM_TABLE_Y_START + (i + 1) * row_h) for i in range(8)]

    return rows


def _synergies_from_units(unit_names: list[str], units_data: dict) -> str:
    """Count synergies by summing each unit's synergy memberships.

    Returns 'Warlock:4|Demon Hunter:2|...' sorted by count descending.

    NOTE: This only counts synergies from the units on board. Certain relics
    act as phantom synergy contributors (e.g. Minotaur Horn = +1 Tauren,
    Spider Legs = +1 Aqir, Wheel = varies) and will cause the actual in-game
    synergy threshold to appear higher than what this function returns.
    Callers should treat these counts as a lower bound.
    """
    from collections import Counter
    counts: Counter = Counter()
    for name in unit_names:
        unit = units_data.get(name)
        if unit:
            for syn in unit.get("synergies", []):
                counts[syn] += 1
    pairs = sorted(counts.items(), key=lambda x: -x[1])
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


def _parse_my_matches_row(
    img: np.ndarray,
    row_y0: float,
    row_y1: float,
    unit_templates: dict[str, list[np.ndarray]],
    relic_templates: dict[str, list[np.ndarray]],
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

    # 1. Placement OCR — "#X/8" text, large digit in bottom half of cell
    place_cell = _crop(img, MM_COL_PLACEMENT[0], row_y0 + (row_y1 - row_y0) * 0.15,
                       MM_COL_PLACEMENT[1], row_y0 + (row_y1 - row_y0) * 0.75)
    place_proc = _preprocess_for_ocr(place_cell, scale=3.0)
    _save_debug(f"mm_place_{row_idx}", place_proc, debug)
    place_raw = _ocr(place_proc, psm=7, whitelist="0123456789#/")
    # Parse "#X/Y" pattern — take the first single digit (the placement)
    m = re.search(r"#?(\d)\s*/", place_raw)
    if m:
        result["placement"] = m.group(1)
    else:
        # Fallback: find "X/Y" pattern
        m2 = re.search(r"(\d)\s*/\s*\d", place_raw)
        if m2:
            result["placement"] = m2.group(1)
    if not result["placement"]:
        m3 = re.search(r"#(\d)", place_raw)
        if m3 and 1 <= int(m3.group(1)) <= 8:
            result["placement"] = m3.group(1)
    if not result["placement"]:
        # Last resort: lone digit 1-8
        m4 = re.search(r"\b([1-8])\b", place_raw)
        if m4:
            result["placement"] = m4.group(1)
    log.debug(f"  [row {row_idx}] placement OCR: {place_raw!r} → {result['placement']!r}")
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
    # 4. Synergies derived from units (use raw names without star suffixes)
    if unit_names_raw and units_data:
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
    return result


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
    # Find row boundaries
    rows = _find_my_matches_rows(img, debug=debug)
    log.info(f"[mm] Detected {len(rows)} rows")

    parsed = []
    for i, (y0, y1) in enumerate(rows):
        log.debug(f"\n[mm] --- Row {i} (y={y0:.3f}-{y1:.3f}) ---")
        row_data = _parse_my_matches_row(
            img, y0, y1,
            unit_templates, relic_templates, units_data, stem_to_name,
            debug=debug, row_idx=i,
        )
        # Skip rows where we got nothing useful (empty rows at bottom of table)
        if not (row_data["placement"] or (len(row_data["units"]) >= 3 and row_data["wl"])):
            log.debug(f"  [row {i}] insufficient data, skipping")
            continue
        parsed.append(row_data)

    log.info(f"[mm] Parsed {len(parsed)} non-empty rows")
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

    icons_dir = Path(__file__).parent.parent / "data" / "icons"
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
