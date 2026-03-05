"""Fullscreen screenshot capture using mss."""

import mss


def capture_screen():
    """Capture fullscreen and return as a BGR numpy array (cv2-compatible)."""
    import numpy as np

    with mss.mss() as sct:
        monitor = sct.monitors[1]
        screenshot = sct.grab(monitor)
        # mss returns BGRA; convert to BGR numpy array for cv2
        img = np.array(screenshot)[:, :, :3].copy()
    return img
