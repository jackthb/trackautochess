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
import time
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

# Diagnostic logs always upload to Supabase on this cadence (re-uploads overwrite
# the same per-session objects via upsert, so storage stays bounded).
LOG_UPLOAD_INTERVAL_SEC = 300.0
LOG_UPLOAD_FIRST_DELAY_SEC = 60.0

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
        # Periodic diagnostic-log uploader. Logs ALWAYS upload on a cadence
        # (not conditionally on errors), so a fresh full copy is always sitting
        # in Supabase whenever a friend says "it's broken".
        self._log_upload_timer = None

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

        # Telemetry (PostHog) — no-ops silently when no token is configured.
        # Must never write to stdout or raise into the backend.
        try:
            import telemetry
            from updater import __version__
            self._telemetry = telemetry
            telemetry.init(self.config, version=__version__)
            # Prime the remote kill-switch cache so the first capture doesn't
            # block on a flag fetch (best-effort, fails open).
            telemetry.refresh_flags()
            if sid:
                telemetry.identify(
                    sid,
                    steam_name=self.config.get("steam_name"),
                    version=__version__,
                )
            # Forward WARNING+ `dac` log records to PostHog automatically.
            telemetry.attach_log_handler()
            telemetry.capture("backend_started", {
                "version": __version__,
                "logged_in": bool(sid),
                "admin_mode": self._is_admin_mode(),
                "replay_enabled": self.config.get("replay_enabled", True),
            })
        except Exception as e:
            self._telemetry = None
            log.warning("Telemetry init failed: %s", e)

    # ── JSON protocol ────────────────────────────────────────────────────────

    def _emit(self, msg: dict) -> None:
        """Send a JSON line to stdout (Electron reads this)."""
        self._telemetry_observe(msg)
        line = json.dumps(msg, ensure_ascii=False)
        sys.stdout.buffer.write(line.encode("utf-8") + b"\n")
        sys.stdout.buffer.flush()

    def _telemetry_observe(self, msg: dict) -> None:
        """Piggyback PostHog captures on lifecycle events already emitted by
        the capture pipeline. Best-effort: never raises, never touches stdout."""
        tel = getattr(self, "_telemetry", None)
        if not tel:
            return
        try:
            t = msg.get("type")
            if t == "nettable_round_changed":
                # First round of a session is the closest signal to "match
                # started" that reaches _emit; capture every round but tag it.
                if msg.get("round") in (1, "1"):
                    tel.capture("match_started", {"round": msg.get("round")})
            elif t == "nettable_game_ended":
                tel.capture("game_ended", {})
            elif t == "nettable_end_board_saved":
                tel.capture("end_board_saved", {"at": msg.get("at")})
            elif t == "nettable_match_extracted":
                tel.capture("match_extracted", {
                    "match_id": msg.get("match_id"),
                    "player_count": msg.get("player_count"),
                })
            elif t == "nettable_debug_dump_done":
                # Prime "is capture working" signal — send per-table results.
                results = msg.get("results") or []
                tel.capture("nettable_debug_dump_done", {
                    "ok": msg.get("ok"),
                    "dumped": msg.get("dumped"),
                    "with_data": msg.get("with_data"),
                    "results": results,
                    "reason": msg.get("reason"),
                })
        except Exception:
            pass

    def _apply_game_tracking_flag(self) -> None:
        """Evaluate the remote game-tracking kill switch and apply it to the
        capture. Best-effort; fails open (tracking stays enabled on any error)."""
        tel = getattr(self, "_telemetry", None)
        if not tel or not self._nettable:
            return
        try:
            tel.refresh_flags()
            self._nettable.set_remote_enabled(tel.is_game_tracking_enabled())
        except Exception:
            pass

    def _start_log_upload_timer(self) -> None:
        """Periodically ship the full logs to Supabase so a fresh copy is always
        available, and re-sync the remote game-tracking kill switch. Re-uploads
        overwrite the same per-session objects (upsert), so this doesn't pile up
        storage. Best-effort, off the main thread."""
        tel = getattr(self, "_telemetry", None)
        if not tel:
            return
        self._stop_log_upload_timer()

        def tick():
            try:
                tel.upload_logs(reason="periodic")
            except Exception:
                pass
            # Re-sync the kill switch so flipping it in PostHog propagates to
            # already-running clients without a restart.
            self._apply_game_tracking_flag()
            if self._stop_event.is_set():
                return
            self._log_upload_timer = threading.Timer(LOG_UPLOAD_INTERVAL_SEC, tick)
            self._log_upload_timer.daemon = True
            self._log_upload_timer.start()

        # First upload after a short delay so an early-session crash still has
        # something; then every LOG_UPLOAD_INTERVAL_SEC.
        self._log_upload_timer = threading.Timer(LOG_UPLOAD_FIRST_DELAY_SEC, tick)
        self._log_upload_timer.daemon = True
        self._log_upload_timer.start()

    def _stop_log_upload_timer(self) -> None:
        if self._log_upload_timer:
            self._log_upload_timer.cancel()
            self._log_upload_timer = None

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
            tel = getattr(self, "_telemetry", None)
            if tel:
                try:
                    from updater import __version__
                    tel.identify(sid, steam_name=name, version=__version__)
                except Exception:
                    pass
            self._emit({"type": "steam_login", "steam_id": sid, "steam_name": name})
            self._emit_status()
            log.info("Steam login: %s (%s)", name, sid)

        threading.Thread(target=_login, daemon=True, name="steam-login").start()

    def _do_steam_logout(self) -> None:
        tel = getattr(self, "_telemetry", None)
        if tel:
            try:
                tel.clear_identity()
            except Exception:
                pass
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
        self._stop_log_upload_timer()

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
        tel = getattr(self, "_telemetry", None)
        if tel:
            try:
                # Final always-on upload so the very end of the session lands.
                tel.upload_logs(reason="shutdown")
                tel.capture("backend_stopped", {})
                tel.flush()
                tel.shutdown()
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
        elif cmd == "nettable_debug_dump":
            if self._nettable:
                threading.Thread(
                    target=self._nettable.debug_dump_sequence,
                    daemon=True,
                    name="nettable-debug-dump",
                ).start()
        elif cmd == "upload_logs":
            tel = getattr(self, "_telemetry", None)
            if tel:
                reason = msg.get("reason", "manual")
                threading.Thread(
                    target=tel.upload_logs,
                    kwargs={"reason": reason},
                    daemon=True,
                    name="upload-logs",
                ).start()
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

        # Apply the remote game-tracking kill switch now, then keep it in sync
        # on the periodic timer tick.
        self._apply_game_tracking_flag()

        # Always-on diagnostic log uploads (periodic). Independent of the kill
        # switch — logs/telemetry are observability and always run.
        self._start_log_upload_timer()

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
        def _capture_exception(exc_value, context):
            if exc_value is None:
                return
            try:
                import telemetry
                telemetry.capture_exception(exc_value, context)
                telemetry.flush()
                # Ship full logs to Supabase off-thread so network I/O doesn't
                # block the dying process (mirrors the upload_logs command).
                threading.Thread(
                    target=telemetry.upload_logs,
                    kwargs={"reason": "crash"},
                    daemon=True,
                    name="crash-upload-logs",
                ).start()
            except Exception:
                pass

        def _excepthook(exc_type, exc_value, exc_tb):
            log.critical("Unhandled exception", exc_info=(exc_type, exc_value, exc_tb))
            with open(crash_log, "a", encoding="utf-8") as f:
                f.write(f"\n{'='*60}\n{datetime.now()}\n")
                traceback.print_exception(exc_type, exc_value, exc_tb, file=f)
            _capture_exception(exc_value, {"origin": "excepthook"})
        sys.excepthook = _excepthook

        def _thread_excepthook(args):
            log.critical("Unhandled thread exception in %s",
                         args.thread.name if args.thread else "unknown",
                         exc_info=(args.exc_type, args.exc_value, args.exc_traceback))
            _capture_exception(args.exc_value, {
                "origin": "thread_excepthook",
                "thread": args.thread.name if args.thread else "unknown",
            })
        threading.excepthook = _thread_excepthook

        backend = HeadlessBackend()
        backend.run()
    except Exception as fatal_exc:
        with open(crash_log, "a", encoding="utf-8") as f:
            f.write(f"\n{'='*60}\n{datetime.now()} [FATAL]\n")
            traceback.print_exc(file=f)
        try:
            import telemetry
            telemetry.capture_exception(fatal_exc, {"origin": "main_fatal"})
            # Run the upload inline (and join) here: the process is about to
            # exit via `raise`, so a daemon thread would be killed mid-flight.
            telemetry.upload_logs(reason="crash")
            telemetry.flush()
            telemetry.shutdown()
        except Exception:
            pass
        raise


if __name__ == "__main__":
    main()
