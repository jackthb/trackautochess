"""Lightweight screen sentinel — polls regions for template matches.

Captures screen regions using mss and compares them to reference images
via OpenCV template matching. When similarity exceeds the threshold,
fires a callback. Supports multiple sentinels with independent callbacks.
"""

import ctypes
import logging
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import screen_capture

from utils import DATA_DIR

log = logging.getLogger("dac")

POLL_INTERVAL = 3  # seconds
CONFIRM_DELAY = 2  # seconds to wait and re-check before firing

# Process name that identifies Dota 2
GAME_PROCESS_NAME = "dota2.exe"

# Final Ranking sentinel (game end)
FINAL_RANKING_TEMPLATE = DATA_DIR / "sentinel_ref_final_ranking.png"
FINAL_RANKING_REGION = {
    "x0": 0.0,
    "y0": 0.20,
    "x1": 0.15,
    "y1": 0.35,
}

# Round Start sentinel (0 STARTING countdown)
ROUND_START_TEMPLATE = DATA_DIR / "sentinel_ref_round_start.png"
ROUND_START_REGION = {
    "x0": 0.80,
    "y0": 0.15,
    "x1": 0.95,
    "y1": 0.35,
}

MATCH_THRESHOLD = 0.70


def _get_foreground_process_name() -> str:
    """Return the executable name of the currently focused window's process (Windows only)."""
    try:
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        pid = ctypes.c_ulong()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not handle:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(260)
            size = ctypes.c_ulong(260)
            ctypes.windll.kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size))
            return buf.value.rsplit("\\", 1)[-1].lower()
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    except Exception:
        return ""


def is_game_focused() -> bool:
    """Check if the Dota 2 process owns the foreground window."""
    return _get_foreground_process_name() == GAME_PROCESS_NAME


def _grab_region(monitor, region):
    """Grab a screen region and return as BGR numpy array."""
    mw = monitor["width"]
    mh = monitor["height"]
    x0 = int(region["x0"] * mw) + monitor["left"]
    y0 = int(region["y0"] * mh) + monitor["top"]
    x1 = int(region["x1"] * mw) + monitor["left"]
    y1 = int(region["y1"] * mh) + monitor["top"]

    rect = {"left": x0, "top": y0, "width": x1 - x0, "height": y1 - y0}
    return screen_capture.grab(rect)[:, :, :3]  # BGRA → BGR


def _load_template(path, target_h):
    """Load template and scale to match the search region's resolution."""
    tmpl = cv2.imread(str(path))
    if tmpl is None:
        raise FileNotFoundError(f"Template not found: {path}")
    th, tw = tmpl.shape[:2]
    scale = target_h / th if target_h != th else 1.0
    if abs(scale - 1.0) > 0.01:
        tmpl = cv2.resize(tmpl, (int(tw * scale), int(th * scale)), interpolation=cv2.INTER_AREA)
    return tmpl


class SentinelTarget:
    """A single sentinel target with its own template, region, and callback."""

    def __init__(self, name, template_path, search_region, on_match, threshold=MATCH_THRESHOLD,
                 ref_height=None):
        self.name = name
        self.template_path = Path(template_path)
        self.search_region = search_region
        self.on_match = on_match
        self.threshold = threshold
        self.ref_height = ref_height  # template height at reference resolution (1440p)
        self.fired = False
        self.tmpl = None  # loaded at poll start


class SentinelPoller:
    """Polls screen for template matches across multiple sentinel targets."""

    def __init__(self, targets=None, interval=POLL_INTERVAL,
                 on_focus_gained=None, on_focus_lost=None):
        self._targets = targets or []
        self._on_focus_gained = on_focus_gained
        self._on_focus_lost = on_focus_lost
        self._interval = interval
        self._stop_event = threading.Event()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="sentinel-poller",
        )
        self._thread.start()
        names = ", ".join(t.name for t in self._targets)
        log.info("Sentinel poller started (interval=%ds, targets: %s)", self._interval, names)

    def stop(self):
        self._stop_event.set()

    def _match_template(self, monitor, target):
        """Grab search region, run template match, return (score, region_img)."""
        region_img = _grab_region(monitor, target.search_region)
        region_gray = cv2.cvtColor(region_img, cv2.COLOR_BGR2GRAY)
        tmpl_gray = cv2.cvtColor(target.tmpl, cv2.COLOR_BGR2GRAY)
        result = cv2.matchTemplate(region_gray, tmpl_gray, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = cv2.minMaxLoc(result)
        return max_val, region_img

    def _save_debug(self, target, region_img, score, matched):
        """Save a debug HTML showing the search region and template."""
        try:
            import base64
            from io import BytesIO

            debug_dir = Path.home() / ".dac" / "sentinel_debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")

            def arr_to_b64(arr):
                img = Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))
                buf = BytesIO()
                img.save(buf, format="PNG")
                return base64.b64encode(buf.getvalue()).decode()

            region_b64 = arr_to_b64(region_img)
            tmpl_b64 = arr_to_b64(target.tmpl)
            status = "MATCH" if matched else "NO MATCH"
            color = "#4a4" if matched else "#a44"

            html = f"""<!DOCTYPE html>
<html><head><title>Sentinel Debug {ts} — {target.name}</title></head>
<body style="background:#1a1a1a;color:#eee;font-family:monospace;padding:20px">
<h1 style="color:{color}">{target.name} — {status} (score={score:.3f}, threshold={target.threshold:.2f})</h1>
<p>{datetime.now().isoformat()}</p>
<div style="display:flex;gap:40px;align-items:start">
  <div>
    <h3>Search region:</h3>
    <img src="data:image/png;base64,{region_b64}" style="max-width:600px;border:2px solid #666">
  </div>
  <div>
    <h3>Template ({target.template_path.name}):</h3>
    <img src="data:image/png;base64,{tmpl_b64}" style="image-rendering:pixelated;border:2px solid #666;min-width:200px">
  </div>
</div>
</body></html>"""

            path = debug_dir / f"sentinel_{target.name}_{ts}.html"
            path.write_text(html, encoding="utf-8")
            log.info("Sentinel debug saved: %s", path)
        except Exception as e:
            log.warning("Failed to save debug: %s", e)

    def _poll_loop(self):
        monitor = screen_capture.monitors()[1]
        mw, mh = monitor["width"], monitor["height"]

        # Load and scale templates
        for t in self._targets:
            if not t.template_path.exists():
                log.warning("Sentinel template not found, skipping: %s", t.template_path)
                continue
            ref_h = t.ref_height or 47
            scale_h = int(ref_h * mh / 1440)
            t.tmpl = _load_template(t.template_path, scale_h)
            log.info("Sentinel '%s': region=(%d,%d)-(%d,%d), template=%dx%d",
                     t.name,
                     int(t.search_region["x0"] * mw), int(t.search_region["y0"] * mh),
                     int(t.search_region["x1"] * mw), int(t.search_region["y1"] * mh),
                     t.tmpl.shape[1], t.tmpl.shape[0])

        active_targets = [t for t in self._targets if t.tmpl is not None]
        if not active_targets:
            log.error("No sentinel targets loaded — poller exiting")
            return

        was_focused = False
        while not self._stop_event.is_set():
            time.sleep(self._interval)

            focused = is_game_focused()
            if focused and not was_focused:
                log.info("Dota 2 focused — sentinel active")
                if self._on_focus_gained:
                    try:
                        self._on_focus_gained()
                    except Exception as e:
                        log.warning("on_focus_gained callback error: %s", e)
            elif not focused and was_focused:
                log.info("Dota 2 lost focus — sentinel paused")
                if self._on_focus_lost:
                    try:
                        self._on_focus_lost()
                    except Exception as e:
                        log.warning("on_focus_lost callback error: %s", e)
            was_focused = focused

            if not focused:
                continue

            for target in active_targets:
                try:
                    score, region_img = self._match_template(monitor, target)
                    log.debug("Sentinel '%s': score=%.3f (need %.2f)",
                              target.name, score, target.threshold)

                    if score >= target.threshold:
                        if not target.fired:
                            log.info("Sentinel '%s' preliminary match (%.3f) — confirming...",
                                     target.name, score)
                            time.sleep(CONFIRM_DELAY)
                            if self._stop_event.is_set():
                                break
                            score2, region_img2 = self._match_template(monitor, target)
                            if score2 >= target.threshold:
                                log.info("Sentinel '%s' confirmed (score=%.3f)",
                                         target.name, score2)
                                self._save_debug(target, region_img2, score2, True)
                                target.fired = True
                                target.on_match()
                            else:
                                log.info("Sentinel '%s' confirmation failed (score=%.3f)",
                                         target.name, score2)
                                self._save_debug(target, region_img2, score2, False)
                    else:
                        target.fired = False
                except Exception as e:
                    log.warning("Sentinel '%s' poll error: %s", target.name, e)
