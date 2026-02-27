"""DAC Game Tracker — CLI entry point.

Usage:
    python main.py import <file> [--dry-run]
    python main.py import-history <screenshot> [--dry-run]
    python main.py import-screenshots [dir] [--dry-run]
    python main.py import-matches-cv <screenshot> [--dry-run] [--debug]
    python main.py parse-cv <screenshot> [--debug]
"""

import sys
from datetime import datetime
from pathlib import Path

from utils import GAMES_CSV, ICONS_DIR, load_config


def cmd_import(args: list[str]) -> None:
    """Handle: python main.py import <file> [--dry-run]"""
    import importer

    if not args:
        print("Usage: python main.py import <source_csv> [--dry-run]")
        sys.exit(1)

    src = Path(args[0])
    dry_run = "--dry-run" in args

    config = load_config()
    games_csv = Path(config.get("games_csv", str(GAMES_CSV))).expanduser()
    importer.import_csv(src, games_csv, dry_run=dry_run)


def cmd_import_history(args: list[str]) -> None:
    """Handle: python main.py import-history <screenshot> [--dry-run]

    Parse a MY MATCHES history screenshot and import all visible rows.
    Screenshot multiple pages and run this command for each.
    """
    import parser as game_parser
    import csv_writer

    if not args:
        print("Usage: python main.py import-history <screenshot.jpg> [--dry-run]")
        sys.exit(1)

    screenshot_path = Path(args[0])
    dry_run = "--dry-run" in args

    if not screenshot_path.exists():
        print(f"[tracker] ERROR: File not found: {screenshot_path}")
        sys.exit(1)

    config = load_config()
    games_csv = Path(config.get("games_csv", str(GAMES_CSV))).expanduser()
    date_str = datetime.now().strftime("%Y-%m-%d")

    print(f"[tracker] Parsing history screenshot: {screenshot_path.name}")
    rows = game_parser.parse_history_screenshot(
        image_path=screenshot_path,
        player_name=config.get("player_name", "jack"),
        screenshot_date=date_str,
        model=config.get("model", "qwen2.5vl:7b"),
        ollama_url=config.get("ollama_url", "http://localhost:11434"),
    )

    if not rows:
        print("[tracker] No rows parsed.")
        return

    if dry_run:
        print(f"[tracker] DRY RUN — would import {len(rows)} row(s):")
        for r in rows:
            print(f"  placement={r.placement}  level={r.level}  wl={r.wl}  synergies={r.synergies}  notes={r.notes}")
    else:
        for row in rows:
            csv_writer.append_row(row, games_csv)
        print(f"[tracker] Imported {len(rows)} row(s) into {games_csv}")


def cmd_import_screenshots(args: list[str]) -> None:
    """Handle: python main.py import-screenshots [dir] [--dry-run]

    Batch-parse all end-game screenshots in a directory (Final Ranking or
    Game Over screens) and append new rows to games.csv. Already-imported
    screenshots (matched by filename) are skipped.
    """
    import csv_writer
    from watcher import process_screenshot

    dry_run = "--dry-run" in args
    remaining = [a for a in args if not a.startswith("--")]
    shots_dir = Path(remaining[0]) if remaining else Path(__file__).parent.parent / "data" / "screenshots"

    if not shots_dir.exists():
        print(f"[tracker] ERROR: directory not found: {shots_dir}")
        sys.exit(1)

    config = load_config()
    games_csv = Path(config.get("games_csv", str(GAMES_CSV))).expanduser()

    # Build set of already-imported screenshot filenames to avoid duplicates
    existing = set()
    existing_rows = csv_writer.read_all(games_csv)
    for r in existing_rows:
        if r.screenshot:
            existing.add(r.screenshot)

    shots = sorted(shots_dir.glob("*.jpg")) + sorted(shots_dir.glob("*.png"))
    print(f"[tracker] Scanning {len(shots)} screenshots in {shots_dir}")
    print(f"[tracker] {len(existing)} already imported, skipping those")

    imported = skipped = failed = 0
    for path in shots:
        if path.name in existing:
            skipped += 1
            continue
        row = process_screenshot(path)
        if row is None:
            failed += 1
            continue
        if dry_run:
            print(f"  DRY RUN  {path.name}: place={row.placement} {row.notes}")
        else:
            csv_writer.append_row(row, games_csv)
            print(f"  ✓ {path.name}: place={row.placement} {row.notes}")
        imported += 1

    print(f"\n[tracker] Done — {imported} imported, {skipped} skipped, {failed} not recognised")
    if dry_run:
        print("[tracker] (dry run — nothing written)")


def cmd_import_matches_cv(args: list[str]) -> None:
    """Handle: python main.py import-matches-cv <screenshot> [--dry-run] [--debug]

    Parse a MY MATCHES history screenshot using unit icon CV (no Ollama).
    Falls back to Ollama if CV returns no rows.

    NOTE: synergy counts derived from units only — relics that add phantom
    synergy members (Minotaur Horn, Spider Legs, Wheel, etc.) will cause the
    real in-game counts to be higher than what is recorded here.
    """
    import csv_writer
    from cv_parser import parse_my_matches, detect_screen_type
    import cv2

    if not args:
        print("Usage: python main.py import-matches-cv <screenshot.jpg> [--dry-run] [--debug]")
        sys.exit(1)

    screenshot_path = Path(args[0])
    dry_run = "--dry-run" in args
    debug = "--debug" in args

    if not screenshot_path.exists():
        print(f"[tracker] ERROR: File not found: {screenshot_path}")
        sys.exit(1)

    config = load_config()
    games_csv = Path(config.get("games_csv", str(GAMES_CSV))).expanduser()
    player_name = config.get("player_name", "jack")

    img = cv2.imread(str(screenshot_path))
    if img is None:
        print(f"[tracker] ERROR: Cannot read image: {screenshot_path}")
        sys.exit(1)

    screen_type = detect_screen_type(img)
    print(f"[tracker] Screen type: {screen_type}")

    if screen_type != "my_matches":
        print(f"[tracker] ERROR: Expected 'my_matches' screen, got '{screen_type}'")
        print("          Use import-history for Ollama-based parsing.")
        sys.exit(1)

    print(f"[tracker] Parsing MY MATCHES: {screenshot_path.name}")
    rows = parse_my_matches(img, player_name, ICONS_DIR, debug=debug)

    if not rows:
        print("[tracker] CV returned no rows.")
        sys.exit(1)

    date_str = datetime.now().strftime("%Y-%m-%d")

    # Convert CV row dicts to GameRow objects
    game_rows = []
    for r in rows:
        from csv_writer import GameRow
        comp = "|".join(r.get("units", []))
        game_rows.append(GameRow(
            date=date_str,
            placement=r.get("placement", ""),
            level=r.get("level", ""),
            comp=comp,
            synergies=r.get("synergies", ""),
            relic="",
            wl=r.get("wl", ""),
            rank=r.get("rank", ""),
            screenshot=screenshot_path.name,
            notes="cv:unit_match",
        ))

    if dry_run:
        print(f"[tracker] DRY RUN — would import {len(game_rows)} row(s):")
        for r in game_rows:
            print(f"  placement={r.placement}  level={r.level}  wl={r.wl}  "
                  f"units={len(r.comp.split('|')) if r.comp else 0}  "
                  f"synergies={r.synergies[:60]}...")
    else:
        for row in game_rows:
            csv_writer.append_row(row, games_csv)
        print(f"[tracker] Imported {len(game_rows)} row(s) into {games_csv}")


def cmd_parse_cv(args: list[str]) -> None:
    """Handle: python main.py parse-cv <screenshot> [--debug]

    Parse a single screenshot with CV and print results (does not write CSV).
    """
    import parser as game_parser

    if not args:
        print("Usage: python main.py parse-cv <screenshot.jpg> [--debug]")
        sys.exit(1)

    screenshot_path = Path(args[0])
    debug = "--debug" in args

    if not screenshot_path.exists():
        print(f"[tracker] ERROR: File not found: {screenshot_path}")
        sys.exit(1)

    config = load_config()
    player_name = config.get("player_name", "jack")
    date_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    from cv_parser import parse_screenshot_cv as cv_parse
    result = cv_parse(screenshot_path, player_name, ICONS_DIR, debug=debug)
    if result is None:
        print("[tracker] CV parse failed.")
        sys.exit(1)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "import":
        cmd_import(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "import-history":
        cmd_import_history(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "import-screenshots":
        cmd_import_screenshots(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "import-matches-cv":
        cmd_import_matches_cv(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "parse-cv":
        cmd_parse_cv(sys.argv[2:])
    else:
        print(__doc__.strip())
        sys.exit(1)


if __name__ == "__main__":
    main()
