"""DAC Game Tracker — CLI entry point.

Usage:
    python main.py import-matches-cv <screenshot> [--debug]
    python main.py parse-cv <screenshot> [--debug]
"""

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
    from cv_parser import parse_my_matches, detect_screen_type
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
        ensure_user(steam_id)

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

    # Convert CV row dicts to GameRow objects and push to Supabase
    pushed = 0
    skipped = 0
    failed = 0
    for r in rows:
        placement = r.get("placement", "")
        level = r.get("level", "")
        wl = r.get("wl", "")
        lineup = "|".join(r.get("units", []))

        if game_exists(steam_id, date_str, placement, wl, level, lineup):
            skipped += 1
            continue
        game_row = GameRow(
            date=date_str,
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
    if len(sys.argv) > 1 and sys.argv[1] == "import-matches-cv":
        cmd_import_matches_cv(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "parse-cv":
        cmd_parse_cv(sys.argv[2:])
    else:
        print(__doc__.strip())
        sys.exit(1)


if __name__ == "__main__":
    main()
