"""Backfill: scan Steam screenshots, parse My Matches, push to Supabase.

Usage:
    python backfill.py <screenshot_dir> [--dry-run]
"""

import logging
import re
import sys
from datetime import datetime
from pathlib import Path

import cv2

# Add tracker dir to path
sys.path.insert(0, str(Path(__file__).parent))

from cv_parser import detect_screen_type, parse_my_matches, infer_timestamps
from db import push_game, game_exists
from models import GameRow
from utils import load_config, ICONS_DIR

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-5s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("dac")
# Suppress debug noise during bulk import
log.setLevel(logging.INFO)


def datetime_from_filename(name: str) -> datetime | None:
    """Extract datetime from Steam screenshot filename like '20260205025343_1.jpg'.

    Returns a datetime object, or None if the filename doesn't match.
    """
    m = re.match(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})", name)
    if m:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                        int(m.group(4)), int(m.group(5)), int(m.group(6)))
    return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python backfill.py <screenshot_dir> [--dry-run]")
        sys.exit(1)

    screenshot_dir = Path(sys.argv[1])
    dry_run = "--dry-run" in sys.argv

    if not screenshot_dir.exists():
        print(f"Directory not found: {screenshot_dir}")
        sys.exit(1)

    config = load_config()
    steam_id = config.get("steam_id")
    player_name = config.get("player_name", "jack")

    if not steam_id:
        print("No steam_id in config. Run the tracker first to log in.")
        sys.exit(1)

    screenshots = sorted(screenshot_dir.glob("*.jpg"))
    print(f"Found {len(screenshots)} screenshots in {screenshot_dir}")
    print(f"Player: {player_name}, Steam ID: {steam_id}")
    if dry_run:
        print("DRY RUN — not pushing to DB")
    print()

    total_imported = 0
    total_skipped = 0
    total_not_mm = 0

    for i, path in enumerate(screenshots):
        screenshot_time = datetime_from_filename(path.name)
        if not screenshot_time:
            print(f"  [{i+1}/{len(screenshots)}] {path.name}: can't parse date, skipping")
            continue

        img = cv2.imread(str(path))
        if img is None:
            print(f"  [{i+1}/{len(screenshots)}] {path.name}: can't read image, skipping")
            continue

        screen_type = detect_screen_type(img)
        if screen_type != "my_matches":
            total_not_mm += 1
            continue

        print(f"  [{i+1}/{len(screenshots)}] {path.name} — MY MATCHES ({screenshot_time.strftime('%Y-%m-%d %H:%M:%S')})")

        rows = parse_my_matches(img, player_name, ICONS_DIR)
        if not rows:
            print(f"    No rows parsed")
            continue

        timestamps = infer_timestamps(rows, screenshot_time)

        for j, (r, date_str) in enumerate(zip(rows, timestamps)):
            placement = r.get("placement", "")
            level = r.get("level", "")
            wl = r.get("wl", "")
            lineup = "|".join(r.get("units", []))
            synergies = r.get("synergies", "")
            relic = r.get("relic", "")
            rank = r.get("rank", "")
            rank_change = r.get("rank_change", "none")

            if not dry_run and game_exists(steam_id, date_str, placement, wl, level, lineup):
                print(f"    row {j+1}: SKIP duplicate (place={placement} wl={wl} level={level})")
                total_skipped += 1
                continue

            print(f"    row {j+1}: #{placement} Lv{level} {wl} {rank} units={len(r.get('units', []))} relics={relic} time={date_str}")

            if not dry_run:
                game_row = GameRow(
                    date=date_str,
                    placement=placement,
                    rank=rank,
                    rank_change=rank_change,
                    lineup=lineup,
                    synergies=synergies,
                    talents="",
                    relic=relic,
                    level=level,
                    wl=wl,
                    notes="backfill:steam_screenshots",
                )
                if push_game(game_row, user_id=steam_id):
                    total_imported += 1
                else:
                    print(f"    row {j+1}: FAILED to push")
            else:
                total_imported += 1

    print(f"\nDone. {total_imported} imported, {total_skipped} skipped, "
          f"{total_not_mm} non-My Matches screenshots ignored.")


if __name__ == "__main__":
    main()
