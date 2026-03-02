"""Deterministic CV parsing for DAC end-of-game screenshots.

Replaces Ollama vision calls for structured GAME OVER table screenshots.
Uses OpenCV template matching for synergy/relic icons and pytesseract for
numeric fields (placement, level, W-L).

Usage (dev test):
    python cv_parser.py /path/to/screenshot.jpg [player_name] [--debug]
"""

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
MM_COL_UNITS     = (0.480, 0.597)
MM_COL_SYNERGY   = (0.597, 0.692)
MM_COL_RELIC     = (0.682, 0.738)
MM_COL_GOLD      = (0.692, 0.752)
MM_COL_WL        = (0.752, 0.792)
MM_COL_RANK      = (0.792, 0.863)

UNIT_ICON_SCALES    = [24, 28, 32, 36, 40, 44]
UNIT_MATCH_THRESHOLD = 0.65


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
        if debug:
            print(f"  row {i} OCR (thresh): {text!r}")
        if pname in text:
            return i

        # Strategy 2: raw grayscale upscale (no binarisation)
        text2 = _ocr_cell(cell)
        if debug:
            print(f"  row {i} OCR (raw):    {text2!r}")
        if pname in text2:
            return i

    # Strategy 3: overlapping windows (half-row offset) to catch names
    # split across row boundaries
    if debug:
        print("  Trying overlapping windows...")
    row_h = (TABLE_Y_END - TABLE_Y_START) / N_ROWS
    for i in range(N_ROWS - 1):
        y0 = TABLE_Y_START + (i + 0.5) * row_h
        y1 = y0 + row_h
        cell = _crop_row(img, COL_PLAYER, y0, y1)
        processed = _preprocess_for_ocr(cell, scale=2.0)
        text = _ocr(processed, psm=6).lower()
        if debug:
            print(f"  overlap {i}-{i+1} OCR: {text!r}")
        if pname in text:
            # Name straddles boundary — assign to the row with more overlap
            # (i+1 since name starts at bottom of row i)
            return i + 1

    if debug:
        print(f"  WARNING: player '{player_name}' not found in table")
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
    if debug:
        for name, score, x, y in kept:
            print(f"    match: {name:20s} score={score:.3f} pos=({x},{y})")
    return kept


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
    if debug:
        print(f"    Count strip OCR raw: {raw!r}")

    # Extract all digits from "(N)" patterns
    # The OCR may mangle parentheses, so just find all isolated digits
    all_counts = re.findall(r"\d+", raw)
    counts = [int(d) for d in all_counts if 1 <= int(d) <= 12]
    if debug:
        print(f"    Parsed counts: {counts}")

    # Associate counts left-to-right with matches left-to-right
    results = []
    for i, (name, score, x, y) in enumerate(matches):
        count = counts[i] if i < len(counts) else 0
        if debug:
            print(f"    {name} → count={count}")
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
        if debug:
            print(f"  [rank panel] row {i}: {text!r}")
        if pname in text.lower():
            player_row = i
            break

    if player_row is None:
        if debug:
            print(f"  [rank panel] player '{player_name}' not found in sidebar")
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
            if debug:
                print(f"  [rank panel] found rank={rank!r} in: {text!r}")
            return rank

    if debug:
        print("  [rank panel] rank word not found near player row")
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
    if debug:
        print(f"Image: {w}×{h}")

    # 1. Find player row
    print("[cv] Finding player row...")
    row_idx = _find_player_row(img, player_name, debug=debug)
    if row_idx is None:
        print(f"[cv] ERROR: could not find player '{player_name}' in table")
        return None
    y0, y1 = _row_y_extent(row_idx)
    print(f"[cv] Player found in row {row_idx + 1} (y={y0:.3f}-{y1:.3f})")

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
    if debug:
        print(f"  Level OCR: {level_raw!r} → {level!r}")

    # 4. OCR W-L
    wl_cell = _crop_row(img, COL_WL, y0, y1)
    wl_proc = _preprocess_for_ocr(wl_cell, scale=3.0)
    _save_debug("wl_cell", wl_proc, debug)
    wl_raw = _ocr(wl_proc, psm=7, whitelist="0123456789-")
    wl_match = re.search(r"(\d{1,3})\s*[-–]\s*(\d{1,3})", wl_raw)
    wl = f"{wl_match.group(1)}-{wl_match.group(2)}" if wl_match else ""
    if debug:
        print(f"  W-L OCR: {wl_raw!r} → {wl!r}")

    # 5. Template match synergies
    print("[cv] Matching synergy icons...")
    syn_cell = _crop_row(img, COL_SYNERGY, y0, y1)
    _save_debug("synergy_cell", syn_cell, debug)
    syn_templates = _load_templates_multiscale(icons_dir / "synergies", SYNERGY_ICON_SCALES)
    if debug:
        print(f"  Loaded {len(syn_templates)} synergy templates at scales {SYNERGY_ICON_SCALES}")
    syn_matches = _match_templates_multiscale(syn_cell, syn_templates,
                                               y_max_frac=SYNERGY_BADGE_Y_MAX_FRAC,
                                               debug=debug)
    avg_icon_px = SYNERGY_ICON_SCALES[len(SYNERGY_ICON_SCALES) // 2]
    syn_counts = _ocr_synergy_counts(syn_cell, syn_matches, avg_icon_px, debug=debug)
    synergies = "|".join(f"{name}:{count}" for name, count in syn_counts if count > 0)
    if not synergies:
        # If count OCR failed, still report names with count 0
        synergies = "|".join(f"{name}:0" for name, _, _, _ in syn_matches)

    # 6. Template match relics
    print("[cv] Matching relic icons...")
    relic_cell = _crop_row(img, COL_RELIC, y0, y1)
    _save_debug("relic_cell", relic_cell, debug)
    relic_templates = _load_templates_multiscale(icons_dir / "relics", RELIC_ICON_SCALES,
                                                  inner_frac=1.0, color=True)
    if debug:
        print(f"  Loaded {len(relic_templates)} relic templates at scales {RELIC_ICON_SCALES}")
    relic_matches = _match_templates_multiscale(relic_cell, relic_templates, threshold=0.45,
                                                 color=True, debug=debug)
    # Keep best score per unique relic name, take top 5
    best_per_name: dict[str, float] = {}
    for name, score, x, y in relic_matches:
        if name not in best_per_name or score > best_per_name[name]:
            best_per_name[name] = score
    ranked = sorted(best_per_name.items(), key=lambda x: -x[1])[:5]
    relic = "|".join(name.replace("_", " ").title() for name, score in ranked)
    if debug:
        print(f"  Relic ranking: {[(n, f'{s:.3f}') for n, s in ranked]}")

    # 7. Extract rank from left sidebar
    rank = extract_rank_from_panel(img, player_name, debug=debug)
    if debug:
        print(f"  Rank: {rank!r}")

    result = {
        "placement": str(placement),
        "level": level,
        "wl": wl,
        "synergies": synergies,
        "relic": relic,
        "rank": rank,
    }
    print(f"[cv] Result: {result}")
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

    # Find contiguous dark bands (separators)
    in_dark = False
    band_start = 0
    sep_centers: list[int] = []
    for i, val in enumerate(row_means):
        if val < MM_SEP_DARK_THRESH and not in_dark:
            in_dark = True
            band_start = i
        elif val >= MM_SEP_DARK_THRESH and in_dark:
            in_dark = False
            band_end = i
            if band_end - band_start >= 2:
                sep_centers.append((band_start + band_end) // 2 + y0_px)

    if debug:
        print(f"  [mm rows] found {len(sep_centers)} separators at y={sep_centers}")

    rows: list[tuple[float, float]] = []
    if len(sep_centers) >= 3:
        # Compute median row height from detected separators
        gaps = [sep_centers[i + 1] - sep_centers[i]
                for i in range(len(sep_centers) - 1)
                if sep_centers[i + 1] - sep_centers[i] > h * 0.02]
        row_h_px = int(np.median(gaps)) if gaps else int(h * 0.075)

        # Build rows from detected separators
        for i in range(len(sep_centers) - 1):
            r_y0 = sep_centers[i] / h
            r_y1 = sep_centers[i + 1] / h
            if r_y1 - r_y0 > 0.02:
                rows.append((r_y0, r_y1))

        # Extrapolate beyond last detected separator using median row height.
        # Allow partial rows (at least 50% of row height remaining).
        last_sep = sep_centers[-1]
        while last_sep + row_h_px * 0.5 < h:
            r_y0 = last_sep / h
            r_y1 = min((last_sep + row_h_px) / h, 1.0)
            rows.append((r_y0, r_y1))
            last_sep += row_h_px

        if debug:
            print(f"  [mm rows] row height={row_h_px}px, extrapolated to {len(rows)} total rows")

    # Fallback: fixed geometry (assume 8 rows of equal height)
    if len(rows) < 3:
        if debug:
            print("  [mm rows] scan failed, using fixed 8-row geometry")
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
    if debug:
        print(f"  [row {row_idx}] placement OCR: {place_raw!r} → {result['placement']!r}")

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
    if debug:
        print(f"  [row {row_idx}] level OCR: {level_raw!r} → {result['level']!r}")

    # 3. Unit icon matching
    unit_region = _crop(img, MM_COL_UNITS[0], row_y0,
                        MM_COL_UNITS[1], row_y0 + (row_y1 - row_y0) * 0.65)
    _save_debug(f"mm_units_{row_idx}", unit_region, debug)
    matches = _match_templates_multiscale(
        unit_region, unit_templates,
        threshold=UNIT_MATCH_THRESHOLD,
        y_max_frac=0.60,
        debug=debug,
    )
    unit_names_raw = [stem_to_name.get(stem, stem) for stem, _, _, _ in matches]

    # Detect star levels by counting colored squares below each unit icon
    unit_names = []
    ur_h, ur_w = unit_region.shape[:2]
    hsv_region = cv2.cvtColor(unit_region, cv2.COLOR_BGR2HSV) if len(unit_region.shape) == 3 else None
    for ui, (stem, score, ux, uy) in enumerate(matches):
        name = stem_to_name.get(stem, stem)
        stars = 1  # default
        if hsv_region is not None:
            # Estimate icon size from scale list midpoint
            icon_h = UNIT_ICON_SCALES[len(UNIT_ICON_SCALES) // 2]
            # Star squares sit just below the icon
            sy0 = min(uy + icon_h, ur_h)
            sy1 = min(sy0 + 10, ur_h)
            sx0 = max(ux - 2, 0)
            sx1 = min(ux + icon_h + 2, ur_w)
            if sy1 > sy0 and sx1 > sx0:
                star_strip = hsv_region[sy0:sy1, sx0:sx1]
                s_ch = star_strip[:, :, 1]  # saturation
                v_ch = star_strip[:, :, 2]  # value
                # Bright saturated pixels = colored squares
                bright_mask = ((s_ch > 80) & (v_ch > 100)).astype(np.uint8) * 255
                # Count distinct square blobs via horizontal projection
                col_sum = bright_mask.mean(axis=0)  # mean brightness per column
                # Find runs of bright columns (each square is a contiguous run)
                in_square = False
                n_squares = 0
                for val in col_sum:
                    if val > 80 and not in_square:
                        in_square = True
                        n_squares += 1
                    elif val <= 80:
                        in_square = False
                if 1 <= n_squares <= 3:
                    stars = n_squares
                if debug:
                    print(f"    star detect {name}: squares={n_squares} → {stars}★")
        unit_names.append(f"{name}({stars})" if stars > 1 else name)

    result["units"] = unit_names
    if debug:
        print(f"  [row {row_idx}] units ({len(unit_names)}): {unit_names}")

    # 4. Synergies derived from units (use raw names without star suffixes)
    if unit_names_raw and units_data:
        result["synergies"] = _synergies_from_units(unit_names_raw, units_data)
    if debug:
        print(f"  [row {row_idx}] synergies: {result['synergies']!r}")

    # 5. Relic icon matching
    relic_cell = _crop(img, MM_COL_RELIC[0], row_y0, MM_COL_RELIC[1], row_y1)
    _save_debug(f"mm_relic_{row_idx}", relic_cell, debug)
    if relic_templates:
        relic_matches = _match_templates_multiscale(
            relic_cell, relic_templates, threshold=0.45,
            color=True, debug=debug,
        )
        # Keep best score per unique relic name
        best_per_name: dict[str, float] = {}
        for name, score, x, y in relic_matches:
            if name not in best_per_name or score > best_per_name[name]:
                best_per_name[name] = score
        ranked = sorted(best_per_name.items(), key=lambda x: -x[1])[:5]
        result["relic"] = "|".join(name.replace("_", " ").title() for name, _ in ranked)
        if debug:
            print(f"  [row {row_idx}] relics: {[(n, f'{s:.3f}') for n, s in ranked]}")

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
    if debug:
        print(f"  [row {row_idx}] wl OCR: {wl_raw!r} → {result['wl']!r}")

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
    if debug:
        print(f"  [row {row_idx}] rank OCR: {rank_raw!r} → {result['rank']!r}")

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
    if debug:
        print(f"[mm] Image: {w}×{h}")

    # Load units data if not provided
    if units_data is None:
        data_dir = Path(__file__).parent.parent / "data"
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
    print(f"[mm] Loading unit templates from {units_icons_dir}...")
    unit_templates = _load_templates_multiscale(units_icons_dir, UNIT_ICON_SCALES,
                                                 inner_frac=0.85)
    if not unit_templates:
        print(f"[mm] WARNING: no unit icons found in {units_icons_dir}")
        print("     Run: python download_unit_icons.py")

    # Load relic icon templates
    relic_templates = _load_templates_multiscale(icons_dir / "relics", RELIC_ICON_SCALES,
                                                  inner_frac=1.0, color=True)
    if debug:
        print(f"[mm] Loaded {len(relic_templates)} relic templates")

    # Find row boundaries
    rows = _find_my_matches_rows(img, debug=debug)
    print(f"[mm] Detected {len(rows)} rows")

    parsed = []
    for i, (y0, y1) in enumerate(rows):
        if debug:
            print(f"\n[mm] --- Row {i} (y={y0:.3f}-{y1:.3f}) ---")
        row_data = _parse_my_matches_row(
            img, y0, y1,
            unit_templates, relic_templates, units_data, stem_to_name,
            debug=debug, row_idx=i,
        )
        # Skip rows where we got nothing useful (empty rows at bottom of table)
        if not (row_data["placement"] or (len(row_data["units"]) >= 3 and row_data["wl"])):
            if debug:
                print(f"  [row {i}] insufficient data, skipping")
            continue
        parsed.append(row_data)

    print(f"[mm] Parsed {len(parsed)} non-empty rows")
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
