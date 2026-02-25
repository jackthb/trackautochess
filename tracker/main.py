"""DAC Game Tracker — hotkey listener entry point.

Usage:
    python main.py                        # Start hotkey listener
    python main.py import <file>          # Import old match CSV
    python main.py import <file> --dry-run
"""

import json
import sys
from datetime import datetime
from pathlib import Path

DAC_DIR = Path.home() / ".dac"
CONFIG_PATH = DAC_DIR / "config.json"
GAMES_CSV = DAC_DIR / "games.csv"
SCREENSHOTS_DIR = DAC_DIR / "screenshots"

DEFAULT_CONFIG = {
    "player_name": "jack",
    "hotkey": "ctrl+shift+g",
    "model": "qwen2.5vl:7b",
    "ollama_url": "http://localhost:11434",
    "games_csv": str(GAMES_CSV),
}


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        DAC_DIR.mkdir(parents=True, exist_ok=True)
        print("[tracker] First run — creating config.")
        name = input("  Enter your in-game player name: ").strip()
        if not name:
            name = "player"
        config = {**DEFAULT_CONFIG, "player_name": name}
        CONFIG_PATH.write_text(json.dumps(config, indent=2))
        print(f"[tracker] Config saved to {CONFIG_PATH}")
        return config
    return json.loads(CONFIG_PATH.read_text())


def on_hotkey(config: dict) -> None:
    """Called when the capture hotkey is pressed."""
    import capture
    import parser as game_parser
    import csv_writer

    print("[tracker] Hotkey triggered — capturing screen...")
    try:
        screenshot_path = capture.capture_screen()
    except Exception as e:
        print(f"[tracker] ERROR capturing screen: {e}")
        return

    print(f"[tracker] Screenshot saved: {screenshot_path}")

    date_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Store relative path (just filename) so CSV is portable
    screenshot_rel = screenshot_path.name

    games_csv = Path(config.get("games_csv", str(GAMES_CSV))).expanduser()

    print("[tracker] Sending to Ollama for parsing...")
    row = game_parser.parse_screenshot(
        image_path=screenshot_path,
        player_name=config.get("player_name", "jack"),
        date_str=date_str,
        screenshot_rel=screenshot_rel,
        model=config.get("model", "qwen2.5vl:7b"),
        ollama_url=config.get("ollama_url", "http://localhost:11434"),
    )

    if row is None:
        print("[tracker] Parse failed — screenshot kept, nothing written to CSV.")
        return

    csv_writer.append_row(row, games_csv)
    print(f"[tracker] Row appended to {games_csv}")
    print(f"  placement={row.placement}  comp={row.comp}  synergies={row.synergies}")
    if row.relic:
        print(f"  relic={row.relic}")
    if row.wl:
        print(f"  wl={row.wl}  level={row.level}")


def run_listener(config: dict) -> None:
    """Start the global hotkey listener (blocks until Ctrl+C)."""
    from pynput import keyboard

    hotkey_str = config.get("hotkey", "ctrl+shift+g")
    print(f"[tracker] Listening on {hotkey_str.upper()}  (Ctrl+C to quit)")

    def on_activate():
        on_hotkey(config)

    # pynput GlobalHotKeys expects format like '<ctrl>+<shift>+g'
    def _convert_hotkey(s: str) -> str:
        parts = s.lower().split("+")
        converted = []
        for part in parts:
            part = part.strip()
            if part in ("ctrl", "alt", "shift", "cmd"):
                converted.append(f"<{part}>")
            else:
                converted.append(part)
        return "+".join(converted)

    hotkey_pynput = _convert_hotkey(hotkey_str)
    with keyboard.GlobalHotKeys({hotkey_pynput: on_activate}) as h:
        try:
            h.join()
        except KeyboardInterrupt:
            print("\n[tracker] Stopped.")


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


def main() -> None:
    config = load_config()

    if len(sys.argv) > 1 and sys.argv[1] == "import":
        cmd_import(sys.argv[2:])
    else:
        run_listener(config)


if __name__ == "__main__":
    main()
