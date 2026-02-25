"""Watch Steam screenshot folder for new DAC end-game screenshots.

Monitors the folder for new .jpg files. When one appears, runs CV detection
to check if it's a Final Ranking or Game Over screen. If so, extracts
placement and rank, appends to CSV.

Usage:
    python watcher.py                # start watching
    python watcher.py <file.jpg>     # parse a single file (test mode)
"""

import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import pytesseract

from csv_writer import GameRow, append_row

# ── Config ───────────────────────────────────────────────────────────────────

DAC_DIR = Path.home() / ".dac"
CONFIG_PATH = DAC_DIR / "config.json"
GAMES_CSV = DAC_DIR / "games.csv"

# Screenshot directory — local test data + any new screenshots dropped here
STEAM_SCREENSHOTS = Path(__file__).parent.parent / "data" / "screenshots"

# Detection zone: the "eliminated" area (left side of screen)
# Contains: "Final Ranking X/8", rank, player name
DETECT_ZONE = (0.0, 0.10, 0.15, 0.60)  # x0, y0, x1, y1 as fractions

POLL_INTERVAL = 3  # seconds between checks


# ── OCR helpers ──────────────────────────────────────────────────────────────

def _crop(img, x0f, y0f, x1f, y1f):
    h, w = img.shape[:2]
    return img[int(h * y0f):int(h * y1f), int(w * x0f):int(w * x1f)]


def _ocr(img, psm=6):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    h, w = gray.shape[:2]
    if h < 50:
        gray = cv2.resize(gray, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    try:
        return pytesseract.image_to_string(thresh, config=f"--psm {psm}").strip()
    except Exception:
        return ""


# ── Detection ────────────────────────────────────────────────────────────────

def _ocr_big_digit(img, x0f, y0f, x1f, y1f) -> str:
    """Extract a single large digit from a region.

    Thresholds bright pixels, finds the largest blob, scales it down
    to normal text size, and OCRs with digit whitelist.
    """
    crop = _crop(img, x0f, y0f, x1f, y1f)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
    _, bright = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
    coords = cv2.findNonZero(bright)
    if coords is None:
        return ""
    x, y, bw, bh = cv2.boundingRect(coords)
    if bh < 10 or bw < 5:
        return ""
    digit = bright[y:y + bh, x:x + bw]
    # Scale to ~30px height (sweet spot for Tesseract)
    target_h = 30
    scale = target_h / bh
    small = cv2.resize(digit, (max(int(bw * scale), 1), target_h),
                       interpolation=cv2.INTER_AREA)
    inv = cv2.bitwise_not(small)
    inv = cv2.copyMakeBorder(inv, 15, 15, 15, 15, cv2.BORDER_CONSTANT, value=255)
    text = pytesseract.image_to_string(
        inv, config="--psm 10 -c tessedit_char_whitelist=12345678"
    ).strip()
    return text


def _ocr_white_text(img, x0f, y0f, x1f, y1f, psm=7, threshold=200) -> str:
    """OCR white/bright text on dark background."""
    crop = _crop(img, x0f, y0f, x1f, y1f)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
    _, bright = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)
    scaled = cv2.resize(bright, (bright.shape[1] * 3, bright.shape[0] * 3),
                        interpolation=cv2.INTER_NEAREST)
    inv = cv2.bitwise_not(scaled)
    try:
        return pytesseract.image_to_string(inv, config=f"--psm {psm}").strip()
    except Exception:
        return ""


# ── Final Ranking panel region (calibrated on 3440×1440) ─────────────────────
# Single crop containing "Final Ranking 4/8", the gold placement digit, and rank.
# Coords from coord_picker: x=0-13.5%, y=21-51.5%
FR_X0, FR_Y0, FR_X1, FR_Y1 = 0.000, 0.210, 0.135, 0.515


def parse_final_ranking(image_path: Path) -> dict | None:
    """Check if image is a Final Ranking screen and extract placement + rank.

    Final Ranking is the PRIMARY end-game screen — appears reliably for
    every outcome (win or lose). Game Over table is the secondary fallback.

    Returns dict with keys: placement, rank, rank_change
    or None if not a recognised end-game screen.
    """
    img = cv2.imread(str(image_path))
    if img is None:
        return None

    h, w = img.shape[:2]
    panel = _crop(img, FR_X0, FR_Y0, FR_X1, FR_Y1)
    ph, pw = panel.shape[:2]

    # ── 1. Detect: "Final Ranking" text anywhere in the panel ────────────────
    gray = cv2.cvtColor(panel, cv2.COLOR_BGR2GRAY)
    is_final = False
    for thresh in (160, 130, 100):
        _, bright = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
        scaled = cv2.resize(bright, (pw * 3, ph * 3), interpolation=cv2.INTER_CUBIC)
        try:
            text = pytesseract.image_to_string(scaled, config="--psm 6").lower()
        except Exception:
            continue
        if "final" in text and "rank" in text:
            is_final = True
            break

    if not is_final:
        # FALLBACK: Game Over table (synergies / W-L / level)
        try:
            from cv_parser import detect_screen_type, parse_game_over
            if detect_screen_type(img) == "game_over":
                icons_dir = Path(__file__).parent.parent / "data" / "icons"
                config = _load_config()
                return parse_game_over(
                    img, config.get("player_name", "jack"), icons_dir
                )
        except Exception as e:
            print(f"[watcher] Game Over parse failed: {e}")
        return None

    # ── 2. Placement: lime-yellow digit — isolate by color, find bbox, OCR ───
    # The digit is rendered in bright lime-yellow: BGR ≈ (120-190, 230-255, 230-255)
    placement = ""
    lime = cv2.inRange(panel,
                       np.array([120, 230, 230]),
                       np.array([190, 255, 255]))
    coords = cv2.findNonZero(lime)
    if coords is not None and len(coords) >= 10:
        dx, dy, dw, dh = cv2.boundingRect(coords)
        pad = 10
        digit_crop = lime[max(0, dy - pad):dy + dh + pad,
                          max(0, dx - pad):dx + dw + pad]
        big = cv2.resize(digit_crop, (digit_crop.shape[1] * 4, digit_crop.shape[0] * 4),
                         interpolation=cv2.INTER_NEAREST)
        inv = cv2.copyMakeBorder(cv2.bitwise_not(big), 20, 20, 20, 20,
                                 cv2.BORDER_CONSTANT, value=255)
        try:
            placement = pytesseract.image_to_string(
                inv, config="--psm 8 -c tessedit_char_whitelist=12345678"
            ).strip()
        except Exception:
            pass
    if not placement:
        print("[watcher] WARNING: could not read placement digit")

    # ── 3. Rank: white text in lower half of panel ("Bishop-1▼") ─────────────
    rank = ""
    lower = panel[ph // 2:, :]
    lh, lw = lower.shape[:2]
    _, bright_rank = cv2.threshold(
        cv2.cvtColor(lower, cv2.COLOR_BGR2GRAY), 200, 255, cv2.THRESH_BINARY
    )
    scaled_r = cv2.resize(bright_rank, (lw * 3, lh * 3), interpolation=cv2.INTER_CUBIC)
    inv_r = cv2.copyMakeBorder(cv2.bitwise_not(scaled_r), 10, 10, 10, 10,
                               cv2.BORDER_CONSTANT, value=255)
    try:
        rank_text = pytesseract.image_to_string(inv_r, config="--psm 7").strip()
    except Exception:
        rank_text = ""

    m = re.search(r"(Pawn|Knight|Bishop|Rook|King|Queen)[\s-]*(\d)",
                  rank_text, re.IGNORECASE)
    if m:
        rank = f"{m.group(1).title()}-{m.group(2)}"

    # ── 4. Rank change arrow: red ▼ = down, green ▲ = up ─────────────────────
    # Detected by color — no OCR needed.
    red_px   = cv2.inRange(panel, np.array([0,   0, 180]), np.array([60,  60, 255]))
    green_px = cv2.inRange(panel, np.array([0, 180,   0]), np.array([60, 255,  60]))
    if np.count_nonzero(red_px) > 20:
        rank_change = "down"
    elif np.count_nonzero(green_px) > 20:
        rank_change = "up"
    else:
        rank_change = "none"

    return {
        "placement": placement,
        "rank": rank,
        "rank_change": rank_change,
    }


# ── Config ───────────────────────────────────────────────────────────────────

def _load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {"player_name": "jack"}


# ── File watcher ─────────────────────────────────────────────────────────────

def _timestamp_from_filename(name: str) -> str:
    """Extract datetime from Steam screenshot filename like '20260205025343_1.jpg'."""
    match = re.match(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})", name)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)} {match.group(4)}:{match.group(5)}:{match.group(6)}"
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def process_screenshot(path: Path) -> GameRow | None:
    """Process a single screenshot. Returns GameRow or None."""
    print(f"[watcher] Processing: {path.name}")

    result = parse_final_ranking(path)
    if result is None:
        print(f"[watcher] Not a Final Ranking or Game Over screen, skipping.")
        return None

    date_str = _timestamp_from_filename(path.name)
    placement = result.get("placement", "")
    rank = result.get("rank", "")
    rank_change = result.get("rank_change", "")

    notes_parts = []
    if rank:
        notes_parts.append(f"rank:{rank}")
    if rank_change:
        notes_parts.append(f"change:{rank_change}")

    row = GameRow(
        date=date_str,
        placement=placement,
        comp="",
        synergies=result.get("synergies", ""),
        talents="",
        relic=result.get("relic", ""),
        level=result.get("level", ""),
        wl=result.get("wl", ""),
        screenshot=path.name,
        notes="|".join(notes_parts),
    )
    return row


def watch(screenshot_dir: Path, games_csv: Path) -> None:
    """Watch screenshot directory for new files and process them."""
    if not screenshot_dir.exists():
        print(f"[watcher] ERROR: Screenshot directory not found: {screenshot_dir}")
        sys.exit(1)

    # Track known files
    known = set(f.name for f in screenshot_dir.glob("*.jpg"))
    print(f"[watcher] Watching {screenshot_dir}")
    print(f"[watcher] {len(known)} existing screenshots (ignored)")
    print(f"[watcher] CSV: {games_csv}")
    print(f"[watcher] Polling every {POLL_INTERVAL}s... (Ctrl+C to stop)")

    try:
        while True:
            time.sleep(POLL_INTERVAL)
            current = set(f.name for f in screenshot_dir.glob("*.jpg"))
            new_files = current - known
            for name in sorted(new_files):
                path = screenshot_dir / name
                # Wait a moment for file to finish writing
                time.sleep(0.5)
                row = process_screenshot(path)
                if row:
                    append_row(row, games_csv)
                    print(f"[watcher] ✓ Saved: placement={row.placement} {row.notes}")
                known.add(name)
    except KeyboardInterrupt:
        print("\n[watcher] Stopped.")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) > 1:
        # Test mode: parse a single file
        path = Path(sys.argv[1])
        if not path.exists():
            print(f"File not found: {path}")
            sys.exit(1)
        row = process_screenshot(path)
        if row:
            print(f"\n  date:      {row.date}")
            print(f"  placement: {row.placement}")
            print(f"  notes:     {row.notes}")
        else:
            print("Could not parse.")
    else:
        config = _load_config()
        games_csv = Path(config.get("games_csv", str(GAMES_CSV))).expanduser()
        watch(STEAM_SCREENSHOTS, games_csv)


if __name__ == "__main__":
    main()
