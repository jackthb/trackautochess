"""DAC Tracker — Windows system tray app.

Polls for Dota 2 game screens every 5s and notifies when detected.
User clicks notification to parse and save to CSV.

Usage:
    python tray_app.py          # run tray app
    pythonw tray_app.py         # run without console window
"""

import ctypes
import logging
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
LOG_PATH = DAC_DIR / "tracker.log"

# ── Logging ──────────────────────────────────────────────────────────────────

DAC_DIR.mkdir(parents=True, exist_ok=True)
log = logging.getLogger("dac")
log.setLevel(logging.DEBUG)
_fh = logging.FileHandler(LOG_PATH, encoding="utf-8")
_fh.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-5s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
log.addHandler(_fh)
_ch = logging.StreamHandler()
_ch.setFormatter(logging.Formatter("[tray] %(message)s"))
log.addHandler(_ch)

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


def _save_icon_file() -> str | None:
    """Save the app icon as .ico in ~/.dac/ and return the path."""
    ico_path = DAC_DIR / "icon.ico"
    if ico_path.exists():
        return str(ico_path)
    try:
        DAC_DIR.mkdir(parents=True, exist_ok=True)
        img = _make_icon_image()
        img.save(str(ico_path), format="ICO", sizes=[(64, 64)])
        return str(ico_path)
    except Exception:
        return None


# ── Windows autostart (registry) ─────────────────────────────────────────

_AUTOSTART_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_AUTOSTART_NAME = "DACTracker"


def _get_exe_path() -> str:
    """Return the path to the running exe (frozen) or script."""
    if getattr(sys, "frozen", False):
        return sys.executable
    return str(Path(__file__).resolve())


def is_autostart_enabled() -> bool:
    """Check if autostart registry key exists."""
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _AUTOSTART_KEY, 0, winreg.KEY_READ)
        try:
            winreg.QueryValueEx(key, _AUTOSTART_NAME)
            return True
        except FileNotFoundError:
            return False
        finally:
            winreg.CloseKey(key)
    except Exception:
        return False


def set_autostart(enable: bool) -> None:
    """Add or remove the autostart registry key."""
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _AUTOSTART_KEY, 0, winreg.KEY_SET_VALUE)
        try:
            if enable:
                winreg.SetValueEx(key, _AUTOSTART_NAME, 0, winreg.REG_SZ, _get_exe_path())
            else:
                try:
                    winreg.DeleteValue(key, _AUTOSTART_NAME)
                except FileNotFoundError:
                    pass
        finally:
            winreg.CloseKey(key)
    except Exception as e:
        log.error("autostart error: %s", e)


class TrayApp:
    """System tray application with background polling."""

    def __init__(self):
        self.config = load_config()
        self.games_csv = Path(self.config.get("games_csv", str(GAMES_CSV))).expanduser()
        self._stop_event = threading.Event()
        self._update_info = None  # (tag, url) if update available
        self._awaiting_reset = False  # require "unknown" before next detection
        self._icon_path = _save_icon_file()

    def _notify(self, title: str, message: str, timeout: int = 5) -> None:
        """Show a desktop toast notification."""
        try:
            kwargs = dict(
                title=title,
                message=message,
                app_name=APP_NAME,
                timeout=timeout,
            )
            if self._icon_path:
                kwargs["app_icon"] = self._icon_path
            notification.notify(**kwargs)
        except Exception as e:
                log.error("notification error: %s", e)

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
                log.info("Dota 2 focused (poll #%d)", poll_count)
                self._notify(APP_NAME, "Dota 2 detected — tracking screens.", timeout=3)
            elif not dota_focused and was_dota_focused:
                log.info("Dota 2 lost focus (poll #%d)", poll_count)
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
                log.error("capture/detect error: %s", e)
                continue

            log.debug("poll #%d: screen_type=%s", poll_count, screen_type)

            if screen_type == "unknown":
                self._awaiting_reset = False
                screenshot_path.unlink(missing_ok=True)
                continue

            if self._awaiting_reset:
                log.debug("poll #%d: suppressed (awaiting screen change)", poll_count)
                screenshot_path.unlink(missing_ok=True)
                continue

            self._awaiting_reset = True

            label = screen_type.replace("_", " ").title()
            log.info("Detected: %s → %s", screen_type, screenshot_path.name)
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
                    log.warning("MY MATCHES: no rows parsed from %s", path.name)
                    self._notify(APP_NAME, "MY MATCHES: no rows parsed.")
                    return
                log.info("Parsed %d row(s) from MY MATCHES: %s", len(rows), path.name)
                date_str = datetime.now().strftime("%Y-%m-%d")
                for i, r in enumerate(rows, 1):
                    lineup = "|".join(r.get("units", []))
                    log.info(
                        "  row %d: place=%s level=%s wl=%s rank=%s relic=%s units=[%s] synergies=%s",
                        i, r.get("placement"), r.get("level"), r.get("wl"),
                        r.get("rank"), r.get("relic"), lineup, r.get("synergies"),
                    )
                    game_row = GameRow(
                        date=date_str,
                        placement=r.get("placement", ""),
                        rank=r.get("rank", ""),
                        rank_change="none",
                        lineup=lineup,
                        synergies=r.get("synergies", ""),
                        talents="",
                        relic=r.get("relic", ""),
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
                    log.warning("Could not parse screenshot: %s", path.name)
                    self._notify(APP_NAME, "Could not parse screenshot.")
                    return
                log.info(
                    "Parsed %s: place=%s rank=%s level=%s wl=%s lineup=%s synergies=%s",
                    path.name, row.placement, row.rank, row.level, row.wl,
                    row.lineup, row.synergies,
                )
                append_row(row, self.games_csv)
                push_game(row, user_id=user_id)
                place = row.placement or "?"
                rank = row.rank or ""
                self._notify(APP_NAME, f"Saved: #{place} {rank}")

        except Exception as e:
            log.error("parse error for %s: %s", path.name, e, exc_info=True)
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
            log.info("Steam login: %s (%s)", name, sid)

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
        log.info("Import history: %s", path)
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
            log.error("update error: %s", e)
            self._notify(APP_NAME, f"Update failed: {e}")

    def _on_update_available(self, info: dict) -> None:
        """Callback from updater background loop."""
        self._update_info = info
        self._notify(APP_NAME, f"Update available: {info['tag']}\nUse tray menu → Check for Updates.")

    def _sync_csv_to_db(self, _icon=None, _item=None) -> None:
        """Push all CSV rows to Supabase, skipping duplicates."""
        def _do_sync():
            from csv_writer import read_all
            from db import game_exists, push_game

            steam_id = self.config.get("steam_id")
            if not steam_id:
                self._notify(APP_NAME, "Not logged in — sync aborted.")
                return

            if not self.games_csv.exists():
                self._notify(APP_NAME, "No games.csv found.")
                return

            rows = read_all(self.games_csv)
            log.info("Syncing %d CSV row(s) to Supabase...", len(rows))

            pushed = skipped = failed = 0
            for row in rows:
                if game_exists(steam_id, row.date, row.placement, row.wl, row.level):
                    skipped += 1
                    continue
                if push_game(row, user_id=steam_id):
                    pushed += 1
                else:
                    failed += 1

            msg = f"Synced {pushed} game(s)"
            if skipped:
                msg += f", {skipped} already in DB"
            if failed:
                msg += f", {failed} failed"
            log.info(msg)
            self._notify(APP_NAME, msg)

        threading.Thread(target=_do_sync, daemon=True, name="sync-db").start()

    def _toggle_autostart(self, _icon=None, _item=None) -> None:
        """Toggle Windows autostart on/off."""
        enabled = is_autostart_enabled()
        set_autostart(not enabled)
        state = "enabled" if not enabled else "disabled"
        self._notify(APP_NAME, f"Start with Windows: {state}")

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
            pystray.MenuItem(
                "Start with Windows",
                self._toggle_autostart,
                checked=lambda _: is_autostart_enabled(),
            ),
            pystray.MenuItem(
                "Sync CSV to DB",
                self._sync_csv_to_db,
                visible=lambda _: self._is_logged_in(),
            ),
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

        log.info("%s running. Right-click tray icon for menu.", APP_NAME)
        log.info("CSV: %s", self.games_csv)
        log.info("Log: %s", LOG_PATH)
        log.info("Polling every %ds when Dota 2 is focused.", POLL_INTERVAL)
        self._notify(APP_NAME, "Running in system tray.\nWill detect game screens when Dota 2 is focused.")
        icon.run()


def main():
    app = TrayApp()
    app.run()


if __name__ == "__main__":
    main()
