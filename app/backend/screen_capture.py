"""Thread-safe screen capture singleton.

All screen grabs go through a single mss instance protected by a lock.
This prevents concurrent GDI access from multiple threads, which causes
resource contention and interferes with external recorders like Medal.
"""

import threading

import mss
import numpy as np

_lock = threading.Lock()
_sct: mss.mss | None = None


def _get_sct() -> mss.mss:
    """Lazy-init the global mss instance (must be called under _lock)."""
    global _sct
    if _sct is None:
        _sct = mss.mss()
    return _sct


def grab(monitor: dict) -> np.ndarray:
    """Grab a screen region. Returns BGRA numpy array (same as mss.grab).

    Thread-safe — serialises access to the underlying GDI device context.
    """
    with _lock:
        sct = _get_sct()
        shot = sct.grab(monitor)
        return np.array(shot)


def monitors() -> list[dict]:
    """Return the list of monitors (same as mss.monitors)."""
    with _lock:
        sct = _get_sct()
        return list(sct.monitors)
