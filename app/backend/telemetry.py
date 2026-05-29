"""PostHog telemetry for the DAC Tracker headless backend.

Mirrors the safety model of the web equivalent (``web/lib/posthog.ts``):
when no project token resolves, EVERYTHING here no-ops silently. No public
function in this module may ever raise into its caller or block the backend.

Hard rule: telemetry must NEVER write to stdout — stdout is the JSON Lines
protocol the Electron renderer parses. All diagnostics go through the ``dac``
logger (file + the renderer's JSON log sink) or, as a last resort, stderr.
"""

import logging
import os
import sys
import traceback
from pathlib import Path

from utils import DAC_DIR, load_config

# ── Configuration ─────────────────────────────────────────────────────────────

# Intentionally blank — do not commit a real token. A token is supplied at
# runtime via the POSTHOG_DESKTOP_TOKEN env var or the `posthog_desktop_token`
# config key. With no token, this whole module no-ops.
DEFAULT_POSTHOG_TOKEN = ""
DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com"

# Log tails are capped per-source so we never try to ship a multi-MB file.
LOG_TAIL_MAX_BYTES = 256 * 1024
# PostHog rejects very large event payloads, so a tail is split into chunks
# and sent as a sequence of `log_chunk` events. Stay well under the limit.
LOG_CHUNK_BYTES = 48 * 1024

log = logging.getLogger("dac")

# ── Module state ────────────────────────────────────────────────────────────

_client = None              # posthog.Posthog instance, or None when disabled
_initialized = False
_distinct_id = None
_super_properties: dict = {}


def _resolve_token(config: dict | None) -> str:
    """Token precedence: env → config → module default."""
    env = os.environ.get("POSTHOG_DESKTOP_TOKEN")
    if env and env.strip():
        return env.strip()
    if config is None:
        try:
            config = load_config()
        except Exception:
            config = {}
    cfg_token = (config or {}).get("posthog_desktop_token")
    if isinstance(cfg_token, str) and cfg_token.strip():
        return cfg_token.strip()
    return DEFAULT_POSTHOG_TOKEN


def _resolve_host() -> str:
    env = os.environ.get("POSTHOG_DESKTOP_HOST")
    if env and env.strip():
        return env.strip()
    return DEFAULT_POSTHOG_HOST


# ── Lifecycle ─────────────────────────────────────────────────────────────────

def init(config: dict, version: str | None = None) -> None:
    """Lazily construct the PostHog client. Safe to call with no steam_id yet
    and safe to call when no token is configured (then it no-ops forever)."""
    global _client, _initialized, _distinct_id, _super_properties
    if _initialized:
        return
    _initialized = True
    try:
        token = _resolve_token(config)
        if not token:
            log.debug("telemetry: no PostHog token configured — disabled")
            return

        _distinct_id = (config or {}).get("steam_id") or None
        _super_properties = {
            "app_version": version,
            "platform": sys.platform,
            "frozen": bool(getattr(sys, "frozen", False)),
        }

        from posthog import Posthog
        _client = Posthog(
            project_api_key=token,
            host=_resolve_host(),
            # Best-effort: short timeout, don't let retries pile up and block.
            timeout=10,
            max_retries=2,
            super_properties=_super_properties,
            # We forward warnings/errors ourselves via PostHogLogHandler.
            enable_exception_autocapture=False,
        )
        log.info("telemetry: PostHog initialized (host=%s, identified=%s)",
                 _resolve_host(), bool(_distinct_id))
    except Exception as e:
        _client = None
        log.warning("telemetry: init failed (%s) — disabled", e)


def identify(steam_id, steam_name=None, version: str | None = None) -> None:
    """Identify the person behind the current install."""
    global _distinct_id
    if not _client or not steam_id:
        return
    try:
        _distinct_id = str(steam_id)
        props = {}
        if steam_name:
            props["steam_name"] = steam_name
        if version:
            props["app_version"] = version
        _client.identify(distinct_id=_distinct_id, properties=props or None)
    except Exception as e:
        log.debug("telemetry: identify failed: %s", e)


def capture(event: str, properties: dict | None = None) -> None:
    """Best-effort event capture. Swallows everything."""
    if not _client:
        return
    try:
        _client.capture(
            distinct_id=_distinct_id or "anonymous",
            event=event,
            properties=properties or None,
        )
    except Exception as e:
        log.debug("telemetry: capture(%s) failed: %s", event, e)


def capture_exception(exc, context: dict | None = None) -> None:
    """Report an exception. Uses PostHog's native exception capture when the
    installed client exposes it, else falls back to a `backend_exception`
    event carrying type/message/traceback."""
    if not _client:
        return
    try:
        cap_exc = getattr(_client, "capture_exception", None)
        if callable(cap_exc):
            cap_exc(
                exception=exc,
                distinct_id=_distinct_id or "anonymous",
                properties=context or None,
            )
            return
    except Exception as e:
        log.debug("telemetry: capture_exception native path failed: %s", e)

    # Fallback: synthesize an event from the exception details.
    try:
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        props = {
            "exception_type": type(exc).__name__,
            "exception_message": str(exc),
            "traceback": tb[:LOG_CHUNK_BYTES],
        }
        if context:
            props.update(context)
        capture("backend_exception", props)
    except Exception as e:
        log.debug("telemetry: capture_exception fallback failed: %s", e)


def flush() -> None:
    if not _client:
        return
    try:
        _client.flush()
    except Exception as e:
        log.debug("telemetry: flush failed: %s", e)


def shutdown() -> None:
    if not _client:
        return
    try:
        _client.shutdown()
    except Exception as e:
        log.debug("telemetry: shutdown failed: %s", e)


# ── Log upload ────────────────────────────────────────────────────────────────

def _read_tail(path: Path, max_bytes: int = LOG_TAIL_MAX_BYTES) -> str:
    """Return the last ``max_bytes`` of a text file, or '' if unreadable."""
    try:
        if not path or not path.exists():
            return ""
        size = path.stat().st_size
        with open(path, "rb") as f:
            if size > max_bytes:
                f.seek(size - max_bytes)
            data = f.read()
        return data.decode("utf-8", errors="replace")
    except Exception as e:
        log.debug("telemetry: could not read %s: %s", path, e)
        return ""


def _find_console_log() -> Path | None:
    """Locate Dota's console.log using the same logic as the capture pipeline."""
    try:
        from nettable_capture import find_dota_dir, find_console_log
        dota_dir = find_dota_dir()
        if dota_dir:
            return find_console_log(dota_dir)
    except Exception as e:
        log.debug("telemetry: could not locate console.log: %s", e)
    return None


def _send_log_chunks(source: str, text: str, reason: str) -> int:
    """Split ``text`` into LOG_CHUNK_BYTES pieces and send each as a
    `log_chunk` event so nothing is silently truncated. Returns chunk count."""
    if not text:
        return 0
    raw = text.encode("utf-8", errors="replace")
    chunks = [raw[i:i + LOG_CHUNK_BYTES] for i in range(0, len(raw), LOG_CHUNK_BYTES)]
    total = len(chunks)
    for index, chunk in enumerate(chunks):
        capture("log_chunk", {
            "source": source,
            "reason": reason,
            "index": index,
            "total": total,
            "chunk": chunk.decode("utf-8", errors="replace"),
        })
    return total


def upload_logs(reason: str = "manual") -> None:
    """Ship the tails of tracker.log and Dota's console.log to PostHog.

    Each source is capped to ~256 KB and split into `log_chunk` events; a
    summary `logs_uploaded` event records how much was sent. No-ops when
    telemetry is disabled."""
    if not _client:
        log.debug("telemetry: upload_logs skipped — telemetry disabled")
        return
    try:
        tracker_path = DAC_DIR / "tracker.log"
        console_path = _find_console_log()

        tracker_tail = _read_tail(tracker_path)
        console_tail = _read_tail(console_path) if console_path else ""

        tracker_chunks = _send_log_chunks("tracker_log", tracker_tail, reason)
        console_chunks = _send_log_chunks("console_log", console_tail, reason)

        summary = {
            "reason": reason,
            "tracker_bytes": len(tracker_tail.encode("utf-8", errors="replace")),
            "tracker_chunks": tracker_chunks,
            "console_bytes": len(console_tail.encode("utf-8", errors="replace")),
            "console_chunks": console_chunks,
            "console_found": bool(console_path),
        }
        capture("logs_uploaded", summary)
        flush()
        log.info(
            "telemetry: logs uploaded (reason=%s) tracker=%d bytes/%d chunks, "
            "console=%d bytes/%d chunks",
            reason, summary["tracker_bytes"], tracker_chunks,
            summary["console_bytes"], console_chunks,
        )
    except Exception as e:
        log.warning("telemetry: upload_logs failed: %s", e)


# ── Log forwarding handler ──────────────────────────────────────────────────

class PostHogLogHandler(logging.Handler):
    """Forwards WARNING+ log records to PostHog as `backend_log` events.

    This is how warnings/errors reach PostHog automatically without scattering
    capture() calls through the codebase. Guarded against recursion and never
    raises out of emit()."""

    def __init__(self, level=logging.WARNING):
        super().__init__(level=level)

    def emit(self, record):
        if not _client:
            return
        try:
            # Don't echo our own telemetry diagnostics back into PostHog.
            msg = record.getMessage()
            if msg.startswith("telemetry:"):
                return
            capture("backend_log", {
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record) if self.formatter else msg,
            })
        except Exception:
            # Logging handlers must never raise.
            pass


def attach_log_handler(logger: logging.Logger | None = None,
                       level=logging.WARNING) -> PostHogLogHandler | None:
    """Attach a PostHogLogHandler to the given logger (default: ``dac``).

    Safe to call when telemetry is disabled — the handler simply no-ops in
    emit() until/unless a client exists."""
    try:
        target = logger or logging.getLogger("dac")
        handler = PostHogLogHandler(level=level)
        handler.setFormatter(logging.Formatter("%(message)s"))
        target.addHandler(handler)
        return handler
    except Exception as e:
        log.debug("telemetry: attach_log_handler failed: %s", e)
        return None
