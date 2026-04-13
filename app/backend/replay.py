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
FALLBACK_FPS = 3
MAX_WIDTH = 1280
MAX_HEIGHT = 720


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


def _find_dota_window() -> dict | None:
    """Find the Dota 2 window rect by process name. Returns mss-compatible monitor dict or None."""
    try:
        import ctypes
        from ctypes import wintypes

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
                    result.append({
                        "left": rect.left,
                        "top": rect.top,
                        "width": w,
                        "height": h,
                    })
            return True

        EnumWindows = ctypes.windll.user32.EnumWindows
        EnumWindows(WNDENUMPROC(callback), 0)
        if result:
            log.info("Found Dota 2 window: %dx%d at (%d,%d)",
                     result[0]["width"], result[0]["height"],
                     result[0]["left"], result[0]["top"])
            return result[0]
    except Exception as e:
        log.warning("Could not find Dota window: %s", e)
    return None


class _PyAVRecorder:
    """Record screen to MP4 using mss capture + PyAV encoding.

    Tries AV1 (libsvtav1) first, falls back to H.264 (libx264).
    Stop is instant — just container.close().
    Captures the Dota 2 window if found, otherwise falls back to full screen.
    """

    def __init__(self, fps: int = FALLBACK_FPS):
        self._fps = fps
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._output_path: Path | None = None
        self._container = None
        self._stream = None
        self._frame_count = 0
        self._start_time: float | None = None

    def is_available(self) -> bool:
        try:
            import av
            return True
        except ImportError:
            log.error("PyAV not installed — cannot record")
            return False

    @property
    def stats(self) -> dict:
        """Return current recording stats."""
        if not self._start_time:
            return {"elapsed": 0, "frames": 0, "size_mb": 0}
        elapsed = time.monotonic() - self._start_time
        size_mb = 0
        if self._output_path and self._output_path.exists():
            try:
                size_mb = self._output_path.stat().st_size / (1024 * 1024)
            except OSError:
                pass
        return {"elapsed": elapsed, "frames": self._frame_count, "size_mb": round(size_mb, 1)}

    def start(self, output_path: Path) -> bool:
        """Start recording to the given path."""
        if self._thread and self._thread.is_alive():
            log.warning("Recorder already running")
            return False

        self._output_path = output_path
        self._stop_event.clear()
        self._frame_count = 0
        self._start_time = time.monotonic()
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
        import cv2

        import screen_capture

        frame_interval = 1.0 / self._fps
        container = None
        # Re-detect window bounds every 5 seconds to track movement/resize
        redetect_interval = 5.0

        try:
            codec_name = self._pick_codec()

            # Try to capture just the Dota 2 window
            dota_rect = _find_dota_window()
            if dota_rect:
                monitor = dota_rect
                log.info("Recording Dota 2 window: %dx%d at (%d,%d)",
                         monitor["width"], monitor["height"],
                         monitor["left"], monitor["top"])
            else:
                monitor = screen_capture.monitors()[1]
                log.info("Dota 2 window not found — recording full screen")

            cap_w = monitor["width"]
            cap_h = monitor["height"]

            # Downscale to save space — cap at MAX_WIDTH x MAX_HEIGHT
            scale = min(1.0, MAX_WIDTH / cap_w, MAX_HEIGHT / cap_h)
            w = int(cap_w * scale)
            h = int(cap_h * scale)
            # Ensure even dimensions (required by most codecs)
            w = w - (w % 2)
            h = h - (h % 2)

            if scale < 1.0:
                log.info("Downscaling %dx%d → %dx%d (%.0f%%)", cap_w, cap_h, w, h, scale * 100)

            container = av.open(str(self._output_path), "w")
            stream = container.add_stream(codec_name, rate=self._fps)
            stream.width = w
            stream.height = h
            stream.pix_fmt = "yuv420p"
            # Keyframe every 1 second for fast seeking/scrubbing
            stream.gop_size = self._fps

            # Codec-specific options — tuned for small file size at low fps
            if codec_name == "libsvtav1":
                stream.options = {"preset": "8", "crf": "42"}
            elif codec_name == "libx264":
                stream.options = {"preset": "faster", "crf": "32"}

            self._container = container
            self._stream = stream

            log.info("Recording: %dx%d @ %d fps → %s", w, h, self._fps, self._output_path.name)

            frame_idx = 0
            last_detect_time = time.monotonic()

            while not self._stop_event.is_set():
                t0 = time.monotonic()

                # Periodically re-detect the Dota 2 window
                if t0 - last_detect_time >= redetect_interval:
                    new_rect = _find_dota_window()
                    if new_rect:
                        if (new_rect["left"] != monitor.get("left") or
                                new_rect["top"] != monitor.get("top") or
                                new_rect["width"] != monitor.get("width") or
                                new_rect["height"] != monitor.get("height")):
                            monitor = new_rect
                            log.info("Recording: Dota window moved → %dx%d at (%d,%d)",
                                     monitor["width"], monitor["height"],
                                     monitor["left"], monitor["top"])
                    last_detect_time = t0

                img = screen_capture.grab(monitor)[:, :, :3]  # BGRA → BGR

                # Always resize to stream dimensions (capture region may change)
                if img.shape[1] != w or img.shape[0] != h:
                    img = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)

                # BGR → RGB for PyAV
                img = img[:, :, ::-1]

                frame = av.VideoFrame.from_ndarray(img, format="rgb24")
                frame.pts = frame_idx
                frame_idx += 1
                self._frame_count = frame_idx

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

    @property
    def recorder_stats(self) -> dict:
        return self._recorder.stats

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
