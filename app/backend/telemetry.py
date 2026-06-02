"""PostHog telemetry for the DAC Tracker headless backend.

Mirrors the safety model of the web equivalent (``web/lib/posthog.ts``):
when no project token resolves, EVERYTHING here no-ops silently. No public
function in this module may ever raise into its caller or block the backend.

Hard rule: telemetry must NEVER write to stdout — stdout is the JSON Lines
protocol the Electron renderer parses. All diagnostics go through the ``dac``
logger (file + the renderer's JSON log sink) or, as a last resort, stderr.
"""

import gzip
import logging
import os
import sys
import time
import traceback
from pathlib import Path

from utils import DAC_DIR, load_config

# ── Configuration ─────────────────────────────────────────────────────────────

# Reuses the SAME PostHog project as the web viewer (so a person's web + app
# activity stitch into one profile via the shared steam_id distinct_id). This
# is the project's PUBLIC, write-only ingestion key — safe to embed (it already
# ships in the public web bundle). Baked in so packaged builds work with no
# per-user env; override via POSTHOG_DESKTOP_TOKEN env or `posthog_desktop_token`
# config key. Set to "" to disable telemetry entirely.
DEFAULT_POSTHOG_TOKEN = "phc_GUppkWFIfGM9WwVbEe33FM7aXn06JkIGWZ5P6MYy5zX"
DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com"

# Log tails are capped per-source so we never try to ship a multi-MB file.
LOG_TAIL_MAX_BYTES = 256 * 1024
# PostHog rejects very large event payloads, so a tail is split into chunks
# and sent as a sequence of `log_chunk` events. Stay well under the limit.
LOG_CHUNK_BYTES = 48 * 1024

# Small at-a-glance tail embedded in the `diagnostics_uploaded` event so the
# PostHog dashboard shows the end of each log without opening Supabase.
LOG_EVENT_TAIL_BYTES = 16 * 1024

# Remote kill switch for the CORE GAME-TRACKING feature (the nettable capture /
# SendInput cascade) — NOT telemetry. The developer flips this off in PostHog to
# disable game tracking on every client when it's misbehaving, with no redeploy.
# Telemetry/logging stays ALWAYS ON regardless, so the failure is still visible.
# Evaluated with a short TTL cache; fails OPEN (see is_game_tracking_enabled()).
FEATURE_FLAG = "game-tracking-enabled"
FLAG_CACHE_TTL = 300  # seconds

log = logging.getLogger("dac")

# ── Module state ────────────────────────────────────────────────────────────

_client = None              # posthog.Posthog instance, or None when disabled
_initialized = False
_distinct_id = None
_super_properties: dict = {}

# Kill-switch flag cache: (value, evaluated_at_monotonic_wallclock).
_flag_value: bool = True
_flag_checked_at: float = 0.0

# Stable per-session folder for log uploads, so periodic re-uploads overwrite
# the same Supabase objects instead of creating one per upload. Set in init().
_session_tag: str = ""


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
    global _client, _initialized, _distinct_id, _super_properties, _session_tag
    if _initialized:
        return
    _initialized = True
    _session_tag = time.strftime("%Y%m%d_%H%M%S")
    try:
        token = _resolve_token(config)
        if not token:
            log.debug("telemetry: no PostHog token configured — disabled")
            return

        _distinct_id = (config or {}).get("steam_id") or None
        _super_properties = {
            # Shared PostHog project with the web viewer — tag every desktop
            # event so web funnels/dashboards can filter on `source`.
            "source": "desktop_app",
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
        # Mirror the web viewer's person shape (web/pages/_app.tsx) so the same
        # human is one PostHog person across web + app: `$name` drives the
        # Persons-list label, `steam_id` is the stable distinct_id.
        props = {"steam_id": _distinct_id}
        if steam_name:
            props["$name"] = steam_name
            props["steam_name"] = steam_name
        if version:
            props["app_version"] = version
        _client.identify(distinct_id=_distinct_id, properties=props)
    except Exception as e:
        log.debug("telemetry: identify failed: %s", e)


# ── Kill switch (remote feature flag) ─────────────────────────────────────────

def _evaluate_flag() -> bool:
    """Ask PostHog whether telemetry is enabled. Fails OPEN (returns True) on
    any error or None result so a transient flag hiccup can't silently kill
    telemetry. Caller is responsible for the client-exists check + TTL cache."""
    try:
        feature_enabled = getattr(_client, "feature_enabled", None)
        if not callable(feature_enabled):
            return True  # client without flag support → fail open
        result = feature_enabled(FEATURE_FLAG, _distinct_id or "anonymous")
        if result is None:
            return True  # flag undefined / not loaded yet → fail open
        return bool(result)
    except Exception as e:
        log.debug("telemetry: feature flag eval failed (%s) — failing open", e)
        return True


def is_game_tracking_enabled() -> bool:
    """Whether the CORE game-tracking feature should run, per the remote
    ``game-tracking-enabled`` PostHog flag. NOT about telemetry (telemetry is
    always on). Fails OPEN (returns True): no client / no flag / any error →
    enabled, so tracking only stops on an explicit flag = false from the
    dashboard. Cached for ``FLAG_CACHE_TTL`` seconds."""
    global _flag_value, _flag_checked_at
    if not _client:
        return True  # can't reach flags → leave the core feature running
    try:
        now = time.time()
        if (now - _flag_checked_at) >= FLAG_CACHE_TTL or _flag_checked_at == 0.0:
            _flag_value = _evaluate_flag()
            _flag_checked_at = now
        return _flag_value
    except Exception:
        # Never let the gate itself disable a working feature — fail open.
        return True


def refresh_flags() -> None:
    """Prime / refresh the kill-switch cache. Safe to call at startup and
    periodically. No-ops when telemetry is disabled."""
    global _flag_value, _flag_checked_at
    if not _client:
        return
    try:
        _flag_value = _evaluate_flag()
        _flag_checked_at = time.time()
        log.debug("telemetry: kill switch refreshed (%s=%s)", FEATURE_FLAG, _flag_value)
    except Exception as e:
        log.debug("telemetry: refresh_flags failed: %s", e)


def capture(event: str, properties: dict | None = None) -> None:
    """Best-effort event capture. Always on (telemetry is observability and is
    not gated by the game-tracking kill switch). Swallows everything."""
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
    event carrying type/message/traceback. Always on — not gated by the
    game-tracking kill switch."""
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


def _read_full(path: Path) -> bytes:
    """Return the full raw file bytes, or b'' if unreadable."""
    try:
        if not path or not path.exists():
            return b""
        with open(path, "rb") as f:
            return f.read()
    except Exception as e:
        log.debug("telemetry: could not read %s: %s", path, e)
        return b""


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


def _tail_bytes(data: bytes, max_bytes: int = LOG_EVENT_TAIL_BYTES) -> str:
    """Last ``max_bytes`` of raw log bytes decoded for event triage."""
    if len(data) <= max_bytes:
        return data.decode("utf-8", errors="replace")
    return data[-max_bytes:].decode("utf-8", errors="replace")


def upload_logs(reason: str = "manual") -> None:
    """Upload the FULL tracker.log and Dota console.log to private Supabase
    storage (gzipped) and emit a single ``diagnostics_uploaded`` PostHog event
    carrying the storage paths, sizes, and a small ~16 KB tail of each for
    at-a-glance triage.

    Logs ALWAYS upload — the upload is independent of the kill switch and of
    the PostHog client, so the diagnostic safety net survives even when tracking
    is disabled. Only the ``diagnostics_uploaded`` event is gated (it flows
    through ``capture()``), so a flag-off run still ships logs to Supabase but
    stays silent in PostHog. Resilient: if the Supabase upload fails the event
    is still emitted with ``storage_ok: false``.

    Skips only when no steam_id is known yet (we need it for the storage path)."""
    user_id = _distinct_id
    if not user_id:
        try:
            user_id = (load_config() or {}).get("steam_id")
        except Exception:
            user_id = None
    if not user_id:
        log.debug("telemetry: upload_logs skipped — no steam_id yet")
        return
    try:
        tracker_path = DAC_DIR / "tracker.log"
        console_path = _find_console_log()

        tracker_data = _read_full(tracker_path)
        console_data = _read_full(console_path) if console_path else b""

        tracker_bytes = len(tracker_data)
        console_bytes = len(console_data)

        # Upload full gzipped files to private Supabase storage. Lazy import so
        # a db import failure can't crash telemetry.
        paths: dict = {}
        storage_ok = True
        upload = None
        try:
            from db import upload_diagnostic_log
            upload = upload_diagnostic_log
        except Exception as e:
            storage_ok = False
            log.debug("telemetry: db import for log upload failed: %s", e)

        if upload is not None:
            subdir = _session_tag or None
            try:
                if tracker_data:
                    gz = gzip.compress(tracker_data)
                    p = upload(user_id, "tracker.log.gz", gz, "application/gzip",
                               subdir=subdir, upsert=True)
                    if p:
                        paths["tracker_log"] = p
                    else:
                        storage_ok = False
                if console_data:
                    gz = gzip.compress(console_data)
                    p = upload(user_id, "console.log.gz", gz, "application/gzip",
                               subdir=subdir, upsert=True)
                    if p:
                        paths["console_log"] = p
                    else:
                        storage_ok = False
            except Exception as e:
                storage_ok = False
                log.debug("telemetry: storage upload failed: %s", e)

        summary = {
            "reason": reason,
            "paths": paths,
            "storage_ok": storage_ok,
            "tracker_bytes": tracker_bytes,
            "console_bytes": console_bytes,
            "console_found": bool(console_path),
            "tracker_tail": _tail_bytes(tracker_data),
            "console_tail": _tail_bytes(console_data),
        }
        capture("diagnostics_uploaded", summary)
        flush()
        log.info(
            "telemetry: diagnostics uploaded (reason=%s, storage_ok=%s) "
            "tracker=%d bytes, console=%d bytes, paths=%s",
            reason, storage_ok, tracker_bytes, console_bytes, paths,
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
