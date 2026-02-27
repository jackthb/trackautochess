"""DAC Tracker — Windows system tray app.

Polls for Dota 2 game screens every 5s and notifies when detected.
User clicks notification to parse and save to CSV.

Usage:
    python tray_app.py          # run tray app
    pythonw tray_app.py         # run without console window
"""

import ctypes
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import pystray
from PIL import Image
from plyer import notification

# ── Tesseract setup (bundled or system) ───────────────────────────────────────

def _setup_tesseract():
    """Point pytesseract at bundled Tesseract if running from PyInstaller exe."""
    import pytesseract
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle — tesseract is in _MEIPASS/tesseract/
        base = Path(sys._MEIPASS)
        tess_exe = base / "tesseract" / "tesseract.exe"
        if tess_exe.exists():
            pytesseract.pytesseract.tesseract_cmd = str(tess_exe)
            os.environ["TESSDATA_PREFIX"] = str(base / "tesseract" / "tessdata")
            return
    # Not frozen or bundled tesseract missing — hope it's on PATH

_setup_tesseract()

# ── Config ────────────────────────────────────────────────────────────────────

from utils import load_config, DAC_DIR, GAMES_CSV, ICONS_DIR

POLL_INTERVAL = 5       # seconds between screen checks
COOLDOWN_SECS = 30      # seconds after detection before re-checking
APP_NAME = "DAC Tracker"

# ── Window detection (ctypes — no pywin32) ────────────────────────────────────

def is_dota_focused() -> bool:
    """Check if Dota 2 is the foreground window."""
    try:
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        buf = ctypes.create_unicode_buffer(256)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, 256)
        return "Dota 2" in buf.value
    except Exception:
        return False


# ── Tray icon ─────────────────────────────────────────────────────────────────

def _make_icon_image() -> Image.Image:
    """Create a simple tray icon (green square with 'D')."""
    img = Image.new("RGB", (64, 64), color=(30, 80, 30))
    try:
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("arial.ttf", 40)
        except OSError:
            font = ImageFont.load_default()
        draw.text((16, 8), "D", fill=(200, 255, 200), font=font)
    except Exception:
        pass
    return img


class TrayApp:
    """System tray application with background polling."""

    def __init__(self):
        self.config = load_config()
        self.games_csv = Path(self.config.get("games_csv", str(GAMES_CSV))).expanduser()
        self.cooldown_until = 0.0
        self.pending_screenshot = None  # path to screenshot awaiting user action
        self.pending_screen_type = None
        self._stop_event = threading.Event()
        self._update_info = None  # (tag, url) if update available

    def _notify(self, title: str, message: str, timeout: int = 5) -> None:
        """Show a desktop toast notification."""
        try:
            notification.notify(
                title=title,
                message=message,
                app_name=APP_NAME,
                timeout=timeout,
            )
        except Exception as e:
            print(f"[tray] notification error: {e}")

    # ── Polling loop ──────────────────────────────────────────────────────────

    def _poll_loop(self) -> None:
        """Background thread: poll for game screens."""
        # Import heavy deps inside thread to keep startup fast
        import capture
        import cv2
        from cv_parser import detect_screen_type

        poll_count = 0
        was_dota_focused = False
        while not self._stop_event.is_set():
            time.sleep(POLL_INTERVAL)
            poll_count += 1

            dota_focused = is_dota_focused()

            # Log focus transitions
            if dota_focused and not was_dota_focused:
                print(f"[tray] Dota 2 focused (poll #{poll_count})")
            elif not dota_focused and was_dota_focused:
                print(f"[tray] Dota 2 lost focus (poll #{poll_count})")
            was_dota_focused = dota_focused

            # Log status every 12 polls (60s)
            if poll_count % 12 == 0:
                status = "Dota 2 focused" if dota_focused else "waiting for Dota 2"
                print(f"[tray] alive — {status} (poll #{poll_count})")

            if not dota_focused:
                continue
            if time.time() < self.cooldown_until:
                continue

            # Capture and detect
            try:
                screenshot_path = capture.capture_screen()
                img = cv2.imread(str(screenshot_path))
                if img is None:
                    continue
                screen_type = detect_screen_type(img)
            except Exception as e:
                print(f"[tray] capture/detect error: {e}")
                continue

            print(f"[tray] poll #{poll_count}: screen_type={screen_type}")

            if screen_type in ("final_ranking", "game_over", "my_matches"):
                self.pending_screenshot = screenshot_path
                self.pending_screen_type = screen_type
                self.cooldown_until = time.time() + COOLDOWN_SECS

                label = screen_type.replace("_", " ").title()
                self._notify(
                    f"{APP_NAME} — {label} detected",
                    "Use tray menu → Parse Now to import this game.",
                )
                print(f"[tray] Detected: {screen_type} → {screenshot_path.name}")

    # ── Parse action ──────────────────────────────────────────────────────────

    def _parse_pending(self, _icon=None, _item=None) -> None:
        """Parse the pending screenshot and append to CSV."""
        if self.pending_screenshot is None:
            self._notify(APP_NAME, "No screenshot pending. Play a game first.")
            return

        path = self.pending_screenshot
        screen_type = self.pending_screen_type
        self.pending_screenshot = None
        self.pending_screen_type = None

        threading.Thread(
            target=self._do_parse, args=(path, screen_type),
            daemon=True, name="parser",
        ).start()

    def _do_parse(self, path: Path, screen_type: str) -> None:
        """Run parsing in a background thread."""
        import cv2
        from csv_writer import GameRow, append_row

        try:
            if screen_type == "my_matches":
                from cv_parser import parse_my_matches
                img = cv2.imread(str(path))
                player = self.config.get("player_name", "jack")
                rows = parse_my_matches(img, player, ICONS_DIR)
                if not rows:
                    self._notify(APP_NAME, "MY MATCHES: no rows parsed.")
                    return
                date_str = datetime.now().strftime("%Y-%m-%d")
                for r in rows:
                    comp = "|".join(r.get("units", []))
                    game_row = GameRow(
                        date=date_str,
                        placement=r.get("placement", ""),
                        comp=comp,
                        synergies=r.get("synergies", ""),
                        talents="",
                        relic="",
                        level=r.get("level", ""),
                        wl=r.get("wl", ""),
                        screenshot=path.name,
                        notes=f"rank:{r.get('rank', '')}",
                    )
                    append_row(game_row, self.games_csv)
                self._notify(APP_NAME, f"Imported {len(rows)} match(es) from MY MATCHES.")

            else:
                # final_ranking or game_over — use watcher's process_screenshot
                from watcher import process_screenshot
                row = process_screenshot(path)
                if row is None:
                    self._notify(APP_NAME, "Could not parse screenshot.")
                    return
                append_row(row, self.games_csv)
                place = row.placement or "?"
                self._notify(APP_NAME, f"Saved: placement #{place} {row.notes}")

        except Exception as e:
            print(f"[tray] parse error: {e}")
            self._notify(APP_NAME, f"Parse error: {e}")

    # ── Menu actions ──────────────────────────────────────────────────────────

    def _open_csv(self, _icon=None, _item=None) -> None:
        """Open the games CSV in the default app."""
        if self.games_csv.exists():
            os.startfile(str(self.games_csv))
        else:
            self._notify(APP_NAME, "No games.csv yet — play a game first.")

    def _open_viewer(self, _icon=None, _item=None) -> None:
        """Open viewer.html in the default browser."""
        viewer = Path(__file__).parent / "viewer.html"
        if viewer.exists():
            os.startfile(str(viewer))
        else:
            self._notify(APP_NAME, "viewer.html not found.")

    def _import_history(self, _icon=None, _item=None) -> None:
        """Open file picker, parse MY MATCHES screenshot, import rows."""
        import tkinter as tk
        from tkinter import filedialog

        # tkinter needs a root window (hidden)
        root = tk.Tk()
        root.withdraw()
        path = filedialog.askopenfilename(
            title="Select MY MATCHES screenshot",
            filetypes=[("Images", "*.jpg *.jpeg *.png"), ("All files", "*.*")],
            initialdir=str(Path.home() / "Pictures"),
        )
        root.destroy()

        if not path:
            return  # user cancelled

        path = Path(path)
        print(f"[tray] Import history: {path}")
        threading.Thread(
            target=self._do_parse, args=(path, "my_matches"),
            daemon=True, name="import-history",
        ).start()

    def _check_updates(self, _icon=None, _item=None) -> None:
        """Manual update check."""
        from updater import check_for_update, open_release_page
        result = check_for_update()
        if result:
            self._update_info = (result["tag"], result["url"])
            self._notify(APP_NAME, f"Update available: {result['tag']}")
            open_release_page(result["url"])
        else:
            self._notify(APP_NAME, "You're on the latest version.")

    def _on_update_available(self, tag: str, url: str) -> None:
        """Callback from updater background loop."""
        self._update_info = (tag, url)
        self._notify(APP_NAME, f"Update available: {tag}\nUse tray menu → Check for Updates.")

    def _quit(self, icon, _item=None) -> None:
        self._stop_event.set()
        icon.stop()

    # ── Run ───────────────────────────────────────────────────────────────────

    def run(self) -> None:
        """Start the tray app (blocks until quit)."""
        menu = pystray.Menu(
            pystray.MenuItem("Parse Now", self._parse_pending, default=True),
            pystray.MenuItem("Import History Screenshot...", self._import_history),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open CSV", self._open_csv),
            pystray.MenuItem("Open Viewer", self._open_viewer),
            pystray.MenuItem("Check for Updates", self._check_updates),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )

        icon = pystray.Icon(APP_NAME, _make_icon_image(), APP_NAME, menu)

        # Start poll thread
        poll_thread = threading.Thread(target=self._poll_loop, daemon=True, name="poller")
        poll_thread.start()

        # Start update checker
        from updater import start_update_loop
        start_update_loop(self._on_update_available)

        print(f"[tray] {APP_NAME} running. Right-click tray icon for menu.")
        print(f"[tray] CSV: {self.games_csv}")
        print(f"[tray] Polling every {POLL_INTERVAL}s when Dota 2 is focused.")
        self._notify(APP_NAME, "Running in system tray.\nWill detect game screens when Dota 2 is focused.")
        icon.run()


def main():
    app = TrayApp()
    app.run()


if __name__ == "__main__":
    main()
