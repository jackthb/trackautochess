"""Game replay recording and local storage management.

Records screen during active games by piping mss frames to ffmpeg (AV1/SVT-AV1).
Manages local replay storage with configurable size limit and LRU eviction.

Storage: ~/.dac/replays/
Config keys: replay_max_gb (default 15), replay_enabled (default true)
"""

import logging
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

from utils import DAC_DIR

log = logging.getLogger("dac")

REPLAY_DIR = DAC_DIR / "replays"
DEFAULT_MAX_GB = 15
FALLBACK_FPS = 5


def _find_ffmpeg() -> str | None:
    """Find ffmpeg executable — bundled or system."""
    import sys

    if getattr(sys, "frozen", False):
        # PyInstaller bundle: check next to the exe
        bundled = Path(sys._MEIPASS) / "ffmpeg" / "ffmpeg.exe"
        if bundled.exists():
            return str(bundled)

    # System ffmpeg
    path = shutil.which("ffmpeg")
    if path:
        return path

    return None


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


# ── ffmpeg + mss recorder ───────────────────────────────────────────────────


class _FFmpegRecorder:
    """Record screen to MP4 using mss capture piped to ffmpeg (AV1).

    Falls back to H.264 if SVT-AV1 is not available.
    """

    def __init__(self, fps: int = FALLBACK_FPS):
        self._fps = fps
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._output_path: Path | None = None
        self._ffmpeg_path: str | None = None
        self._proc: subprocess.Popen | None = None

    def is_available(self) -> bool:
        self._ffmpeg_path = _find_ffmpeg()
        return self._ffmpeg_path is not None

    def start(self, output_path: Path) -> bool:
        """Start recording to the given path."""
        if self._thread and self._thread.is_alive():
            log.warning("Recorder already running")
            return False

        if not self._ffmpeg_path:
            self._ffmpeg_path = _find_ffmpeg()
        if not self._ffmpeg_path:
            log.error("ffmpeg not found")
            return False

        self._output_path = output_path
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._record_loop, daemon=True, name="ffmpeg-recorder"
        )
        self._thread.start()
        return True

    def stop(self) -> Path | None:
        """Stop recording. Returns output file path."""
        self._stop_event.set()
        # Close ffmpeg stdin to signal EOF
        if self._proc and self._proc.stdin:
            try:
                self._proc.stdin.close()
            except Exception:
                pass
        if self._thread:
            self._thread.join(timeout=15)
        return self._output_path

    def _record_loop(self):
        import mss
        import numpy as np

        frame_interval = 1.0 / self._fps

        try:
            with mss.mss() as sct:
                monitor = sct.monitors[1]
                w = monitor["width"]
                h = monitor["height"]

                # Try AV1 first, fall back to H.264
                codec_args = self._build_ffmpeg_args(w, h)
                if not codec_args:
                    log.error("No working ffmpeg codec found")
                    return

                log.info(
                    "Recording: %dx%d @ %d fps → %s",
                    w, h, self._fps, self._output_path.name,
                )

                while not self._stop_event.is_set():
                    t0 = time.monotonic()

                    shot = sct.grab(monitor)
                    frame = np.array(shot)[:, :, :3]  # BGRA → BGR

                    try:
                        self._proc.stdin.write(frame.tobytes())
                    except (BrokenPipeError, OSError):
                        log.warning("ffmpeg pipe broken, stopping")
                        break

                    elapsed = time.monotonic() - t0
                    sleep_time = frame_interval - elapsed
                    if sleep_time > 0:
                        self._stop_event.wait(sleep_time)

        except Exception as e:
            log.error("Recorder error: %s", e, exc_info=True)
        finally:
            if self._proc:
                try:
                    self._proc.stdin.close()
                except Exception:
                    pass
                try:
                    self._proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    log.warning("ffmpeg didn't exit in 5s — killing")
                    self._proc.kill()
                    self._proc.wait(timeout=3)
                log.info("Recording stopped, ffmpeg exited")

    def _build_ffmpeg_args(self, w: int, h: int) -> bool:
        """Try to start ffmpeg with AV1, fall back to H.264."""
        codec_options = [
            # AV1 via SVT-AV1: fast preset, good quality, small files
            ["-c:v", "libsvtav1", "-preset", "8", "-crf", "38"],
            # H.264 fallback: ultrafast for real-time, reasonable quality
            ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28"],
        ]

        base_args = [
            self._ffmpeg_path,
            "-y",
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{w}x{h}",
            "-r", str(self._fps),
            "-i", "pipe:0",
        ]

        for codec in codec_options:
            cmd = base_args + codec + [
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                str(self._output_path),
            ]
            try:
                self._proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                # Give it a moment to fail if codec is missing
                time.sleep(0.3)
                if self._proc.poll() is None:
                    codec_name = codec[1]
                    log.info("Using codec: %s", codec_name)
                    return True
                else:
                    stderr = self._proc.stderr.read().decode(errors="replace")
                    log.warning("Codec %s failed: %s", codec[1], stderr[:200])
            except Exception as e:
                log.warning("Failed to start ffmpeg with %s: %s", codec[1], e)

        return False


# ── Main replay recorder ────────────────────────────────────────────────────


class ReplayRecorder:
    """High-level replay recorder using ffmpeg.

    Usage:
        recorder = ReplayRecorder(store)
        recorder.start()   # manual toggle (F7)
        recorder.stop()    # manual toggle or game end
    """

    def __init__(self, store: ReplayStore):
        self._store = store
        self._recorder = _FFmpegRecorder()
        self._recording = False
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

            if not self._recorder.is_available():
                log.error("Replay: ffmpeg not found — cannot record")
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
            result_path = self._recorder.stop()

            # Enforce storage limit
            self._store.enforce_limit()

            if result_path and result_path.exists():
                size_mb = result_path.stat().st_size / 1024**2
                log.info("Replay saved: %s (%.1f MB)", result_path.name, size_mb)
            else:
                log.warning("Replay: no output file after stop")

            return result_path
