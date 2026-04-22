"""DAC Tracker — Headless JSON Lines backend for Electron.

Communicates via stdin/stdout using JSON lines protocol.
Electron spawns this as a subprocess.

Usage:
    python headless.py
"""

import base64
import json
import logging
import os
import sys
import threading
from datetime import datetime
from pathlib import Path

# ── Tesseract setup (bundled or system) ───────────────────────────────────────

def _setup_tesseract():
    import pytesseract
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS)
        tess_exe = base / "tesseract" / "tesseract.exe"
        if tess_exe.exists():
            pytesseract.pytesseract.tesseract_cmd = str(tess_exe)
            os.environ["TESSDATA_PREFIX"] = str(base / "tesseract" / "tessdata")

_setup_tesseract()

# ── Config & paths ────────────────────────────────────────────────────────────

from utils import (
    DAC_DIR,
    DATA_DIR,
    ICONS_DIR,
    infer_aspect_ratio,
    load_config,
    load_regions_config,
    save_config,
)

APP_NAME = "DAC Tracker"
LOG_PATH = DAC_DIR / "tracker.log"

# Maximum seconds an import is allowed to run before we abandon it and
# release the import lock so the user can retry.
IMPORT_TIMEOUT_SEC = 90

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
        self._sentinel = None
        self._replay_recorder = None
        self._game_focused = False
        self._pending_rows = None
        self._pending_timestamps = None
        self._pending_img = None
        self._pending_screenshot_path = None
        self._last_replay_filename = None
        self._status_timer = None

        # Serialise screenshot imports — concurrent imports race on the
        # _pending_* state above and corrupt the confirmation flow.
        self._import_lock = threading.Lock()
        self._import_in_progress = False
        self._import_generation = 0

        # Ensure user exists in DB if already logged in
        sid = self.config.get("steam_id")
        if sid:
            from db import ensure_user
            ensure_user(sid, name=self.config.get("steam_name"))

        # Init replay system
        if self.config.get("replay_enabled", True):
            self._init_replay()

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
            "replay_enabled": self.config.get("replay_enabled", True),
            "recording_stats": rec_stats,
        })

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

    # ── Sentinel poller ─────────────────────────────────────────────────────

    def _start_sentinel(self) -> None:
        from sentinel import (
            SentinelPoller, SentinelTarget,
            FINAL_RANKING_TEMPLATE, FINAL_RANKING_REGION,
            ROUND_START_TEMPLATE, ROUND_START_REGION,
        )
        import screen_capture

        regions_config = load_regions_config()
        try:
            monitor = screen_capture.monitors()[1]
            ar_key = infer_aspect_ratio(monitor["width"], monitor["height"], list(regions_config.keys()))
        except Exception:
            ar_key = "16:9"

        ar_data = regions_config.get(ar_key) or {}

        def _search_region(screen_key: str, fallback: dict) -> dict:
            region = (ar_data.get(screen_key) or {}).get("search_region") or []
            if len(region) == 4:
                return {"x0": region[0], "y0": region[1], "x1": region[2], "y1": region[3]}
            return dict(fallback)

        final_region = _search_region("sentinel_final_ranking", FINAL_RANKING_REGION)
        round_region = _search_region("sentinel_round_start", ROUND_START_REGION)

        targets = [
            SentinelTarget(
                name="final_ranking",
                template_path=FINAL_RANKING_TEMPLATE,
                search_region=final_region,
                on_match=self._on_game_end,
                ref_height=47,  # template height at 1440p
            ),
            SentinelTarget(
                name="round_start",
                template_path=ROUND_START_TEMPLATE,
                search_region=round_region,
                on_match=self._on_round_start,
                ref_height=134,  # template is 134px at 1440p
            ),
        ]

        self._sentinel = SentinelPoller(
            targets=targets,
            on_focus_gained=self._on_game_focus_gained,
            on_focus_lost=self._on_game_focus_lost,
        )
        self._sentinel.start()

    def _on_round_start(self) -> None:
        """Round starting — begin replay recording if not already recording."""
        log.info("Sentinel: Round start detected")
        if self._replay_recorder and not self._replay_recorder.recording:
            if self._replay_recorder.start():
                log.info("Auto-started replay recording")
                self._emit({"type": "replay_started"})
                self._emit_notification(APP_NAME, "Game started — recording replay")
                self._start_status_timer()

    def _on_game_end(self) -> None:
        """Final Ranking detected — stop recording and prompt capture."""
        log.info("Sentinel: Final Ranking detected")

        # Stop replay recording in background (game ended)
        if self._replay_recorder and self._replay_recorder.recording:
            threading.Thread(target=self._stop_recording, daemon=True, name="stop-rec").start()

        self._emit({"type": "sentinel_match"})
        self._emit_notification(APP_NAME, "Game ended! Open Match History and click Capture.")

    # ── Capture + Parse ─────────────────────────────────────────────────────

    def _save_screenshot_local(self, img) -> str:
        """Save screenshot to ~/.dac/screenshots/. Returns the file path."""
        import cv2
        ss_dir = DAC_DIR / "screenshots"
        ss_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = ss_dir / f"{ts}.png"
        cv2.imwrite(str(path), img)
        log.info("Screenshot saved locally: %s", path)
        return str(path)

    def _update_manifest(self, screenshot_path: str, **fields) -> None:
        """Update manifest.json entry for a screenshot with arbitrary fields."""
        manifest_path = DAC_DIR / "screenshots" / "manifest.json"
        manifest = {}
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        filename = Path(screenshot_path).name
        entry = manifest.get(filename, {})
        entry.update(fields)
        manifest[filename] = entry
        try:
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        except Exception as e:
            log.warning("Failed to update screenshot manifest: %s", e)

    def _mark_screenshot_uploaded(self, screenshot_path: str) -> None:
        """Record that a screenshot has been uploaded to the database."""
        self._update_manifest(screenshot_path, uploaded_at=datetime.now().isoformat())

    def _save_parse_result(self, screenshot_path: str, rows: list, timestamps: list) -> None:
        stem = Path(screenshot_path).stem
        parse_path = DAC_DIR / "screenshots" / f"{stem}.parse.json"
        try:
            parse_path.write_text(json.dumps({
                "rows": rows,
                "timestamps": timestamps,
            }, indent=2), encoding="utf-8")
            log.info("Saved parse result: %s", parse_path)
        except Exception as e:
            log.warning("Failed to save parse result: %s", e)

    def _do_capture(self) -> None:
        """Screenshot + detect + parse, emitting results."""
        import capture
        from cv_parser import detect_screen_type

        try:
            img = capture.capture_screen()
            if img is None:
                self._emit_error("Screenshot capture failed")
                self._emit_notification(APP_NAME, "Screenshot capture failed.")
                return

            # Always save locally first
            local_path = self._save_screenshot_local(img)

            screen_type = detect_screen_type(img)
            log.info("Capture: detected screen type '%s'", screen_type)

            # Store screen type in manifest for future reference
            self._update_manifest(local_path, screen_type=screen_type)
            if screen_type in ("my_matches", "game_over"):
                label = "My Matches" if screen_type == "my_matches" else "Game Over"
                self._emit({
                    "type": "processing_screenshot",
                    "screenshot_b64": self._preview_b64(img),
                    "screenshot_name": Path(local_path).name,
                    "screenshot_path": local_path,
                    "screen_type": screen_type,
                    "message": f"Loading screenshot and processing {label}...",
                })

            if screen_type == "my_matches":
                self._emit_notification(APP_NAME, "My Matches detected — parsing...")
                self._do_parse_my_matches(img, screenshot_path=local_path)
            elif screen_type == "game_over":
                self._emit_notification(APP_NAME, "Game Over detected — parsing all players...")
                self._do_parse_game_over(img, screenshot_path=local_path)
            else:
                hotkey = self.config.get("hotkey", "F6")
                self._emit_notification(
                    APP_NAME,
                    f"Not on My Matches page (detected: {screen_type}). "
                    f"Navigate to My Matches and press {hotkey}.",
                )
        except Exception as e:
            log.error("capture error: %s", e, exc_info=True)
            self._emit_error(f"Capture error: {e}")

    def _do_parse_my_matches(self, img, screenshot_path: str = "", screenshot_time=None) -> None:
        """Parse a My Matches screen image and emit parse_result."""
        import cv2
        from cv_parser import parse_my_matches, infer_timestamps

        try:
            if isinstance(img, Path):
                img = cv2.imread(str(img))
                if img is None:
                    self._emit_error("Failed to read image")
                    return

            player = self.config.get("player_name", "jack")
            if screenshot_time is None:
                screenshot_time = datetime.now()
            rows = parse_my_matches(img, player, ICONS_DIR, debug=True)
            if not rows:
                log.warning("MY MATCHES: no rows parsed")
                self._emit_notification(APP_NAME, "MY MATCHES: no rows parsed.")
                return
            log.info("Parsed %d row(s) from MY MATCHES", len(rows))

            timestamps = infer_timestamps(rows, screenshot_time)

            # Mark duplicates so the confirmation UI can highlight them
            try:
                from db import game_exists as _game_exists
                _user_id = self.config.get("steam_id") or None
                if _user_id:
                    for r, ts in zip(rows, timestamps):
                        lineup = "|".join(r.get("units", []))
                        r["is_duplicate"] = _game_exists(
                            _user_id, ts,
                            r.get("placement", ""),
                            r.get("wl", ""),
                            r.get("level", ""),
                            lineup,
                        )
            except Exception as _e:
                log.warning("Pre-import duplicate check failed: %s", _e)

            # Store pending data for confirmation
            self._pending_rows = rows
            self._pending_timestamps = timestamps
            self._pending_img = img
            self._pending_screenshot_path = screenshot_path

            screenshot_b64 = self._preview_b64(img)

            self._emit({
                "type": "parse_result",
                "rows": rows,
                "timestamps": timestamps,
                "screenshot_b64": screenshot_b64,
                "screenshot_name": Path(screenshot_path).name if screenshot_path else "",
                "screenshot_path": screenshot_path,
                "screen_type": "my_matches",
            })

            if screenshot_path:
                self._save_parse_result(screenshot_path, rows, timestamps)

        except Exception as e:
            log.error("parse error: %s", e, exc_info=True)
            self._emit_error(f"Parse error: {e}")

    def _do_parse_game_over(self, img, screenshot_path: str = "") -> None:
        """Parse a Game Over screen — extract all 8 players and push to DB."""
        import cv2
        from cv_parser import parse_game_over_all
        from models import GameRow
        from db import push_game, game_exists, lookup_users_by_name, generate_match_id

        try:
            if isinstance(img, Path):
                img = cv2.imread(str(img))
                if img is None:
                    self._emit_error("Failed to read image")
                    return

            all_rows = parse_game_over_all(img, ICONS_DIR, debug=True)
            if not all_rows:
                log.warning("GAME OVER: no rows parsed")
                self._emit_notification(APP_NAME, "GAME OVER: no rows parsed.")
                return
            log.info("Parsed %d player(s) from GAME OVER", len(all_rows))

            played_at = datetime.now().isoformat()
            my_user_id = self.config.get("steam_id") or None

            # Upload screenshot once
            screenshot_url = ""
            if my_user_id:
                try:
                    from db import upload_screenshot
                    screenshot_url = upload_screenshot(img, my_user_id) or ""
                except ImportError:
                    screenshot_url = ""

            # Look up player names against existing users
            ocr_names = [r.get("player_name", "") for r in all_rows]
            name_to_steam_id = lookup_users_by_name(ocr_names)
            log.info("User lookup: matched %d/%d names", len(name_to_steam_id), len(ocr_names))

            def _norm_name(value: str) -> str:
                return str(value or "").strip().lower()

            my_name_key = _norm_name(self.config.get("steam_name", ""))
            resolved_rows: list[tuple[dict, str | None]] = []
            linked_detected = 0

            for row in all_rows:
                user_id = None
                normalized_name = _norm_name(row.get("player_name", ""))
                if normalized_name:
                    steam_id = name_to_steam_id.get(normalized_name)
                    if steam_id:
                        user_id = str(steam_id)
                    elif my_user_id and my_name_key and normalized_name == my_name_key:
                        user_id = str(my_user_id)
                if my_user_id and user_id == my_user_id:
                    linked_detected += 1
                resolved_rows.append((row, user_id))

            if my_user_id and linked_detected == 0:
                self._emit_import_result(
                    imported=0,
                    skipped=0,
                    failed=0,
                    message=(
                        "Game Over import stopped: none of the parsed player names matched "
                        "your account. Check Screenshot Debug or recalibrate the Game Over regions."
                    ),
                    tone="warning",
                    screen_type="game_over",
                    linked_to_user=0,
                )
                return

            match_id = generate_match_id()
            imported = 0
            skipped = 0
            failed = 0
            linked_imported = 0
            linked_skipped = 0
            linked_failed = 0
            for r, user_id in resolved_rows:
                placement = r.get("placement", "")
                wl = r.get("wl", "")
                level = r.get("level", "")
                linked_to_user = bool(my_user_id and user_id == my_user_id)

                # If no user matched, this row has no owner — still store it
                # (match_id links it to the match)

                # Skip duplicates for known users
                if user_id and game_exists(user_id, played_at, placement, wl, level):
                    log.info("  row %s: SKIP duplicate (user=%s place=%s)", placement, user_id, placement)
                    skipped += 1
                    if linked_to_user:
                        linked_skipped += 1
                    continue
                game_row = GameRow(
                    played_at=played_at,
                    placement=placement,
                    rank=r.get("rank", ""),
                    rank_change="none",
                    lineup="",
                    synergies=r.get("synergies", ""),
                    talents="",
                    relic=r.get("relic", ""),
                    level=level,
                    wl=wl,
                    screenshot=screenshot_url,
                    notes="",
                    replay=self._last_replay_filename or "",
                    match_id=match_id,
                )
                if push_game(game_row, user_id=user_id):
                    imported += 1
                    if linked_to_user:
                        linked_imported += 1
                else:
                    failed += 1
                    if linked_to_user:
                        linked_failed += 1
            detail_parts: list[str] = []
            if skipped:
                detail_parts.append(f"{skipped} duplicate(s) skipped")
            if failed:
                detail_parts.append(f"{failed} failed to save")

            if linked_imported > 0:
                msg = f"Imported {imported} player row(s), including {linked_imported} linked to your account"
                tone = "success" if failed == 0 else "warning"
            elif linked_skipped > 0 and linked_failed == 0:
                if imported > 0:
                    msg = (
                        f"Imported {imported} other player row(s), but your row was already "
                        "in History, so nothing new was added for you"
                    )
                else:
                    msg = "No new player rows imported. Your row was already in History"
                tone = "warning"
            elif linked_failed > 0:
                if imported > 0:
                    msg = (
                        f"Imported {imported} other player row(s), but your row could not be "
                        "saved, so nothing new was added to History"
                    )
                else:
                    msg = "No player rows were imported. Your row could not be saved"
                tone = "error" if imported == 0 else "warning"
            elif imported > 0:
                msg = f"Imported {imported} player row(s)"
                tone = "success" if failed == 0 else "warning"
            else:
                msg = "No player rows were imported"
                tone = "error" if failed else "warning"

            if detail_parts:
                msg += f" ({', '.join(detail_parts)})"

            self._emit_import_result(
                imported=imported,
                skipped=skipped,
                failed=failed,
                message=msg,
                tone=tone,
                screen_type="game_over",
                linked_to_user=linked_imported,
            )

            if screenshot_path and (linked_imported > 0 or linked_skipped > 0):
                self._update_manifest(screenshot_path, imported_at=datetime.now().isoformat())

        except Exception as e:
            log.error("parse_game_over error: %s", e, exc_info=True)
            self._emit_error(f"Game Over parse error: {e}")

    def _do_confirm(self, selected: list, edits: dict) -> None:
        """Push confirmed rows to DB."""
        from models import GameRow
        from db import game_exists, push_game

        if self._pending_rows is None:
            self._emit_error("No pending parse result to confirm")
            return

        rows = self._pending_rows
        timestamps = self._pending_timestamps
        img = self._pending_img
        user_id = self.config.get("steam_id") or None

        try:
            # Upload screenshot once for the whole batch
            screenshot_url = ""
            if user_id and img is not None:
                try:
                    from db import upload_screenshot
                    screenshot_url = upload_screenshot(img, user_id) or ""
                except ImportError:
                    screenshot_url = ""
            # Fall back to local path if upload failed or no user
            if not screenshot_url and self._pending_screenshot_path:
                from urllib.parse import quote
                screenshot_url = "screenshot://" + quote(str(self._pending_screenshot_path), safe="")

            imported = 0
            skipped = 0
            failed = 0

            for idx in selected:
                if idx < 0 or idx >= len(rows):
                    continue
                r = dict(rows[idx])
                played_at = timestamps[idx] if idx < len(timestamps) else ""

                # Apply edits if provided
                idx_str = str(idx)
                if idx_str in edits:
                    for key, val in edits[idx_str].items():
                        r[key] = val

                lineup = "|".join(r.get("units", []))
                placement = r.get("placement", "")
                wl = r.get("wl", "")
                level = r.get("level", "")

                # Skip duplicates
                if user_id and game_exists(user_id, played_at, placement, wl, level, lineup):
                    log.info("  row %d: SKIP duplicate (place=%s wl=%s level=%s)", idx, placement, wl, level)
                    skipped += 1
                    continue

                log.info(
                    "  row %d: place=%s level=%s wl=%s rank=%s units=[%s]",
                    idx, placement, level, wl, r.get("rank"), lineup,
                )
                game_row = GameRow(
                    played_at=played_at,
                    placement=placement,
                    rank=r.get("rank", ""),
                    rank_change=r.get("rank_change", "none"),
                    lineup=lineup,
                    synergies=r.get("synergies", ""),
                    talents="",
                    relic=r.get("relic", ""),
                    level=level,
                    wl=wl,
                    screenshot=screenshot_url,
                    notes="",
                    replay=self._last_replay_filename or "",
                )
                if push_game(game_row, user_id=user_id):
                    imported += 1
                else:
                    failed += 1

            # Mark screenshot as imported (games saved)
            if self._pending_screenshot_path and imported > 0:
                self._update_manifest(self._pending_screenshot_path, imported_at=datetime.now().isoformat())

            # Mark screenshot as uploaded if we got a remote URL (not local fallback)
            if screenshot_url and self._pending_screenshot_path and not screenshot_url.startswith("screenshot://"):
                self._mark_screenshot_uploaded(self._pending_screenshot_path)

            detail_parts: list[str] = []
            if skipped:
                detail_parts.append(f"{skipped} duplicate(s) skipped")
            if failed:
                detail_parts.append(f"{failed} failed to save")

            if imported > 0:
                msg = f"Imported {imported} match(es)"
                tone = "success" if failed == 0 else "warning"
            elif skipped and not failed:
                msg = "No new matches imported"
                tone = "warning"
            else:
                msg = "No matches were imported"
                tone = "error" if failed else "warning"

            if detail_parts:
                msg += f" ({', '.join(detail_parts)})"

            self._emit_import_result(
                imported=imported,
                skipped=skipped,
                failed=failed,
                message=msg,
                tone=tone,
                screen_type="my_matches",
                linked_to_user=imported,
            )

        except Exception as e:
            log.error("confirm error: %s", e, exc_info=True)
            self._emit_error(f"Confirm error: {e}")
        finally:
            self._pending_rows = None
            self._pending_timestamps = None
            self._pending_img = None
            self._pending_screenshot_path = None
            self._last_replay_filename = None

    def _do_cancel_confirm(self) -> None:
        self._pending_rows = None
        self._pending_timestamps = None
        self._pending_img = None
        self._pending_screenshot_path = None
        log.info("Confirmation cancelled")

    # ── Import file ─────────────────────────────────────────────────────────

    def _emit_import_finished(self) -> None:
        self._emit({"type": "import_finished"})

    def _emit_import_result(
        self,
        *,
        imported: int,
        skipped: int = 0,
        failed: int = 0,
        message: str,
        tone: str = "success",
        screen_type: str = "",
        linked_to_user: int | None = None,
    ) -> None:
        payload = {
            "type": "import_result",
            "imported": imported,
            "skipped": skipped,
            "failed": failed,
            "message": message,
            "tone": tone,
        }
        if screen_type:
            payload["screen_type"] = screen_type
        if linked_to_user is not None:
            payload["linked_to_user"] = linked_to_user
        self._emit(payload)
        self._emit_notification(APP_NAME, message)

    def _dispatch_import(self, path_str: str) -> None:
        """Serialise import requests and arm a watchdog so a hung CV pass
        cannot wedge the backend forever."""
        with self._import_lock:
            if self._import_in_progress:
                self._emit_error(
                    "An import is already in progress. Please wait for it to finish."
                )
                self._emit_notification(
                    APP_NAME, "Import already in progress — please wait."
                )
                self._emit_import_finished()
                return
            self._import_in_progress = True
            self._import_generation += 1
            gen = self._import_generation

        threading.Thread(
            target=self._run_import_file,
            args=(path_str, gen),
            daemon=True,
            name="import-file",
        ).start()

    def _run_import_file(self, path_str: str, gen: int) -> None:
        timed_out = threading.Event()

        def _on_timeout():
            timed_out.set()
            log.error(
                "Import timed out after %ds: %s", IMPORT_TIMEOUT_SEC, path_str
            )
            self._emit_error(
                f"Import timed out after {IMPORT_TIMEOUT_SEC}s. The screenshot may be corrupted or unsupported."
            )
            self._emit_notification(
                APP_NAME,
                f"Import timed out — try a different screenshot.",
            )
            with self._import_lock:
                # Only release if our generation is still the latest;
                # otherwise a newer import has already taken the slot.
                if self._import_generation == gen:
                    self._import_in_progress = False
                    self._pending_rows = None
                    self._pending_timestamps = None
                    self._pending_img = None
                    self._pending_screenshot_path = None
            self._emit_import_finished()

        timer = threading.Timer(IMPORT_TIMEOUT_SEC, _on_timeout)
        timer.daemon = True
        timer.start()
        try:
            self._do_import_file(path_str)
        except Exception as e:
            log.error("import error: %s", e, exc_info=True)
            if not timed_out.is_set():
                self._emit_error(f"Import error: {e}")
        finally:
            timer.cancel()
            with self._import_lock:
                still_current = self._import_generation == gen
                if still_current and not timed_out.is_set():
                    self._import_in_progress = False
            if not timed_out.is_set():
                self._emit_import_finished()

    def _do_import_file(self, path_str: str) -> None:
        import cv2
        from cv_parser import detect_screen_type

        path = Path(path_str)
        if not path.exists():
            self._emit_error(f"File not found: {path}")
            return

        # Skip if already imported
        manifest_path = DAC_DIR / "screenshots" / "manifest.json"
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                entry = manifest.get(path.name, {})
                if entry.get("imported_at"):
                    self._emit_notification(APP_NAME, "Screenshot already imported, skipping.")
                    return
            except Exception:
                pass

        log.info("Import file: %s", path)
        img = cv2.imread(str(path))
        if img is None:
            self._emit_error(f"Failed to read image: {path}")
            return

        # Detect screen type so the manifest stays in sync with what was
        # captured (and so re-imports update an out-of-date entry).
        screen_type = detect_screen_type(img)
        log.info("Import: detected screen type '%s'", screen_type)
        self._update_manifest(path_str, screen_type=screen_type)

        # Use file modification time instead of current time for date inference
        file_mtime = datetime.fromtimestamp(path.stat().st_mtime)

        if screen_type == "my_matches":
            self._do_parse_my_matches(img, screenshot_path=path_str, screenshot_time=file_mtime)
        elif screen_type == "game_over":
            self._do_parse_game_over(img, screenshot_path=path_str)
        else:
            self._emit_error(
                f"Cannot import — screen type '{screen_type}' is not supported."
            )
            self._emit_notification(
                APP_NAME,
                f"Cannot import: screen not recognised (detected '{screen_type}').",
            )

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
        if self._sentinel:
            try:
                self._sentinel.stop()
            except Exception:
                pass

    # ── Command dispatch ────────────────────────────────────────────────────

    def _handle_command(self, msg: dict) -> None:
        cmd = msg.get("cmd")
        log.info("Command received: %s", cmd)
        if cmd == "capture":
            threading.Thread(target=self._do_capture, daemon=True, name="capture").start()
        elif cmd == "confirm":
            selected = msg.get("selected", [])
            edits = msg.get("edits", {})
            threading.Thread(
                target=self._do_confirm, args=(selected, edits),
                daemon=True, name="confirm",
            ).start()
        elif cmd == "cancel_confirm":
            self._do_cancel_confirm()
        elif cmd == "import_file":
            self._dispatch_import(msg.get("path", ""))
        elif cmd == "steam_login":
            self._do_steam_login()
        elif cmd == "steam_logout":
            self._do_steam_logout()
        elif cmd == "toggle_recording":
            self._do_toggle_recording()
        elif cmd == "set_config":
            self._do_set_config(msg.get("key", ""), msg.get("value"))
        elif cmd == "status":
            self._emit_status()
        elif cmd == "debug_screenshot":
            img_path = msg.get("path", "")
            threading.Thread(
                target=self._do_debug_screenshot, args=(img_path,),
                daemon=True, name="debug-screenshot",
            ).start()
        elif cmd == "debug_view":
            img_path = msg.get("path", "")
            screen = msg.get("screen", "")
            regions = msg.get("regions", {}) or {}
            aspect_ratio = msg.get("aspect_ratio")
            threading.Thread(
                target=self._do_debug_view,
                args=(img_path, screen, regions, aspect_ratio),
                daemon=True,
                name="debug-view",
            ).start()
        elif cmd == "debug_saved_screenshot":
            img_path = msg.get("path", "")
            screen_type = msg.get("screen_type")
            threading.Thread(
                target=self._do_debug_saved_screenshot,
                args=(img_path, screen_type),
                daemon=True,
                name="debug-saved-screenshot",
            ).start()
        elif cmd == "quit":
            self._shutdown()
        else:
            self._emit_error(f"Unknown command: {cmd}")

    # ── Debug / Calibration ──────────────────────────────────────────────────

    @staticmethod
    def _img_b64(img, ext: str = ".jpg") -> str:
        import cv2

        if img is None or getattr(img, "size", 0) == 0:
            return ""
        params = [cv2.IMWRITE_JPEG_QUALITY, 88] if ext == ".jpg" else []
        ok, buf = cv2.imencode(ext, img, params)
        return base64.b64encode(buf).decode() if ok else ""

    def _regions_to_crops(self, img, regions: dict) -> list[dict]:
        h, w = img.shape[:2]
        crops = []
        for name, coords in (regions or {}).items():
            if not isinstance(coords, list):
                continue
            if len(coords) >= 4:
                x0, y0, x1, y1 = coords[:4]
                crop = img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
            elif len(coords) == 2:
                x0, x1 = coords
                crop = img[:, int(x0 * w):int(x1 * w)]
            else:
                continue
            crops.append({"name": name, "image": self._img_b64(crop), "coords": coords})
        return crops

    def _preview_b64(self, img, max_w: int = 900) -> str:
        try:
            from PIL import Image as PILImage
            import io
            import numpy as np

            rgb = img[:, :, ::-1] if isinstance(img, np.ndarray) else img
            pil_img = PILImage.fromarray(rgb)
            if pil_img.width > max_w:
                ratio = max_w / pil_img.width
                pil_img = pil_img.resize((max_w, int(pil_img.height * ratio)), PILImage.LANCZOS)
            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG", quality=80)
            return base64.b64encode(buf.getvalue()).decode("ascii")
        except Exception as e:
            log.warning("Failed to encode preview image: %s", e)
            return ""

    def _resolve_debug_regions(self, screen: str, aspect_ratio: str, regions_config: dict) -> dict:
        ar_data = regions_config.get(aspect_ratio) or {}
        key_map = {
            "game_over": "game_over",
            "my_matches": "my_matches",
            "final_ranking": "sentinel_final_ranking",
            "sentinel_final_ranking": "sentinel_final_ranking",
            "sentinel_round_start": "sentinel_round_start",
        }
        return dict(ar_data.get(key_map.get(screen, screen)) or {})

    def _do_debug_screenshot(self, img_path: str) -> None:
        try:
            import cv2
            from cv_parser import apply_calibration, detect_screen_type

            img = cv2.imread(img_path)
            if img is None:
                self._emit({"type": "debug_result", "data": {"error": f"Cannot read {img_path}"}})
                return

            apply_calibration(img)
            h, w = img.shape[:2]
            screen_type = detect_screen_type(img)
            result = {"width": w, "height": h, "screen_type": screen_type, "rows": []}

            if screen_type == "my_matches":
                from cv_parser import (
                    _find_my_matches_rows, _parse_my_matches_row,
                    _load_templates_multiscale,
                    UNIT_ICON_SCALES, RELIC_ICON_SCALES, MM_SYNERGY_ICON_SCALES,
                )
                from utils import ICONS_DIR, DATA_DIR, unit_stem as _unit_stem
                import json as _json

                units_path = DATA_DIR / "units.json"
                units_data = _json.loads(units_path.read_text())["units"] if units_path.exists() else {}
                stem_to_name = {_unit_stem(name): name for name in units_data}

                unit_templates = _load_templates_multiscale(
                    ICONS_DIR / "units", UNIT_ICON_SCALES, inner_frac=0.85, color=True)
                relic_templates = _load_templates_multiscale(
                    ICONS_DIR / "relics", RELIC_ICON_SCALES, inner_frac=1.0, color=True)
                syn_templates = _load_templates_multiscale(
                    ICONS_DIR / "synergies", MM_SYNERGY_ICON_SCALES)

                rows = _find_my_matches_rows(img)
                for i, (y0, y1) in enumerate(rows):
                    row_data = _parse_my_matches_row(
                        img, y0, y1,
                        unit_templates, relic_templates, syn_templates, ICONS_DIR,
                        units_data, stem_to_name,
                        debug=False, row_idx=i,
                    )
                    row_data["y0"] = y0
                    row_data["y1"] = y1
                    result["rows"].append(row_data)

            elif screen_type == "game_over":
                from cv_parser import parse_game_over
                game_data = parse_game_over(img)
                result["game_data"] = game_data

            self._emit({"type": "debug_result", "data": result})
        except Exception as e:
            log.exception("debug_screenshot error")
            self._emit({"type": "debug_result", "data": {"error": str(e)}})

    def _do_debug_view(
        self,
        img_path: str,
        screen: str,
        regions: dict,
        aspect_ratio: str | None = None,
    ) -> None:
        try:
            import cv2
            from cv_parser import (
                COL_LEVEL,
                COL_PLAYER,
                COL_RELIC,
                COL_SYNERGY,
                COL_WL,
                MM_COL_LEVEL,
                MM_COL_PLACEMENT,
                MM_COL_RANK,
                MM_COL_RELIC,
                MM_COL_SYNERGY,
                MM_COL_TIME,
                MM_COL_UNITS,
                MM_COL_WL,
                _crop_row,
                _find_my_matches_rows,
                _parse_my_matches_row,
                _row_y_extent,
                _load_templates_multiscale,
                apply_calibration,
                parse_game_over_all,
            )
            from db import lookup_users_by_name
            from utils import DATA_DIR, crop as _crop, unit_stem as _unit_stem
            import json as _json

            img = cv2.imread(img_path)
            if img is None:
                self._emit({"type": "debug_result", "data": {"error": f"Cannot read {img_path}"}})
                return

            regions_config = load_regions_config()
            if not aspect_ratio:
                h, w = img.shape[:2]
                aspect_ratio = infer_aspect_ratio(w, h, list(regions_config.keys()))
            if not regions:
                regions = self._resolve_debug_regions(screen, aspect_ratio, regions_config)
            apply_calibration(img, aspect_ratio=aspect_ratio, regions_config=regions_config)

            h, w = img.shape[:2]
            result = {
                "width": w,
                "height": h,
                "screen_type": screen,
                "aspect_ratio": aspect_ratio,
                "region_crops": self._regions_to_crops(img, regions),
            }

            if screen == "game_over":
                rows = parse_game_over_all(img, ICONS_DIR, debug=False) or []
                name_map = lookup_users_by_name([r.get("player_name", "") for r in rows])
                result["rows"] = []
                for i, row in enumerate(rows):
                    y0, y1 = _row_y_extent(i)
                    row_out = dict(row)
                    player_name = (row.get("player_name") or "").lower().strip()
                    matched_user_id = name_map.get(player_name)
                    row_out["db_match"] = bool(matched_user_id)
                    row_out["matched_user_id"] = str(matched_user_id) if matched_user_id else ""
                    row_out["row_image"] = self._img_b64(img[int(y0 * h):int(y1 * h), :])
                    row_out["player_crop"] = self._img_b64(_crop_row(img, COL_PLAYER, y0, y1))
                    row_out["level_crop"] = self._img_b64(_crop_row(img, COL_LEVEL, y0, y1))
                    row_out["synergy_crop"] = self._img_b64(_crop_row(img, COL_SYNERGY, y0, y1))
                    row_out["relic_crop"] = self._img_b64(_crop_row(img, COL_RELIC, y0, y1))
                    row_out["wl_crop"] = self._img_b64(_crop_row(img, COL_WL, y0, y1))
                    result["rows"].append(row_out)

            elif screen == "my_matches":
                units_path = DATA_DIR / "units.json"
                units_data = _json.loads(units_path.read_text())["units"] if units_path.exists() else {}
                stem_to_name = {_unit_stem(name): name for name in units_data}
                unit_templates = _load_templates_multiscale(
                    ICONS_DIR / "units", [24, 28, 32, 36, 40, 44], inner_frac=0.85, color=True
                )
                relic_templates = _load_templates_multiscale(
                    ICONS_DIR / "relics", [12, 14, 16, 20, 24, 28, 32, 40, 50, 60], inner_frac=1.0, color=True
                )
                syn_templates = _load_templates_multiscale(
                    ICONS_DIR / "synergies", [20, 24, 28, 32]
                )
                parsed_rows = []
                for i, (y0, y1) in enumerate(_find_my_matches_rows(img, debug=False)):
                    row_data = _parse_my_matches_row(
                        img, y0, y1,
                        unit_templates, relic_templates, syn_templates, ICONS_DIR,
                        units_data, stem_to_name,
                        debug=False, row_idx=i,
                    )
                    rh = y1 - y0
                    row_data["row_image"] = self._img_b64(img[int(y0 * h):int(y1 * h), :])
                    row_data["placement_crop"] = self._img_b64(_crop(img, MM_COL_PLACEMENT[0], y0 + rh * 0.15, MM_COL_PLACEMENT[1], y0 + rh * 0.75))
                    row_data["level_crop"] = self._img_b64(_crop(img, MM_COL_LEVEL[0], y0 + rh * 0.30, MM_COL_LEVEL[1], y0 + rh * 0.75))
                    row_data["units_crop"] = self._img_b64(_crop(img, MM_COL_UNITS[0], y0, MM_COL_UNITS[1], y1))
                    row_data["synergy_crop"] = self._img_b64(_crop_row(img, MM_COL_SYNERGY, y0, y1))
                    row_data["relic_crop"] = self._img_b64(_crop(img, MM_COL_RELIC[0], y0, MM_COL_RELIC[1], y1))
                    row_data["wl_crop"] = self._img_b64(_crop(img, MM_COL_WL[0], y0 + rh * 0.55, MM_COL_WL[1], y0 + rh * 0.95))
                    row_data["rank_crop"] = self._img_b64(_crop(img, MM_COL_RANK[0], y0 + rh * 0.20, MM_COL_RANK[1], y0 + rh * 0.80))
                    row_data["time_crop"] = self._img_b64(_crop(img, MM_COL_TIME[0], y0 + rh * 0.65, MM_COL_TIME[1], y1))
                    parsed_rows.append(row_data)
                result["rows"] = parsed_rows

            elif screen.startswith("sentinel_"):
                self._emit({"type": "debug_result", "data": self._run_sentinel_debug(img, screen, regions, result)})
                return

            self._emit({"type": "debug_result", "data": result})
        except Exception as e:
            log.exception("debug_view error")
            self._emit({"type": "debug_result", "data": {"error": str(e)}})

    def _do_debug_saved_screenshot(self, img_path: str, screen_type: str | None = None) -> None:
        try:
            import cv2
            from cv_parser import apply_calibration, detect_screen_type

            img = cv2.imread(img_path)
            if img is None:
                self._emit({"type": "debug_result", "data": {"error": f"Cannot read {img_path}"}})
                return

            regions_config = load_regions_config()
            h, w = img.shape[:2]
            aspect_ratio = infer_aspect_ratio(w, h, list(regions_config.keys()))
            apply_calibration(img, aspect_ratio=aspect_ratio, regions_config=regions_config)
            screen = detect_screen_type(img) if not screen_type or screen_type == "unknown" else screen_type
            if screen == "final_ranking":
                screen = "sentinel_final_ranking"

            self._do_debug_view(
                img_path,
                screen,
                self._resolve_debug_regions(screen, aspect_ratio, regions_config),
                aspect_ratio,
            )
        except Exception as e:
            log.exception("debug_saved_screenshot error")
            self._emit({"type": "debug_result", "data": {"error": str(e)}})

    def _run_sentinel_debug(self, img, screen: str, regions: dict, result: dict) -> dict:
        import cv2

        h, w = img.shape[:2]
        search = (regions or {}).get("search_region") or []
        if len(search) < 4:
            return {"error": "No search_region defined"}

        x0 = int(search[0] * w)
        y0 = int(search[1] * h)
        x1 = int(search[2] * w)
        y1 = int(search[3] * h)
        crop = img[y0:y1, x0:x1]

        template_name = (
            "sentinel_ref_final_ranking.png"
            if screen == "sentinel_final_ranking"
            else "sentinel_ref_round_start.png"
        )
        template = cv2.imread(str(DATA_DIR / template_name), cv2.IMREAD_GRAYSCALE)
        crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        if template is None:
            return {"error": f"Template not found: {template_name}"}
        th, tw = template.shape[:2]
        ch, cw = crop_gray.shape[:2]
        if tw > cw or th > ch:
            return {"error": "Template larger than crop", "crop": self._img_b64(crop)}

        match = cv2.matchTemplate(crop_gray, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(match)
        return {
            **result,
            "crop": self._img_b64(crop),
            "results": {
                template_name: {
                    "score": round(float(max_val), 4),
                    "location": list(max_loc),
                }
            },
        }

    # ── Main loop ───────────────────────────────────────────────────────────

    def run(self) -> None:
        """Start sentinel, then read stdin commands until quit or EOF."""
        self._start_sentinel()

        from updater import __version__
        log.info("%s headless backend v%s running", APP_NAME, __version__)

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
