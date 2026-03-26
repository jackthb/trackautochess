"""Screenshot capture using mss — Dota 2 window if found, else fullscreen."""

import ctypes
import logging
from ctypes import wintypes

import mss

log = logging.getLogger("dac")


def _find_dota_window() -> dict | None:
    """Find the Dota 2 window rect by process name. Returns mss-compatible dict or None."""
    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        result = []

        def callback(hwnd, _):
            if not user32.IsWindowVisible(hwnd):
                return True
            pid = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
            if not handle:
                return True
            try:
                buf = ctypes.create_unicode_buffer(260)
                size = ctypes.c_ulong(260)
                kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size))
                exe = buf.value.rsplit("\\", 1)[-1].lower()
            finally:
                kernel32.CloseHandle(handle)
            if exe == "dota2.exe":
                rect = wintypes.RECT()
                user32.GetWindowRect(hwnd, ctypes.byref(rect))
                w = rect.right - rect.left
                h = rect.bottom - rect.top
                if w > 100 and h > 100:
                    result.append({"left": rect.left, "top": rect.top, "width": w, "height": h})
            return True

        ctypes.windll.user32.EnumWindows(WNDENUMPROC(callback), 0)
        return result[0] if result else None
    except Exception as e:
        log.warning("Could not find Dota window: %s", e)
        return None


def capture_screen():
    """Capture the Dota 2 window (or fullscreen fallback) as a BGR numpy array (cv2-compatible)."""
    import numpy as np

    with mss.mss() as sct:
        monitor = _find_dota_window() or sct.monitors[1]
        screenshot = sct.grab(monitor)
        img = np.array(screenshot)[:, :, :3].copy()
    return img
