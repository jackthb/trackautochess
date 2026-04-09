"""Thread-safe screen capture using per-thread mss instances.

MSS binds GDI device contexts to the thread that creates them (via
thread-local storage on Windows).  A single shared instance fails when
accessed from a different thread.  We therefore keep one mss instance per
thread, with a lock to serialise GDI access across threads.
"""

import threading

import mss
import numpy as np

_lock = threading.Lock()
_local = threading.local()


def _get_sct() -> mss.mss:
    """Return the mss instance for the current thread, creating if needed."""
    sct = getattr(_local, "sct", None)
    if sct is None:
        sct = mss.mss()
        _local.sct = sct
    return sct


def grab(monitor: dict) -> np.ndarray:
    """Grab a screen region. Returns BGRA numpy array (same as mss.grab).

    Thread-safe — each thread owns its own GDI context, and a lock
    serialises access to prevent resource contention.
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
