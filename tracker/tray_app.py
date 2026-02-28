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

from utils import load_config, save_config, DAC_DIR, GAMES_CSV, ICONS_DIR

POLL_INTERVAL = 5       # seconds between screen checks
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
        self._stop_event = threading.Event()
        self._update_info = None  # (tag, url) if update available
        self._awaiting_reset = False  # require "unknown" before next detection

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

            # Notify on focus transitions
            if dota_focused and not was_dota_focused:
                print(f"[tray] Dota 2 focused (poll #{poll_count})")
                self._notify(APP_NAME, "Dota 2 detected — tracking screens.", timeout=3)
            elif not dota_focused and was_dota_focused:
                print(f"[tray] Dota 2 lost focus (poll #{poll_count})")
            was_dota_focused = dota_focused

            if not dota_focused:
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

            if screen_type == "unknown":
                self._awaiting_reset = False
                continue

            if self._awaiting_reset:
                print(f"[tray] poll #{poll_count}: suppressed (awaiting screen change)")
                continue

            self._awaiting_reset = True

            label = screen_type.replace("_", " ").title()
            print(f"[tray] Detected: {screen_type} → {screenshot_path.name}")
            self._notify(APP_NAME, f"{label} detected — parsing...")

            threading.Thread(
                target=self._do_parse, args=(screenshot_path, screen_type),
                daemon=True, name="auto-parse",
            ).start()

    # ── Parse action ──────────────────────────────────────────────────────────

    def _do_parse(self, path: Path, screen_type: str) -> None:
        """Run parsing in a background thread."""
        import cv2
        from csv_writer import GameRow, append_row
        from db import push_game

        user_id = self.config.get("steam_id") or None

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
                    game_row = GameRow(
                        date=date_str,
                        placement=r.get("placement", ""),
                        rank=r.get("rank", ""),
                        rank_change="none",
                        lineup="|".join(r.get("units", [])),
                        synergies=r.get("synergies", ""),
                        talents="",
                        relic="",
                        level=r.get("level", ""),
                        wl=r.get("wl", ""),
                        screenshot=path.name,
                        notes="",
                    )
                    append_row(game_row, self.games_csv)
                    push_game(game_row, user_id=user_id)
                self._notify(APP_NAME, f"Imported {len(rows)} match(es) from MY MATCHES.")

            else:
                # final_ranking or game_over — use watcher's process_screenshot
                from watcher import process_screenshot
                row = process_screenshot(path)
                if row is None:
                    self._notify(APP_NAME, "Could not parse screenshot.")
                    return
                append_row(row, self.games_csv)
                push_game(row, user_id=user_id)
                place = row.placement or "?"
                rank = row.rank or ""
                self._notify(APP_NAME, f"Saved: #{place} {rank}")

        except Exception as e:
            print(f"[tray] parse error: {e}")
            self._notify(APP_NAME, f"Parse error: {e}")

    # ── Steam login & dashboard ─────────────────────────────────────────────

    def _is_logged_in(self) -> bool:
        return bool(self.config.get("steam_id"))

    def _steam_login_text(self, _item=None) -> str:
        name = self.config.get("steam_name", "")
        if name:
            return f"Signed in: {name}"
        return "Login with Steam"

    def _steam_login(self, _icon=None, _item=None) -> None:
        if self._is_logged_in():
            return

        def _do_login():
            from steam_auth import steam_login, fetch_steam_name
            sid = steam_login()
            if not sid:
                self._notify(APP_NAME, "Steam login failed or timed out.")
                return
            name = fetch_steam_name(sid) or sid
            self.config["steam_id"] = sid
            self.config["steam_name"] = name
            save_config(self.config)
            self._notify(APP_NAME, f"Logged in as {name}")
            print(f"[tray] Steam login: {name} ({sid})")

        threading.Thread(target=_do_login, daemon=True, name="steam-login").start()

    def _steam_logout(self, _icon=None, _item=None) -> None:
        self.config["steam_id"] = ""
        self.config["steam_name"] = ""
        save_config(self.config)
        self._notify(APP_NAME, "Logged out of Steam.")

    def _open_dashboard(self, _icon=None, _item=None) -> None:
        from dashboard import DashboardWindow
        DashboardWindow.show(
            steam_id=self.config.get("steam_id", ""),
            steam_name=self.config.get("steam_name", ""),
            games_csv=str(self.games_csv),
        )

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
        """Manual update check — downloads and applies if frozen."""
        from updater import check_for_update
        result = check_for_update()
        if not result:
            self._notify(APP_NAME, "You're on the latest version.")
            return

        self._update_info = result
        self._notify(APP_NAME, f"Update available: {result['tag']}. Downloading...")
        self._install_update(result)

    def _install_update(self, info: dict) -> None:
        """Download update and apply (frozen exe only)."""
        from updater import is_frozen, download_update, apply_update_and_restart
        if not is_frozen():
            import webbrowser
            webbrowser.open(info["html_url"])
            return

        try:
            from pathlib import Path
            new_exe = Path(sys.executable).parent / "DACTracker_new.exe"
            download_update(info["download_url"], new_exe)
            self._notify(APP_NAME, f"Downloaded {info['tag']}. Restarting...")
            apply_update_and_restart(new_exe)
        except Exception as e:
            print(f"[tray] update error: {e}")
            self._notify(APP_NAME, f"Update failed: {e}")

    def _on_update_available(self, info: dict) -> None:
        """Callback from updater background loop."""
        self._update_info = info
        self._notify(APP_NAME, f"Update available: {info['tag']}\nUse tray menu → Check for Updates.")

    def _quit(self, icon, _item=None) -> None:
        self._stop_event.set()
        icon.stop()

    # ── Run ───────────────────────────────────────────────────────────────────

    def run(self) -> None:
        """Start the tray app (blocks until quit)."""
        menu = pystray.Menu(
            pystray.MenuItem(
                self._steam_login_text,
                self._steam_login,
                enabled=lambda _: not self._is_logged_in(),
            ),
            pystray.MenuItem(
                "Logout",
                self._steam_logout,
                visible=lambda _: self._is_logged_in(),
            ),
            pystray.MenuItem("Recent Games", self._open_dashboard),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Import History Screenshot...", self._import_history),
            pystray.MenuItem("Open CSV", self._open_csv),
            pystray.MenuItem("Open Viewer", self._open_viewer),
            pystray.MenuItem("Check for Updates", self._check_updates),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )

        from updater import __version__
        tooltip = f"{APP_NAME} v{__version__}"
        icon = pystray.Icon(APP_NAME, _make_icon_image(), tooltip, menu)

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
