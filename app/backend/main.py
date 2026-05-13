"""DAC Game Tracker — CLI entry point.

Usage:
    python main.py import-matches-cv <screenshot> [--debug]
    python main.py ingest-nettable [--dry-run] [--only NAME,NAME] [--log PATH]
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from utils import ICONS_DIR, load_config


def cmd_import_matches_cv(args: list[str]) -> None:
    """Handle: python main.py import-matches-cv <screenshot> [--debug]

    Parse a MY MATCHES history screenshot using unit icon CV (no Ollama)
    and push each game to Supabase. Requires Steam login.

    NOTE: synergy counts derived from units only — relics that add phantom
    synergy members (Minotaur Horn, Spider Legs, Wheel, etc.) will cause the
    real in-game counts to be higher than what is recorded here.
    """
    from models import GameRow
    from cv_parser import parse_my_matches, detect_screen_type, infer_timestamps
    from db import game_exists, push_game
    from utils import save_config
    import cv2

    if not args:
        print("Usage: python main.py import-matches-cv <screenshot.jpg> [--debug]")
        sys.exit(1)

    screenshot_path = Path(args[0])
    debug = "--debug" in args

    if not screenshot_path.exists():
        print(f"[tracker] ERROR: File not found: {screenshot_path}")
        sys.exit(1)

    config = load_config()
    player_name = config.get("player_name", "jack")

    # Ensure Steam auth
    steam_id = config.get("steam_id")
    if not steam_id:
        import steam_auth
        print("[tracker] No steam_id in config — starting Steam login...")
        steam_id = steam_auth.steam_login()
        if not steam_id:
            print("[tracker] ERROR: Steam login failed or was declined. Aborting.")
            sys.exit(1)
        config["steam_id"] = steam_id
        display_name = steam_auth.fetch_steam_name(steam_id)
        if display_name:
            config["steam_display_name"] = display_name
            print(f"[tracker] Logged in as {display_name} ({steam_id})")
        else:
            print(f"[tracker] Logged in as {steam_id}")
        save_config(config)
        from db import ensure_user
        ensure_user(steam_id, name=display_name)

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
    screenshot_time = datetime.now()
    rows = parse_my_matches(img, player_name, ICONS_DIR, debug=debug)

    if not rows:
        print("[tracker] CV returned no rows.")
        sys.exit(1)

    timestamps = infer_timestamps(rows, screenshot_time)

    # Convert CV row dicts to GameRow objects and push to Supabase
    pushed = 0
    skipped = 0
    failed = 0
    for r, date_str in zip(rows, timestamps):
        placement = r.get("placement", "")
        level = r.get("level", "")
        wl = r.get("wl", "")
        lineup = "|".join(r.get("units", []))

        if game_exists(steam_id, date_str, placement, wl, level, lineup):
            skipped += 1
            continue
        game_row = GameRow(
            played_at=date_str,
            placement=placement,
            rank=r.get("rank", ""),
            rank_change="",
            lineup=lineup,
            synergies=r.get("synergies", ""),
            talents="",
            relic=r.get("relic", ""),
            level=level,
            wl=wl,
            notes="cv:unit_match",
        )
        if push_game(game_row, user_id=steam_id):
            pushed += 1
        else:
            failed += 1

    print(f"[tracker] Pushed {pushed} game(s) to Supabase", end="")
    if skipped:
        print(f" ({skipped} skipped as duplicates)", end="")
    if failed:
        print(f" ({failed} failed)", end="")
    print()


def cmd_ingest_nettable(args: list[str]) -> None:
    """Handle: python main.py ingest-nettable [--dry-run] [--only ...] [--log PATH]

    Decode CustomNetTable dumps from Dota's console.log and POST them to
    Supabase. Manual fallback for when the auto-ingest path inside
    headless.py isn't running.
    """
    from nettable_capture import (
        CUSTOM_NETTABLE_PREFIX,
        extract_rows,
        find_console_log,
        find_dota_dir,
        insert_dumps,
        normalize_allow,
    )

    ap = argparse.ArgumentParser(prog="main.py ingest-nettable")
    ap.add_argument("--log", type=Path, default=None,
                    help="Path to console.log (auto-detected if omitted)")
    ap.add_argument("--only", default=None,
                    help="Comma-separated tables; bare names get CustomNetTable_ prefix")
    ap.add_argument("--all-tables", action="store_true",
                    help="Don't filter to CustomNetTable_*")
    ap.add_argument("--include-errors", action="store_true",
                    help="Write rows even when VBKV decoding failed")
    ap.add_argument("--dry-run", action="store_true",
                    help="Parse and report, don't write to Supabase")
    parsed = ap.parse_args(args)

    log_path = parsed.log
    if not log_path:
        dota_dir = find_dota_dir()
        if not dota_dir:
            sys.exit("Could not find Dota install. Pass --log <path>.")
        log_path = find_console_log(dota_dir)
    if not log_path.exists():
        sys.exit(f"Log not found: {log_path}")

    print(f"Reading {log_path}")
    allow = normalize_allow(parsed.only) if parsed.only else None
    rows = extract_rows(
        log_path,
        allow=allow,
        include_errors=parsed.include_errors,
        all_tables=parsed.all_tables,
    )
    if not rows:
        sys.exit(
            "No CustomNetTable dumps found. Did you press F12 during a DAC game "
            "with `-condebug` in launch options?"
        )

    by_table: dict[str, int] = {}
    for r in rows:
        by_table[r["table_name"]] = by_table.get(r["table_name"], 0) + 1
    print(f"Found {len(rows)} unique payload(s) across {len(by_table)} table(s):")
    for t, n in sorted(by_table.items()):
        print(f"  {t}: {n}")

    if parsed.dry_run:
        return

    try:
        import httpx
    except ImportError:
        sys.exit("httpx required: pip install httpx")

    cfg = load_config()
    url = cfg.get("supabase_url")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or cfg.get("supabase_key")
    if not url or not key:
        sys.exit("supabase_url missing from config, or no SUPABASE_SERVICE_ROLE_KEY / supabase_key")

    with httpx.Client(
        base_url=url.rstrip("/"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
        timeout=60,
    ) as client:
        written = insert_dumps(client, rows)

    print(f"\nDone — {written} row(s) written to dac_nettable_dumps.")


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "import-matches-cv":
        cmd_import_matches_cv(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "ingest-nettable":
        cmd_ingest_nettable(sys.argv[2:])
    else:
        print(__doc__.strip())
        sys.exit(1)


if __name__ == "__main__":
    main()
