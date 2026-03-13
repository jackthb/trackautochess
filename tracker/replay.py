"""Game replay recording and local storage management.

Records screen during active games using either OBS WebSocket (preferred)
or mss + cv2.VideoWriter fallback. Manages local replay storage with
configurable size limit and LRU eviction.

Storage: ~/.dac/replays/
Config keys: replay_max_gb (default 15), replay_enabled (default true)
"""

import logging
import threading
import time
from datetime import datetime
from pathlib import Path

from utils import DAC_DIR

log = logging.getLogger("dac")

REPLAY_DIR = DAC_DIR / "replays"
DEFAULT_MAX_GB = 15
FALLBACK_FPS = 10


# ── Replay storage management ────────────────────────────────────────────────


class ReplayStore:
    """Manages local replay directory with size-based LRU eviction."""

    def __init__(self, replay_dir: Path = REPLAY_DIR, max_gb: float = DEFAULT_MAX_GB):
        self.replay_dir = replay_dir
        self.max_bytes = int(max_gb * 1024**3)
        self.replay_dir.mkdir(parents=True, exist_ok=True)

    def enforce_limit(self) -> list[Path]:
        """Delete oldest replays until total size is under the limit.

        Returns list of deleted file paths.
        """
        files = sorted(self.replay_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime)
        total = sum(f.stat().st_size for f in files)
        deleted = []

        while total > self.max_bytes and files:
            oldest = files.pop(0)
            size = oldest.stat().st_size
            oldest.unlink()
            total -= size
            deleted.append(oldest)
            log.info("Replay evicted: %s (%.1f MB)", oldest.name, size / 1024**2)

        if deleted:
            log.info("Replay cleanup: removed %d file(s), %.1f GB remaining",
                     len(deleted), total / 1024**3)
        return deleted

    def total_size_gb(self) -> float:
        """Return total size of replay directory in GB."""
        files = list(self.replay_dir.glob("*.mp4"))
        return sum(f.stat().st_size for f in files) / 1024**3

    def list_replays(self) -> list[dict]:
        """List replays sorted newest first."""
        files = sorted(self.replay_dir.glob("*.mp4"),
                       key=lambda p: p.stat().st_mtime, reverse=True)
        return [
            {
                "path": f,
                "name": f.name,
                "size_mb": f.stat().st_size / 1024**2,
                "mtime": datetime.fromtimestamp(f.stat().st_mtime),
            }
            for f in files
        ]


# ── OBS WebSocket recorder ───────────────────────────────────────────────────


class _OBSRecorder:
    """Record via OBS Studio's WebSocket API (built-in since OBS 28).

    Connects to ws://localhost:4455 and issues StartRecord / StopRecord.
    OBS must be running with WebSocket server enabled.
    """

    def __init__(self, host: str = "localhost", port: int = 4455, password: str = ""):
        self._host = host
        self._port = port
        self._password = password
        self._ws = None

    def is_available(self) -> bool:
        """Check if OBS WebSocket is reachable."""
        try:
            import obsws_python as obs
            cl = obs.ReqClient(host=self._host, port=self._port,
                               password=self._password, timeout=3)
            cl.get_version()
            cl.disconnect()
            return True
        except Exception:
            return False

    def start(self) -> bool:
        """Start OBS recording. Returns True on success."""
        try:
            import obsws_python as obs
            self._ws = obs.ReqClient(host=self._host, port=self._port,
                                     password=self._password, timeout=5)
            self._ws.start_record()
            log.info("OBS: recording started")
            return True
        except Exception as e:
            log.warning("OBS start_record failed: %s", e)
            self._ws = None
            return False

    def stop(self) -> str | None:
        """Stop OBS recording. Returns output file path from OBS, or None."""
        if not self._ws:
            return None
        try:
            resp = self._ws.stop_record()
            path = getattr(resp, "output_path", None)
            log.info("OBS: recording stopped → %s", path)
            return path
        except Exception as e:
            log.warning("OBS stop_record failed: %s", e)
            return None
        finally:
            try:
                self._ws.disconnect()
            except Exception:
                pass
            self._ws = None


# ── mss + cv2.VideoWriter fallback recorder ──────────────────────────────────


class _MSSRecorder:
    """Record screen to MP4 using mss capture + cv2.VideoWriter.

    Uses H.264 encoding via OpenCV's VideoWriter. Quality is lower than OBS
    hardware encoding but requires no external software.
    """

    def __init__(self, fps: int = FALLBACK_FPS):
        self._fps = fps
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._output_path: Path | None = None

    def start(self, output_path: Path) -> bool:
        """Start recording to the given path. Returns True on success."""
        if self._thread and self._thread.is_alive():
            log.warning("MSS recorder already running")
            return False

        self._output_path = output_path
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._record_loop, daemon=True, name="mss-recorder",
        )
        self._thread.start()
        return True

    def stop(self) -> Path | None:
        """Stop recording. Returns output file path."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=10)
        return self._output_path

    def _record_loop(self):
        import cv2
        import mss
        import numpy as np

        writer = None
        frame_interval = 1.0 / self._fps

        try:
            with mss.mss() as sct:
                monitor = sct.monitors[1]
                w = monitor["width"]
                h = monitor["height"]

                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(
                    str(self._output_path), fourcc, self._fps, (w, h),
                )
                if not writer.isOpened():
                    log.error("MSS recorder: VideoWriter failed to open")
                    return

                log.info("MSS recorder: started %dx%d @ %d fps → %s",
                         w, h, self._fps, self._output_path.name)

                while not self._stop_event.is_set():
                    t0 = time.monotonic()

                    shot = sct.grab(monitor)
                    frame = np.array(shot)[:, :, :3]  # BGRA → BGR
                    writer.write(frame)

                    elapsed = time.monotonic() - t0
                    sleep_time = frame_interval - elapsed
                    if sleep_time > 0:
                        self._stop_event.wait(sleep_time)

        except Exception as e:
            log.error("MSS recorder error: %s", e, exc_info=True)
        finally:
            if writer:
                writer.release()
                log.info("MSS recorder: stopped, file saved")


# ── Main replay recorder (orchestrates OBS or MSS) ──────────────────────────


class ReplayRecorder:
    """High-level replay recorder: tries OBS, falls back to mss.

    Usage:
        recorder = ReplayRecorder(store)
        recorder.start()   # called when game starts / Dota focused
        recorder.stop()    # called on Final Ranking / game end
    """

    def __init__(self, store: ReplayStore):
        self._store = store
        self._obs = _OBSRecorder()
        self._mss: _MSSRecorder | None = None
        self._recording = False
        self._method: str = ""  # "obs" or "mss"
        self._lock = threading.Lock()
        self._session_start: datetime | None = None

    @property
    def recording(self) -> bool:
        return self._recording

    def start(self) -> bool:
        """Start recording. Returns True if recording began."""
        with self._lock:
            if self._recording:
                return False

            self._session_start = datetime.now()
            ts = self._session_start.strftime("%Y%m%d_%H%M%S")

            # Try OBS first
            if self._obs.is_available():
                if self._obs.start():
                    self._recording = True
                    self._method = "obs"
                    log.info("Replay: recording via OBS")
                    return True

            # Fall back to mss
            output = self._store.replay_dir / f"{ts}.mp4"
            self._mss = _MSSRecorder()
            if self._mss.start(output):
                self._recording = True
                self._method = "mss"
                log.info("Replay: recording via mss → %s", output.name)
                return True

            log.error("Replay: failed to start recording")
            return False

    def stop(self) -> Path | None:
        """Stop recording. Returns path to replay file, or None.

        Also triggers storage eviction to enforce size limit.
        """
        with self._lock:
            if not self._recording:
                return None

            self._recording = False
            result_path = None

            if self._method == "obs":
                obs_path = self._obs.stop()
                if obs_path:
                    # OBS saves to its own configured directory.
                    # Move/copy into our replay dir for unified management.
                    src = Path(obs_path)
                    if src.exists():
                        ts = (self._session_start or datetime.now()).strftime("%Y%m%d_%H%M%S")
                        dest = self._store.replay_dir / f"{ts}.mp4"
                        try:
                            import shutil
                            shutil.move(str(src), str(dest))
                            result_path = dest
                            log.info("Replay: moved OBS recording → %s", dest.name)
                        except Exception as e:
                            log.warning("Replay: could not move OBS file: %s", e)
                            result_path = src

            elif self._method == "mss" and self._mss:
                result_path = self._mss.stop()
                self._mss = None

            # Enforce storage limit
            self._store.enforce_limit()

            if result_path and result_path.exists():
                size_mb = result_path.stat().st_size / 1024**2
                log.info("Replay saved: %s (%.1f MB)", result_path.name, size_mb)
            else:
                log.warning("Replay: no output file after stop")

            return result_path
