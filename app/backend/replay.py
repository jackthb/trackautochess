"""Game replay recording and local storage management.

Records screen during active games using PyAV (libav bindings) with AV1/H.264.
Manages local replay storage with configurable size limit and LRU eviction.

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
FALLBACK_FPS = 5


# ── Replay storage management ────────────────────────────────────────────────


class ReplayStore:
    """Manages local replay directory with size-based LRU eviction."""

    def __init__(self, replay_dir: Path = REPLAY_DIR, max_gb: float = DEFAULT_MAX_GB):
        self.replay_dir = replay_dir
        self.max_bytes = int(max_gb * 1024**3)
        self.replay_dir.mkdir(parents=True, exist_ok=True)

    def enforce_limit(self) -> list[Path]:
        """Delete oldest replays until total size is under the limit."""
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
            log.info(
                "Replay cleanup: removed %d file(s), %.1f GB remaining",
                len(deleted),
                total / 1024**3,
            )
        return deleted

    def total_size_gb(self) -> float:
        """Return total size of replay directory in GB."""
        files = list(self.replay_dir.glob("*.mp4"))
        return sum(f.stat().st_size for f in files) / 1024**3

    def list_replays(self) -> list[dict]:
        """List replays sorted newest first."""
        files = sorted(
            self.replay_dir.glob("*.mp4"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        return [
            {
                "path": f,
                "name": f.name,
                "size_mb": f.stat().st_size / 1024**2,
                "mtime": datetime.fromtimestamp(f.stat().st_mtime),
            }
            for f in files
        ]


# ── PyAV screen recorder ────────────────────────────────────────────────────


class _PyAVRecorder:
    """Record screen to MP4 using mss capture + PyAV encoding.

    Tries AV1 (libsvtav1) first, falls back to H.264 (libx264).
    Stop is instant — just container.close().
    """

    def __init__(self, fps: int = FALLBACK_FPS):
        self._fps = fps
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._output_path: Path | None = None
        self._container = None
        self._stream = None

    def is_available(self) -> bool:
        try:
            import av
            return True
        except ImportError:
            log.error("PyAV not installed — cannot record")
            return False

    def start(self, output_path: Path) -> bool:
        """Start recording to the given path."""
        if self._thread and self._thread.is_alive():
            log.warning("Recorder already running")
            return False

        self._output_path = output_path
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._record_loop, daemon=True, name="pyav-recorder"
        )
        self._thread.start()
        return True

    def stop(self) -> Path | None:
        """Stop recording. Returns output file path."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=10)
        return self._output_path

    def _pick_codec(self) -> str:
        """Pick best available codec: AV1 first, H.264 fallback."""
        import av

        for codec_name in ["libsvtav1", "libx264"]:
            try:
                av.Codec(codec_name, "w")
                log.info("Using codec: %s", codec_name)
                return codec_name
            except av.FFmpegError:
                log.info("Codec %s not available, trying next", codec_name)
        raise RuntimeError("No suitable video codec found")

    def _record_loop(self):
        import av
        import mss
        import numpy as np

        frame_interval = 1.0 / self._fps
        container = None

        try:
            codec_name = self._pick_codec()

            with mss.mss() as sct:
                monitor = sct.monitors[1]
                w = monitor["width"]
                h = monitor["height"]

                container = av.open(str(self._output_path), "w")
                stream = container.add_stream(codec_name, rate=self._fps)
                stream.width = w
                stream.height = h
                stream.pix_fmt = "yuv420p"

                # Codec-specific options
                if codec_name == "libsvtav1":
                    stream.options = {"preset": "8", "crf": "38"}
                elif codec_name == "libx264":
                    stream.options = {"preset": "ultrafast", "crf": "28"}

                self._container = container
                self._stream = stream

                log.info("Recording: %dx%d @ %d fps → %s", w, h, self._fps, self._output_path.name)

                frame_idx = 0
                while not self._stop_event.is_set():
                    t0 = time.monotonic()

                    shot = sct.grab(monitor)
                    img = np.array(shot)[:, :, :3]  # BGRA → BGR
                    # BGR → RGB for PyAV
                    img = img[:, :, ::-1]

                    frame = av.VideoFrame.from_ndarray(img, format="rgb24")
                    frame.pts = frame_idx
                    frame_idx += 1

                    for packet in stream.encode(frame):
                        container.mux(packet)

                    elapsed = time.monotonic() - t0
                    sleep_time = frame_interval - elapsed
                    if sleep_time > 0:
                        self._stop_event.wait(sleep_time)

        except Exception as e:
            log.error("Recorder error: %s", e, exc_info=True)
        finally:
            if container:
                try:
                    # Flush encoder
                    for packet in stream.encode(None):
                        container.mux(packet)
                    container.close()
                    log.info("Recording stopped, file finalized")
                except Exception as e:
                    log.warning("Error closing container: %s", e)
            self._container = None
            self._stream = None


# ── Main replay recorder ────────────────────────────────────────────────────


class ReplayRecorder:
    """High-level replay recorder using PyAV.

    Usage:
        recorder = ReplayRecorder(store)
        recorder.start()   # manual toggle (F7)
        recorder.stop()    # manual toggle or game end
    """

    def __init__(self, store: ReplayStore):
        self._store = store
        self._recorder = _PyAVRecorder()
        self._recording = False
        self._stopping = False
        self._lock = threading.Lock()
        self._session_start: datetime | None = None

    @property
    def recording(self) -> bool:
        return self._recording

    def start(self) -> bool:
        """Start recording. Returns True if recording began."""
        with self._lock:
            if self._recording or self._stopping:
                return False

            if not self._recorder.is_available():
                return False

            self._session_start = datetime.now()
            ts = self._session_start.strftime("%Y%m%d_%H%M%S")
            output = self._store.replay_dir / f"{ts}.mp4"

            if self._recorder.start(output):
                self._recording = True
                log.info("Replay: recording started → %s", output.name)
                return True

            log.error("Replay: failed to start recording")
            return False

    def stop(self) -> Path | None:
        """Stop recording. Returns path to replay file, or None."""
        with self._lock:
            if not self._recording:
                return None

            self._recording = False
            self._stopping = True

        # Run stop outside the lock (waits for thread to finish)
        result_path = self._recorder.stop()

        with self._lock:
            self._stopping = False

            # Enforce storage limit
            self._store.enforce_limit()

            if result_path and result_path.exists():
                size_mb = result_path.stat().st_size / 1024**2
                log.info("Replay saved: %s (%.1f MB)", result_path.name, size_mb)
            else:
                log.warning("Replay: no output file after stop")

            return result_path
