"""Lightweight screen sentinel — polls a region for template match.

Captures a screen region using mss and compares it to a reference image
via OpenCV template matching. When similarity exceeds the threshold,
fires a callback.
"""

import ctypes
import logging
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import mss
import numpy as np
from PIL import Image

from utils import DATA_DIR

log = logging.getLogger("dac")

POLL_INTERVAL = 3  # seconds
CONFIRM_DELAY = 2  # seconds to wait and re-check before firing

# Process name that identifies Dota 2
GAME_PROCESS_NAME = "dota2.exe"

# Reference template image (cropped from a known Final Ranking screenshot)
TEMPLATE_PATH = DATA_DIR / "sentinel_ref_final_ranking.png"

# Search region as fractions of screen — slightly larger than the template
# so matchTemplate has room to slide.
SEARCH_REGION = {
    "x0": 0.0,
    "y0": 0.20,
    "x1": 0.15,
    "y1": 0.35,
}

# Template match threshold (0.0–1.0). TM_CCOEFF_NORMED: 1.0 = perfect match.
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


def _grab_region(sct, monitor, region):
    """Grab a screen region and return as BGR numpy array."""
    mw = monitor["width"]
    mh = monitor["height"]
    x0 = int(region["x0"] * mw) + monitor["left"]
    y0 = int(region["y0"] * mh) + monitor["top"]
    x1 = int(region["x1"] * mw) + monitor["left"]
    y1 = int(region["y1"] * mh) + monitor["top"]

    rect = {"left": x0, "top": y0, "width": x1 - x0, "height": y1 - y0}
    shot = sct.grab(rect)
    return np.array(shot)[:, :, :3]  # BGRA → BGR


def _load_template(path, target_h):
    """Load template and scale to match the search region's resolution."""
    tmpl = cv2.imread(str(path))
    if tmpl is None:
        raise FileNotFoundError(f"Template not found: {path}")
    # Scale template to match target height proportionally
    th, tw = tmpl.shape[:2]
    scale = target_h / th if target_h != th else 1.0
    if abs(scale - 1.0) > 0.01:
        tmpl = cv2.resize(tmpl, (int(tw * scale), int(th * scale)), interpolation=cv2.INTER_AREA)
    return tmpl


class SentinelPoller:
    """Polls screen for template matches."""

    def __init__(self, on_match, template_path=None, interval=POLL_INTERVAL, threshold=MATCH_THRESHOLD):
        self._on_match = on_match
        self._template_path = Path(template_path or TEMPLATE_PATH)
        self._interval = interval
        self._threshold = threshold
        self._stop_event = threading.Event()
        self._thread = None
        self._fired = False

    def start(self):
        self._thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="sentinel-poller",
        )
        self._thread.start()
        log.info("Sentinel poller started (interval=%ds, threshold=%.0f%%, template=%s)",
                 self._interval, self._threshold * 100, self._template_path.name)

    def stop(self):
        self._stop_event.set()

    def _match_template(self, sct, monitor, tmpl):
        """Grab search region, run template match, return (score, region_img)."""
        region_img = _grab_region(sct, monitor, SEARCH_REGION)
        # Convert both to grayscale for more robust matching
        region_gray = cv2.cvtColor(region_img, cv2.COLOR_BGR2GRAY)
        tmpl_gray = cv2.cvtColor(tmpl, cv2.COLOR_BGR2GRAY)
        result = cv2.matchTemplate(region_gray, tmpl_gray, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = cv2.minMaxLoc(result)
        return max_val, region_img

    def _save_debug(self, region_img, tmpl, score, matched):
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
            tmpl_b64 = arr_to_b64(tmpl)
            status = "MATCH" if matched else "NO MATCH"
            color = "#4a4" if matched else "#a44"

            html = f"""<!DOCTYPE html>
<html><head><title>Sentinel Debug {ts}</title></head>
<body style="background:#1a1a1a;color:#eee;font-family:monospace;padding:20px">
<h1 style="color:{color}">Sentinel Debug — {status} (score={score:.3f}, threshold={self._threshold:.2f})</h1>
<p>{datetime.now().isoformat()}</p>
<div style="display:flex;gap:40px;align-items:start">
  <div>
    <h3>Search region:</h3>
    <img src="data:image/png;base64,{region_b64}" style="max-width:600px;border:2px solid #666">
  </div>
  <div>
    <h3>Template ({self._template_path.name}):</h3>
    <img src="data:image/png;base64,{tmpl_b64}" style="image-rendering:pixelated;border:2px solid #666;min-width:200px">
  </div>
</div>
</body></html>"""

            path = debug_dir / f"sentinel_{ts}.html"
            path.write_text(html, encoding="utf-8")
            log.info("Sentinel debug saved: %s", path)
        except Exception as e:
            log.warning("Failed to save debug: %s", e)

    def _poll_loop(self):
        with mss.mss() as sct:
            monitor = sct.monitors[1]
            mw, mh = monitor["width"], monitor["height"]

            # Calculate expected template height based on screen resolution
            region_h = int((SEARCH_REGION["y1"] - SEARCH_REGION["y0"]) * mh)
            # Template was captured at 3440x1440 — the sentinel region is ~47px tall at that res.
            # Scale proportionally to current resolution.
            template_scale_h = int(47 * mh / 1440)
            tmpl = _load_template(self._template_path, template_scale_h)

            log.info("Sentinel: monitor=%dx%d, search region=(%d,%d)-(%d,%d), template=%dx%d",
                     mw, mh,
                     int(SEARCH_REGION["x0"] * mw), int(SEARCH_REGION["y0"] * mh),
                     int(SEARCH_REGION["x1"] * mw), int(SEARCH_REGION["y1"] * mh),
                     tmpl.shape[1], tmpl.shape[0])

            was_focused = False
            while not self._stop_event.is_set():
                time.sleep(self._interval)

                focused = is_game_focused()
                if focused and not was_focused:
                    log.info("Dota 2 focused — sentinel active")
                elif not focused and was_focused:
                    log.info("Dota 2 lost focus — sentinel paused")
                was_focused = focused

                if not focused:
                    continue

                try:
                    score, region_img = self._match_template(sct, monitor, tmpl)
                    log.info("Sentinel poll: score=%.3f (need %.2f)", score, self._threshold)

                    if score >= self._threshold:
                        if not self._fired:
                            log.info("Sentinel preliminary match (%.3f) — confirming...", score)
                            time.sleep(CONFIRM_DELAY)
                            if self._stop_event.is_set():
                                break
                            score2, region_img2 = self._match_template(sct, monitor, tmpl)
                            if score2 >= self._threshold:
                                log.info("Sentinel confirmed (score=%.3f)", score2)
                                self._save_debug(region_img2, tmpl, score2, True)
                                self._fired = True
                                self._on_match()
                            else:
                                log.info("Sentinel confirmation failed (score=%.3f)", score2)
                                self._save_debug(region_img2, tmpl, score2, False)
                    else:
                        self._fired = False
                except Exception as e:
                    log.warning("Sentinel poll error: %s", e)
