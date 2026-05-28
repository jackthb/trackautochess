"""DAC Tracker — Headless JSON Lines backend for Electron.

Communicates via stdin/stdout using JSON lines protocol.
Electron spawns this as a subprocess.

Usage:
    python headless.py
"""

import json
import logging
import os
import sys
import threading
from datetime import datetime
from pathlib import Path

# ── Config & paths ────────────────────────────────────────────────────────────

from utils import (
    DAC_DIR,
    load_config,
    load_regions_config,
    save_config,
)

APP_NAME = "DAC Tracker"
LOG_PATH = DAC_DIR / "tracker.log"

# ── Logging (file only — stdout is reserved for JSON protocol) ────────────────

DAC_DIR.mkdir(parents=True, exist_ok=True)
log = logging.getLogger("dac")
log.setLevel(logging.DEBUG)
_fh = logging.FileHandler(LOG_PATH, encoding="utf-8")
_fh.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-5s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
log.addHandler(_fh)
# NO StreamHandler — stdout is for JSON only


class _JsonLogHandler(logging.Handler):
    """Emit log records as JSON events on stdout for the Electron renderer."""

    _error_logged = False

    def emit(self, record):
        try:
            entry = {
                "type": "log",
                "ts": record.created,
                "level": record.levelname,
                "msg": self.format(record),
            }
            line = json.dumps(entry, ensure_ascii=False)
            sys.stdout.buffer.write(line.encode("utf-8") + b"\n")
            sys.stdout.buffer.flush()
        except Exception as e:
            # One-shot stderr breadcrumb so a broken JSON sink is visible in
            # the Electron dev console without spamming on every log call.
            if not _JsonLogHandler._error_logged:
                _JsonLogHandler._error_logged = True
                try:
                    sys.stderr.write(f"[_JsonLogHandler] disabled: {type(e).__name__}: {e}\n")
                    sys.stderr.flush()
                except Exception:
                    pass


_jh = _JsonLogHandler()
_jh.setLevel(logging.DEBUG)
_jh.setFormatter(logging.Formatter("%(message)s"))
log.addHandler(_jh)


class HeadlessBackend:
    """Headless backend that communicates via JSON lines over stdin/stdout."""

    def __init__(self):
        self.config = load_config()
        self._stop_event = threading.Event()
        self._replay_recorder = None
        self._game_focused = False
        self._last_replay_filename = None
        self._status_timer = None

        # Ensure user exists in DB if already logged in
        sid = self.config.get("steam_id")
        if sid:
            from db import ensure_user
            ensure_user(sid, name=self.config.get("steam_name"))

        # Init replay system
        if self.config.get("replay_enabled", True):
            self._init_replay()

        # GSI listener — receives Dota's gamestateintegration feed. We don't
        # use it for end-of-game detection (the nettable tailer already covers
        # that path); we use it to know whether the current Dota match is a
        # DAC custom game vs regular Dota, so the SendInput cascade can be
        # gated to DAC matches only.
        #
        # Two things have to be true for payloads to arrive:
        #   1. Dota must be launched with `-gamestateintegration` — covered
        #      by the same launch-options applier that sets `-condebug`.
        #   2. A cfg file at `<dota>/game/dota/cfg/gamestate_integration/`
        #      must point Dota at our local listener — installed here.
        # Without either, `is_dac_active()` stays False and the cascade
        # silently never fires, which would break live capture.
        self._gsi = None
        try:
            from gsi import GSIServer, install_cfg as _gsi_install_cfg
            self._gsi = GSIServer(on_game_end=None)
            _gsi_install_cfg()
        except Exception as e:
            log.warning("GSI server init failed: %s", e)

        # NetTable capture (autoexec install + console.log tailer)
        self._nettable = None
        try:
            from nettable_capture import NetTableCapture
            self._nettable = NetTableCapture(
                self._emit,
                steam_id=sid,
                # Without a working GSI signal we can't tell DAC from regular
                # Dota, so the cascade stays quiet (safer than crashing Dota).
                is_dac_active=self._gsi.is_dac_active if self._gsi else (lambda: False),
            )
        except Exception as e:
            log.warning("NetTable capture init failed: %s", e)

    # ── JSON protocol ────────────────────────────────────────────────────────

    def _emit(self, msg: dict) -> None:
        """Send a JSON line to stdout (Electron reads this)."""
        line = json.dumps(msg, ensure_ascii=False)
        sys.stdout.buffer.write(line.encode("utf-8") + b"\n")
        sys.stdout.buffer.flush()

    def _emit_error(self, message: str) -> None:
        self._emit({"type": "error", "message": message})

    def _emit_notification(self, title: str, message: str) -> None:
        self._emit({"type": "notification", "title": title, "message": message})

    def _emit_status(self) -> None:
        from updater import __version__
        recording = bool(self._replay_recorder and self._replay_recorder.recording)
        focused = self._game_focused
        logged_in = bool(self.config.get("steam_id"))
        rec_stats = None
        if recording and self._replay_recorder:
            try:
                rec_stats = self._replay_recorder.recorder_stats
            except Exception:
                pass
        self._emit({
            "type": "status",
            "recording": recording,
            "focused": focused,
            "logged_in": logged_in,
            "version": __version__,
            "steam_id": self.config.get("steam_id", ""),
            "steam_name": self.config.get("steam_name", ""),
            "admin_mode": self._is_admin_mode(),
            "replay_enabled": self.config.get("replay_enabled", True),
            "recording_stats": rec_stats,
        })

    def _is_admin_mode(self) -> bool:
        """Full desktop/debug UI is for dev/admins; packaged users get upload shell."""
        configured = self.config.get("admin_mode")
        if isinstance(configured, bool):
            return configured

        env_flag = os.environ.get("DAC_ADMIN_MODE", "").strip().lower()
        if env_flag in ("1", "true", "yes", "on"):
            return True

        steam_id = str(self.config.get("steam_id") or "").strip()
        allowlist: list[str] = []
        raw_config = self.config.get("admin_steam_ids", [])
        if isinstance(raw_config, str):
            allowlist.extend(raw_config.split(","))
        elif isinstance(raw_config, list):
            allowlist.extend(str(v) for v in raw_config)
        raw_env = os.environ.get("DAC_ADMIN_STEAM_IDS", "")
        if raw_env:
            allowlist.extend(raw_env.split(","))
        if steam_id and steam_id in {v.strip() for v in allowlist if v.strip()}:
            return True

        return not getattr(sys, "frozen", False)

    # ── Replay recording ────────────────────────────────────────────────────

    def _init_replay(self) -> None:
        from replay import ReplayRecorder, ReplayStore
        max_gb = self.config.get("replay_max_gb", 15)
        store = ReplayStore(max_gb=max_gb)
        self._replay_recorder = ReplayRecorder(store)
        log.info("Replay system ready (max %.0f GB, dir: %s)", max_gb, store.replay_dir)

    def _on_game_focus_gained(self) -> None:
        self._game_focused = True
        self._emit({"type": "focus_gained"})

    def _on_game_focus_lost(self) -> None:
        self._game_focused = False
        self._emit({"type": "focus_lost"})

    def _do_toggle_recording(self) -> None:
        """Toggle replay recording on/off via hotkey or UI command."""
        if not self._replay_recorder:
            if not self.config.get("replay_enabled", True):
                self._emit_notification(APP_NAME, "Replay recording is disabled in settings.")
                return
            self._init_replay()

        if self._replay_recorder.recording:
            # Stop in background thread so we don't block the command loop
            threading.Thread(target=self._stop_recording, daemon=True, name="stop-rec").start()
        else:
            if self._replay_recorder.start():
                log.info("Replay: recording started (manual)")
                self._emit({"type": "replay_started"})
                self._emit_notification(APP_NAME, "Recording started")
                self._emit_status()
                self._start_status_timer()

    def _start_status_timer(self) -> None:
        """Emit status every 2s while recording so the UI shows live stats."""
        self._stop_status_timer()
        def tick():
            if self._replay_recorder and self._replay_recorder.recording:
                self._emit_status()
                self._status_timer = threading.Timer(2.0, tick)
                self._status_timer.daemon = True
                self._status_timer.start()
        self._status_timer = threading.Timer(2.0, tick)
        self._status_timer.daemon = True
        self._status_timer.start()

    def _stop_status_timer(self) -> None:
        if self._status_timer:
            self._status_timer.cancel()
            self._status_timer = None

    def _stop_recording(self) -> None:
        """Stop replay recording (runs in background thread)."""
        self._stop_status_timer()
        path = self._replay_recorder.stop()
        if path and path.exists():
            size_mb = path.stat().st_size / (1024 * 1024)
            self._last_replay_filename = path.name
            self._emit({"type": "replay_saved", "name": path.name, "size_mb": round(size_mb, 1)})
            self._emit_notification(APP_NAME, f"Replay saved: {path.name} ({size_mb:.0f} MB)")
        else:
            self._last_replay_filename = None
            self._emit({"type": "replay_saved", "name": "", "size_mb": 0})
        log.info("Replay: recording stopped (manual)")
        self._emit_status()

    # ── Steam login ─────────────────────────────────────────────────────────

    def _do_steam_login(self) -> None:
        if self.config.get("steam_id"):
            return

        def _login():
            from steam_auth import steam_login, fetch_steam_name
            sid = steam_login()
            if not sid:
                self._emit_notification(APP_NAME, "Steam login failed or timed out.")
                return
            name = fetch_steam_name(sid) or sid
            self.config["steam_id"] = sid
            self.config["steam_name"] = name
            save_config(self.config)
            from db import ensure_user
            ensure_user(sid, name=name)
            self._emit({"type": "steam_login", "steam_id": sid, "steam_name": name})
            self._emit_status()
            log.info("Steam login: %s (%s)", name, sid)

        threading.Thread(target=_login, daemon=True, name="steam-login").start()

    def _do_steam_logout(self) -> None:
        self.config["steam_id"] = ""
        self.config["steam_name"] = ""
        save_config(self.config)
        self._emit_notification(APP_NAME, "Logged out of Steam.")
        self._emit_status()

    def _do_resync_from_steam(self) -> None:
        """Force Steam to quit so it flushes localconfig.vdf to disk, then
        re-emit status. Used when the file on disk is stale relative to
        Steam's in-memory state (e.g. user edited launch options in the
        Steam UI but didn't restart Steam)."""
        try:
            from nettable_capture import (
                is_steam_running,
                request_steam_shutdown,
                wait_for_steam_exit,
            )
        except Exception as e:
            self._emit({
                "type": "nettable_resync_complete",
                "ok": False,
                "error": f"Backend not ready: {e}",
            })
            return

        def _progress(stage: str, message: str) -> None:
            self._emit({
                "type": "nettable_resync_progress",
                "stage": stage,
                "message": message,
            })

        if not is_steam_running():
            # Already closed — just bump the status and we're done.
            if self._nettable:
                self._nettable.emit_status()
            self._emit({"type": "nettable_resync_complete", "ok": True, "noop": True})
            return

        _progress("closing_steam", "Asking Steam to quit…")
        if not request_steam_shutdown():
            self._emit({
                "type": "nettable_resync_complete",
                "ok": False,
                "error": "Couldn't find steam.exe to close Steam automatically.",
            })
            return
        _progress("waiting_steam_exit", "Waiting for Steam to flush its state…")
        if not wait_for_steam_exit(timeout_sec=20.0):
            self._emit({
                "type": "nettable_resync_complete",
                "ok": False,
                "error": "Steam didn't quit within 20s.",
            })
            return

        if self._nettable:
            self._nettable.emit_status()
        self._emit({"type": "nettable_resync_complete", "ok": True, "noop": False})

    def _do_apply_launch_options(self, flags: list[str]) -> None:
        """Close Steam if needed, then surgically add launch flags to Dota's
        entry in localconfig.vdf. Emits progress events so the UI can show
        intermediate states."""
        try:
            from nettable_capture import (
                apply_dota_launch_options,
                is_steam_running,
                request_steam_shutdown,
                wait_for_steam_exit,
            )
        except Exception as e:
            self._emit({
                "type": "nettable_launch_options_applied",
                "ok": False,
                "error": f"Backend not ready: {e}",
            })
            return

        def _progress(stage: str, message: str) -> None:
            self._emit({
                "type": "nettable_launch_options_progress",
                "stage": stage,
                "message": message,
            })

        if is_steam_running():
            _progress("closing_steam", "Asking Steam to quit…")
            if not request_steam_shutdown():
                self._emit({
                    "type": "nettable_launch_options_applied",
                    "ok": False,
                    "error": (
                        "Couldn't find steam.exe to close Steam automatically. "
                        "Quit Steam manually (system-tray icon → Exit Steam) "
                        "and try again."
                    ),
                })
                return
            _progress("waiting_steam_exit", "Waiting for Steam to finish closing…")
            if not wait_for_steam_exit(timeout_sec=20.0):
                self._emit({
                    "type": "nettable_launch_options_applied",
                    "ok": False,
                    "error": (
                        "Steam didn't quit within 20s — it may still be "
                        "syncing cloud saves. Quit it from the system tray "
                        "and try again."
                    ),
                })
                return

        _progress("writing", "Writing launch options…")
        result = apply_dota_launch_options(flags, self.config.get("steam_id"))
        self._emit({"type": "nettable_launch_options_applied", **result})
        # Re-emit status so the renderer's flags badges refresh.
        if self._nettable:
            self._nettable.emit_status()

    # ── Config ──────────────────────────────────────────────────────────────

    def _do_set_config(self, key: str, value) -> None:
        self.config[key] = value
        save_config(self.config)
        log.info("Config: %s = %s", key, value)

        # Handle side effects
        if key == "replay_enabled":
            if value and not self._replay_recorder:
                self._init_replay()
            elif not value and self._replay_recorder and self._replay_recorder.recording:
                self._replay_recorder.stop()

        self._emit_status()

    # ── Shutdown ────────────────────────────────────────────────────────────

    def _shutdown(self) -> None:
        log.info("Quit requested — shutting down")
        self._stop_event.set()

        if self._replay_recorder and self._replay_recorder.recording:
            try:
                self._replay_recorder.stop()
            except Exception:
                pass
        if self._nettable:
            try:
                self._nettable.stop()
            except Exception:
                pass
        if self._gsi:
            try:
                self._gsi.stop()
            except Exception:
                pass

    # ── Auto-update ─────────────────────────────────────────────────────────

    def _do_apply_update(self, download_url: str) -> None:
        from updater import download_update, apply_update_and_restart, is_frozen
        from pathlib import Path
        if not is_frozen():
            self._emit_notification(APP_NAME, "Auto-update only works in packaged builds.")
            return
        try:
            self._emit_notification(APP_NAME, "Downloading update…")
            dest = Path(sys.executable).parent / "DACTracker_new.exe"
            download_update(download_url, dest)
            self._emit_notification(APP_NAME, "Update downloaded — restarting…")
            apply_update_and_restart(dest)
        except Exception as e:
            log.error("Update failed: %s", e)
            self._emit_error(f"Update failed: {e}")

    # ── Command dispatch ────────────────────────────────────────────────────

    def _handle_command(self, msg: dict) -> None:
        cmd = msg.get("cmd")
        log.info("Command received: %s", cmd)
        if cmd == "steam_login":
            self._do_steam_login()
        elif cmd == "steam_logout":
            self._do_steam_logout()
        elif cmd == "toggle_recording":
            self._do_toggle_recording()
        elif cmd == "set_config":
            self._do_set_config(msg.get("key", ""), msg.get("value"))
        elif cmd == "status":
            self._emit_status()
        elif cmd == "nettable_status":
            if self._nettable:
                self._nettable.emit_status()
        elif cmd == "nettable_get_state":
            if self._nettable:
                self._nettable.emit_state()
        elif cmd == "nettable_apply_launch_options":
            flags = msg.get("flags") or ["-condebug", "-conclearlog"]
            threading.Thread(
                target=self._do_apply_launch_options,
                args=(flags,),
                daemon=True,
                name="nettable-apply-launch-options",
            ).start()
        elif cmd == "nettable_set_paused":
            if self._nettable:
                self._nettable.set_paused(bool(msg.get("paused", True)))
        elif cmd == "nettable_resync_from_steam":
            threading.Thread(
                target=self._do_resync_from_steam,
                daemon=True,
                name="nettable-resync",
            ).start()
        elif cmd == "do_update":
            url = msg.get("download_url", "")
            if url:
                threading.Thread(
                    target=self._do_apply_update,
                    args=(url,),
                    daemon=True,
                    name="apply-update",
                ).start()
            else:
                self._emit_error("do_update: missing download_url")
        elif cmd == "quit":
            self._shutdown()
        else:
            self._emit_error(f"Unknown command: {cmd}")

    # ── Main loop ───────────────────────────────────────────────────────────

    def run(self) -> None:
        """Read stdin commands until quit or EOF."""
        if self._gsi:
            try:
                self._gsi.start()
            except Exception as e:
                log.warning("GSI server start failed: %s", e)

        # Start NetTable capture (autoexec install + console.log tailer)
        if self._nettable:
            try:
                self._nettable.start()
            except Exception as e:
                log.warning("NetTable capture start failed: %s", e)

        from updater import __version__, start_update_loop
        log.info("%s headless backend v%s running", APP_NAME, __version__)

        def _on_update_available(info: dict) -> None:
            log.info("Update available: %s", info.get("tag"))
            self._emit({
                "type": "update_available",
                "tag": info.get("tag", ""),
                "download_url": info.get("download_url", ""),
                "html_url": info.get("html_url", ""),
            })

        start_update_loop(_on_update_available)

        # Emit initial status
        self._emit_status()

        # Read stdin line by line
        try:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError as e:
                    self._emit_error(f"Invalid JSON: {e}")
                    continue

                self._handle_command(msg)

                if self._stop_event.is_set():
                    break
        except EOFError:
            log.info("stdin EOF — Electron process likely crashed, shutting down")
        except KeyboardInterrupt:
            log.info("KeyboardInterrupt — shutting down")
        finally:
            self._shutdown()


def main():
    import atexit
    import traceback
    crash_log = DAC_DIR / "crash.log"
    crash_log.parent.mkdir(parents=True, exist_ok=True)

    def _on_exit():
        log.info("Headless process exiting")

    atexit.register(_on_exit)

    try:
        def _excepthook(exc_type, exc_value, exc_tb):
            log.critical("Unhandled exception", exc_info=(exc_type, exc_value, exc_tb))
            with open(crash_log, "a", encoding="utf-8") as f:
                f.write(f"\n{'='*60}\n{datetime.now()}\n")
                traceback.print_exception(exc_type, exc_value, exc_tb, file=f)
        sys.excepthook = _excepthook

        def _thread_excepthook(args):
            log.critical("Unhandled thread exception in %s",
                         args.thread.name if args.thread else "unknown",
                         exc_info=(args.exc_type, args.exc_value, args.exc_traceback))
        threading.excepthook = _thread_excepthook

        backend = HeadlessBackend()
        backend.run()
    except Exception:
        with open(crash_log, "a", encoding="utf-8") as f:
            f.write(f"\n{'='*60}\n{datetime.now()} [FATAL]\n")
            traceback.print_exc(file=f)
        raise


if __name__ == "__main__":
    main()
