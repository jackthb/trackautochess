"""Lightweight screen sentinel — polls a tiny region for color match.

Captures a small pixel region using mss and compares its average RGB
to a reference. When the sentinel matches, fires a callback.

Much cheaper than full-screen capture + OCR every poll cycle.
"""

import logging
import threading
import time

import mss
import numpy as np

log = logging.getLogger("dac")

POLL_INTERVAL = 3  # seconds between checks

# Final Ranking sentinel — left-side panel element.
# Coordinates as fractions of screen dimensions.
FINAL_RANKING_SENTINEL = {
    "name": "final_ranking",
    "x0": 0.01715,
    "y0": 0.25694,
    "x1": 0.0468,
    "y1": 0.28958,
    "avg_rgb": [133, 136, 143],
}

# How close the average RGB must be (0.0–1.0). 0.8 = within 20%.
COLOR_THRESHOLD = 0.80


def _rgb_similarity(a, b):
    """Return similarity between two RGB triplets (0.0–1.0)."""
    dist = sum((ai - bi) ** 2 for ai, bi in zip(a, b)) ** 0.5
    max_dist = (255**2 * 3) ** 0.5  # ~441.7
    return 1.0 - dist / max_dist


def _sample_region(sct, monitor, sentinel):
    """Capture a tiny region and return its average RGB."""
    mw = monitor["width"]
    mh = monitor["height"]
    x0 = int(sentinel["x0"] * mw) + monitor["left"]
    y0 = int(sentinel["y0"] * mh) + monitor["top"]
    x1 = int(sentinel["x1"] * mw) + monitor["left"]
    y1 = int(sentinel["y1"] * mh) + monitor["top"]

    region = {"left": x0, "top": y0, "width": x1 - x0, "height": y1 - y0}
    shot = sct.grab(region)
    img = np.array(shot)[:, :, :3]  # BGR
    avg = img.mean(axis=(0, 1))
    return [avg[2], avg[1], avg[0]]  # BGR → RGB


class SentinelPoller:
    """Polls screen for sentinel region matches."""

    def __init__(self, on_match, sentinel=None, interval=POLL_INTERVAL, threshold=COLOR_THRESHOLD):
        """
        Args:
            on_match: Called (no args) when sentinel matches.
            sentinel: Dict with x0/y0/x1/y1/avg_rgb. Defaults to FINAL_RANKING_SENTINEL.
            interval: Seconds between polls.
            threshold: RGB similarity threshold (0.0–1.0).
        """
        self._on_match = on_match
        self._sentinel = sentinel or FINAL_RANKING_SENTINEL
        self._interval = interval
        self._threshold = threshold
        self._stop_event = threading.Event()
        self._thread = None
        self._fired = False  # debounce: only fire once per appearance

    def start(self):
        """Start polling in a daemon thread."""
        self._thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="sentinel-poller",
        )
        self._thread.start()
        log.info("Sentinel poller started (interval=%ds, threshold=%.0f%%)",
                 self._interval, self._threshold * 100)

    def stop(self):
        """Stop the polling loop."""
        self._stop_event.set()

    def _poll_loop(self):
        with mss.mss() as sct:
            monitor = sct.monitors[1]
            while not self._stop_event.is_set():
                time.sleep(self._interval)
                try:
                    avg_rgb = _sample_region(sct, monitor, self._sentinel)
                    sim = _rgb_similarity(avg_rgb, self._sentinel["avg_rgb"])

                    if sim >= self._threshold:
                        if not self._fired:
                            log.info("Sentinel '%s' matched (similarity=%.1f%%, rgb=[%d,%d,%d])",
                                     self._sentinel["name"], sim * 100,
                                     int(avg_rgb[0]), int(avg_rgb[1]), int(avg_rgb[2]))
                            self._fired = True
                            self._on_match()
                    else:
                        self._fired = False
                except Exception as e:
                    log.debug("Sentinel poll error: %s", e)
