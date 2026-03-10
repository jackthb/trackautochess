"""DAC Tracker — Windows system tray app.

Auto-captures Final Ranking screen via sentinel pixel polling.
Press F6 on the My Matches screen for manual capture.

Usage:
    python tray_app.py          # run tray app
    pythonw tray_app.py         # run without console window
"""

import logging
import os
import sys
import threading
from datetime import datetime
from pathlib import Path

import pystray
from PIL import Image

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

from utils import load_config, save_config, DAC_DIR, ICONS_DIR

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


# ── Tray icon ─────────────────────────────────────────────────────────────────

def _load_icon_image() -> Image.Image:
    """Load the bundled .ico, falling back to a generated placeholder."""
    ico_path = ICONS_DIR / "dac_tracker.ico"
    if ico_path.exists():
        try:
            img = Image.open(ico_path)
            img.load()
            return img
        except Exception:
            pass
    # Fallback: generate a simple icon
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


def _set_app_model_id():
    """Set Windows AppUserModelID so notifications show our app name."""
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_NAME)
    except Exception:
        pass


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
    """System tray application with sentinel-based auto-capture."""

    def __init__(self):
        self.config = load_config()
        self._stop_event = threading.Event()
        self._update_info = None  # (tag, url) if update available
        self._icon = None  # set in run()
        self._sentinel = None  # set in run()
        self._overlay = None  # GameEndOverlay instance
        # Ensure user exists in DB if already logged in
        sid = self.config.get("steam_id")
        if sid:
            from db import ensure_user
            ensure_user(sid)

    def _notify(self, title: str, message: str) -> None:
        """Show a desktop balloon notification via pystray."""
        try:
            if self._icon:
                self._icon.notify(message, title)
        except Exception as e:
            log.error("notification error: %s", e)

    # ── Sentinel poller ─────────────────────────────────────────────────────

    def _start_sentinel(self) -> None:
        """Start lightweight screen polling for Final Ranking detection."""
        from sentinel import SentinelPoller
        self._sentinel = SentinelPoller(on_match=self._on_sentinel_match)
        self._sentinel.start()

    def _on_sentinel_match(self) -> None:
        """Called when the sentinel detects a Final Ranking screen."""
        log.info("Sentinel: Final Ranking detected — showing overlay")
        self._notify(APP_NAME, "Game ended! Open Match History and click Capture.")
        self._show_overlay()

    def _show_overlay(self) -> None:
        """Show the game-end overlay prompting user to open Match History."""
        from overlay import GameEndOverlay
        # Dismiss any existing overlay
        if self._overlay and self._overlay._alive:
            self._overlay.dismiss()
        self._overlay = GameEndOverlay(
            on_capture=self._overlay_capture,
            on_dismiss=lambda: log.info("Overlay dismissed without capture"),
        )
        self._overlay.show()

    def _overlay_capture(self) -> None:
        """Capture My Matches screen after user clicks overlay button."""
        import time
        import capture
        from cv_parser import detect_screen_type

        try:
            # Brief delay to let user's click settle and screen render
            time.sleep(0.5)
            img = capture.capture_screen()
            if img is None:
                log.error("Overlay capture: screenshot failed")
                self._notify(APP_NAME, "Screenshot capture failed.")
                return

            screen_type = detect_screen_type(img)
            log.info("Overlay capture: detected screen type '%s'", screen_type)

            if screen_type == "my_matches":
                self._notify(APP_NAME, "My Matches detected — parsing...")
                self._do_parse_my_matches(img)
            else:
                self._notify(
                    APP_NAME,
                    f"Not on My Matches page (detected: {screen_type}).\n"
                    f"Navigate to My Matches and press {self.config.get('hotkey', 'F6')}.",
                )
        except Exception as e:
            log.error("Overlay capture error: %s", e, exc_info=True)
            self._notify(APP_NAME, f"Capture error: {e}")

    # ── Hotkey listener ─────────────────────────────────────────────────────

    def _register_hotkey(self) -> None:
        """Register global hotkeys (Windows only)."""
        try:
            import keyboard
            hotkey = self.config.get("hotkey", "F6")
            keyboard.add_hotkey(hotkey, self._on_hotkey, suppress=False)
            keyboard.add_hotkey("F5", self._on_test_overlay, suppress=False)
            log.info("Registered hotkeys: %s (capture), F5 (test overlay)", hotkey)
        except ImportError:
            log.warning("keyboard module not available — hotkey disabled")
        except Exception as e:
            log.error("Failed to register hotkey: %s", e)

    def _on_test_overlay(self) -> None:
        """Test hotkey: show the game-end overlay without sentinel trigger."""
        log.info("F5 pressed — showing overlay (test)")
        self._show_overlay()

    def _on_hotkey(self) -> None:
        """Handle hotkey press: capture screen, detect type, parse if My Matches."""
        log.info("Hotkey pressed — capturing screen...")
        threading.Thread(
            target=self._hotkey_capture, daemon=True, name="hotkey-capture",
        ).start()

    def _hotkey_capture(self) -> None:
        """Capture and process in background thread."""
        import capture
        from cv_parser import detect_screen_type

        try:
            img = capture.capture_screen()
            if img is None:
                log.error("Failed to capture screenshot")
                self._notify(APP_NAME, "Screenshot capture failed.")
                return

            screen_type = detect_screen_type(img)
            log.info("Detected screen type: %s", screen_type)

            if screen_type == "my_matches":
                self._notify(APP_NAME, "My Matches detected — parsing...")
                self._do_parse_my_matches(img)
            else:
                hotkey = self.config.get("hotkey", "F6")
                self._notify(APP_NAME, f"Not on My Matches page. Open it and press {hotkey} again.")
        except Exception as e:
            log.error("hotkey capture error: %s", e, exc_info=True)
            self._notify(APP_NAME, f"Capture error: {e}")

    # ── Parse action ──────────────────────────────────────────────────────────

    def _do_parse_my_matches(self, img) -> None:
        """Parse a My Matches screen image (numpy array or file path)."""
        import cv2
        from models import GameRow
        from db import game_exists, push_game

        user_id = self.config.get("steam_id") or None

        try:
            # If img is a path, read it
            if isinstance(img, Path):
                img = cv2.imread(str(img))
                if img is None:
                    self._notify(APP_NAME, "Failed to read image.")
                    return

            from cv_parser import parse_my_matches
            player = self.config.get("player_name", "jack")
            rows = parse_my_matches(img, player, ICONS_DIR)
            if not rows:
                log.warning("MY MATCHES: no rows parsed")
                self._notify(APP_NAME, "MY MATCHES: no rows parsed.")
                return
            log.info("Parsed %d row(s) from MY MATCHES", len(rows))

            date_str = datetime.now().strftime("%Y-%m-%d")
            imported = 0
            skipped = 0
            for i, r in enumerate(rows, 1):
                lineup = "|".join(r.get("units", []))
                placement = r.get("placement", "")
                wl = r.get("wl", "")
                level = r.get("level", "")

                # Skip duplicates via DB check
                if user_id and game_exists(user_id, date_str, placement, wl, level):
                    log.info("  row %d: SKIP duplicate (place=%s wl=%s level=%s)", i, placement, wl, level)
                    skipped += 1
                    continue

                log.info(
                    "  row %d: place=%s level=%s wl=%s rank=%s relic=%s units=[%s] synergies=%s",
                    i, placement, level, wl,
                    r.get("rank"), r.get("relic"), lineup, r.get("synergies"),
                )
                game_row = GameRow(
                    date=date_str,
                    placement=placement,
                    rank=r.get("rank", ""),
                    rank_change=r.get("rank_change", "none"),
                    lineup=lineup,
                    synergies=r.get("synergies", ""),
                    talents="",
                    relic=r.get("relic", ""),
                    level=level,
                    wl=wl,
                    notes="",
                )
                push_game(game_row, user_id=user_id)
                imported += 1

            msg = f"Imported {imported} match(es)"
            if skipped:
                msg += f", {skipped} duplicate(s) skipped"
            self._notify(APP_NAME, msg)

        except Exception as e:
            log.error("parse error: %s", e, exc_info=True)
            self._notify(APP_NAME, f"Parse error: {e}")

    # ── Steam login ──────────────────────────────────────────────────────────

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
            from db import ensure_user
            ensure_user(sid)
            self._notify(APP_NAME, f"Logged in as {name}")
            log.info("Steam login: %s (%s)", name, sid)

        threading.Thread(target=_do_login, daemon=True, name="steam-login").start()

    def _steam_logout(self, _icon=None, _item=None) -> None:
        self.config["steam_id"] = ""
        self.config["steam_name"] = ""
        save_config(self.config)
        self._notify(APP_NAME, "Logged out of Steam.")

    # ── Menu actions ──────────────────────────────────────────────────────────

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
            target=self._do_parse_my_matches, args=(path,),
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

    def _toggle_autostart(self, _icon=None, _item=None) -> None:
        """Toggle Windows autostart on/off."""
        enabled = is_autostart_enabled()
        set_autostart(not enabled)
        state = "enabled" if not enabled else "disabled"
        self._notify(APP_NAME, f"Start with Windows: {state}")

    def _quit(self, icon, _item=None) -> None:
        log.info("Quit requested — shutting down")
        self._stop_event.set()
        if self._overlay:
            try:
                self._overlay.dismiss()
            except Exception:
                pass
        if self._sentinel:
            try:
                self._sentinel.stop()
            except Exception:
                pass
        try:
            import keyboard
            keyboard.unhook_all()
        except Exception:
            pass
        try:
            icon.stop()
        except Exception:
            os._exit(0)

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
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Import History Screenshot...", self._import_history),
            pystray.MenuItem(
                "Start with Windows",
                self._toggle_autostart,
                checked=lambda _: is_autostart_enabled(),
            ),
            pystray.MenuItem("Check for Updates", self._check_updates),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )

        from updater import __version__
        tooltip = f"{APP_NAME} v{__version__}"
        _set_app_model_id()
        self._icon = pystray.Icon(APP_NAME, _load_icon_image(), tooltip, menu)

        # Register hotkey
        self._register_hotkey()

        # Start sentinel poller (auto-detect Final Ranking)
        self._start_sentinel()

        # Start update checker
        from updater import start_update_loop
        start_update_loop(self._on_update_available)

        hotkey = self.config.get("hotkey", "F6")
        log.info("%s running. Sentinel active, hotkey %s for manual capture.", APP_NAME, hotkey)
        log.info("Log: %s", LOG_PATH)
        self._notify(APP_NAME, f"Running — auto-detect Final Ranking.\nPress {hotkey} on My Matches for manual import.")
        self._icon.run()


def _kill_existing():
    """Kill any already-running DACTracker processes (Windows only)."""
    if sys.platform != "win32":
        return
    import subprocess
    exe_name = os.path.basename(sys.executable)
    my_pid = str(os.getpid())
    try:
        # List all processes with this name, then kill any that aren't us
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {exe_name}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.strip().splitlines():
            parts = line.strip('"').split('","')
            if len(parts) >= 2:
                pid = parts[1]
                if pid != my_pid:
                    log.info("Killing existing %s (pid %s)", exe_name, pid)
                    subprocess.run(["taskkill", "/F", "/PID", pid],
                                   capture_output=True, timeout=5)
    except Exception as e:
        log.warning("Could not kill existing process: %s", e)


def main():
    import atexit
    import traceback
    crash_log = Path.home() / ".dac" / "crash.log"
    crash_log.parent.mkdir(parents=True, exist_ok=True)

    def _on_exit():
        log.info("Process exiting")
        # Also write to crash.log in case the log handler is gone
        with open(crash_log, "a", encoding="utf-8") as f:
            f.write(f"\n{datetime.now()} — process exiting normally\n")
    atexit.register(_on_exit)

    try:
        _kill_existing()
        # Catch unhandled exceptions so crashes get logged (pythonw has no console)
        def _excepthook(exc_type, exc_value, exc_tb):
            log.critical("Unhandled exception", exc_info=(exc_type, exc_value, exc_tb))
            with open(crash_log, "a", encoding="utf-8") as f:
                f.write(f"\n{'='*60}\n{datetime.now()}\n")
                traceback.print_exception(exc_type, exc_value, exc_tb, file=f)
        sys.excepthook = _excepthook
        # Also catch unhandled exceptions in threads
        def _thread_excepthook(args):
            log.critical("Unhandled thread exception in %s", args.thread.name if args.thread else "unknown",
                         exc_info=(args.exc_type, args.exc_value, args.exc_traceback))
            with open(crash_log, "a", encoding="utf-8") as f:
                f.write(f"\n{'='*60}\n{datetime.now()} [thread: {args.thread.name if args.thread else '?'}]\n")
                traceback.print_exception(args.exc_type, args.exc_value, args.exc_traceback, file=f)
        threading.excepthook = _thread_excepthook

        app = TrayApp()
        app.run()
    except Exception:
        with open(crash_log, "a", encoding="utf-8") as f:
            f.write(f"\n{'='*60}\n{datetime.now()} [FATAL]\n")
            traceback.print_exc(file=f)
        raise


if __name__ == "__main__":
    main()
