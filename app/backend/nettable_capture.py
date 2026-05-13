"""Automatic NetTable capture from Dota's console.log.

Flow:
    1. On startup, install autoexec.cfg (binds F12 to dac_dump_all) into
       <dota>/game/dota/cfg/.
    2. Tail console.log non-blockingly. Three triggers matter:
       - DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: schedule mid-game F12 ~30s
         later (once per game).
       - DOTA_GAMERULES_STATE_POST_GAME: schedule post-game F12 ~5s later
         (captures `end_board`, once per game).
       - [stringtables] table CustomNetTable_*: collect the dump block;
         when it stabilises (~2s without new [stringtables] lines), ingest
         to Supabase.
    3. F12 is delivered via PostMessageW so it works without focus.

Emits events via the headless _emit callback:
    nettable_status          — startup + on-demand status snapshot
    nettable_dump_captured   — dump block stabilised
    nettable_ingest_complete — rows written to Supabase
    nettable_ingest_error    — failure during ingest
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from nettable_parser import parse_log

log = logging.getLogger("dac")


# ── autoexec.cfg payload (single source of truth, written verbatim) ──────────

AUTOEXEC_CFG_CONTENT = """// DAC NetTable dump trigger — installed by DAC Tracker.
//
// Source 2 runs `autoexec.cfg` once at every Dota launch. Defines the
// dac_dump_all alias and binds it to F8. Pressing F8 in-game writes
// all six CustomNetTable dumps to console.log.
//
// Key choice: F1-F4 select hero, F9 = pause in multiplayer matches,
// F10 = disconnect menu, F12 = Steam screenshot. F8 has no default
// Dota binding and is what PostMessageW also sends for auto-triggers.
//
// `console.log` writing still requires the `-condebug` launch option —
// Source 2's `log` cvar turns on server-event logging, not client
// console logging, so there's no autoexec workaround.

alias dac_dump_all "dumpstringtable CustomNetTable_ranking_top_table cl verbose; dumpstringtable CustomNetTable_match_history_table cl verbose; dumpstringtable CustomNetTable_dac_table cl verbose; dumpstringtable CustomNetTable_player_id_table cl verbose; dumpstringtable CustomNetTable_player_info_table cl verbose; dumpstringtable CustomNetTable_game_info cl verbose"

bind "F8" "dac_dump_all"
"""


# ── Dota directory candidates (mirrors tools/dac_dump/ingest.py) ─────────────

CANDIDATE_DOTA_DIRS = [
    Path("C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta"),
    Path("C:/Program Files/Steam/steamapps/common/dota 2 beta"),
    Path.home() / ".steam/steam/steamapps/common/dota 2 beta",
    Path.home() / ".local/share/Steam/steamapps/common/dota 2 beta",
    Path.home() / "Library/Application Support/Steam/steamapps/common/dota 2 beta",
]


def find_dota_dir() -> Path | None:
    for p in CANDIDATE_DOTA_DIRS:
        if p.exists():
            return p
    return None


def find_console_log(dota_dir: Path) -> Path:
    return dota_dir / "game" / "dota" / "console.log"


def find_autoexec_target(dota_dir: Path) -> Path:
    return dota_dir / "game" / "dota" / "cfg" / "autoexec.cfg"


# ── Steam launch-options lookup (authoritative source for -condebug etc.) ────

CANDIDATE_STEAM_USERDATA_DIRS = [
    Path("C:/Program Files (x86)/Steam/userdata"),
    Path("C:/Program Files/Steam/userdata"),
    Path.home() / ".steam/steam/userdata",
    Path.home() / ".local/share/Steam/userdata",
    Path.home() / "Library/Application Support/Steam/userdata",
]

DOTA_APP_ID = "570"
STEAM64_BASE = 76561197960265728  # subtract from SteamID64 to get AccountID

_LO_FIELD_RE = re.compile(r'"LaunchOptions"\s*"([^"]*)"')
_MOST_RECENT_RE = re.compile(
    r'"(\d{17})"\s*\{[^}]*?"MostRecent"\s*"1"', re.DOTALL
)


def find_active_steam_account_id() -> str | None:
    """Return the AccountID of the currently-active Steam user.

    Why this matters: a Windows box can have multiple `userdata/<account>/`
    dirs, each with its own `localconfig.vdf` and per-account launch options.
    Picking the wrong one means we read someone else's `-condebug` setting
    and lie to the UI about the active session.

    Strategy:
        1. `HKCU\\Software\\Valve\\Steam\\ActiveUser` — set while Steam is
           running. 0 when Steam is closed.
        2. `Steam/config/loginusers.vdf` `MostRecent "1"` — survives a
           Steam restart, reflects the last logged-in account.

    Returns the 32-bit AccountID as a string (matches the userdata dir
    name), or None if neither source resolves.
    """
    try:
        import winreg  # noqa: PLC0415 — Windows-only import
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam"
        ) as k:
            val, _ = winreg.QueryValueEx(k, "ActiveUser")
            if val and int(val) != 0:
                return str(int(val))
    except (ImportError, OSError, ValueError, TypeError):
        pass

    for udir in CANDIDATE_STEAM_USERDATA_DIRS:
        login_file = udir.parent / "config" / "loginusers.vdf"
        if not login_file.exists():
            continue
        try:
            text = login_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        m = _MOST_RECENT_RE.search(text)
        if m:
            return str(int(m.group(1)) - STEAM64_BASE)
    return None


def find_dota_launch_options(account_id: str | None = None) -> str | None:
    """Return the Dota 2 launch-options string from Steam's localconfig.vdf.

    Pass the logged-in user's AccountID to scope the lookup. Without it
    we fall back to detecting the active user via the registry / login
    users file — works but is one step removed from the truth the rest
    of the backend already knows.

    Three-valued return:
        None  — couldn't read localconfig.vdf or no 570 block exists. The
                UI should treat this as "unknown".
        ""    — 570 block exists but has no LaunchOptions field. The user
                has never set any launch options, so the required flags
                are definitely missing.
        str   — the actual launch-options string.
    """
    cfg = find_localconfig_vdf(account_id)
    if not cfg:
        return None
    try:
        text = cfg.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    body_start, body_end = _find_app_block_bounds(text, DOTA_APP_ID)
    if body_start is None:
        return None
    body = text[body_start:body_end]
    m = _LO_FIELD_RE.search(body)
    return m.group(1).strip() if m else ""


def _tokenize_launch_options(opts: str) -> set[str]:
    """Lowercase, whitespace-split. Robust enough for flag presence checks."""
    return {tok.lower() for tok in opts.split() if tok}


def find_localconfig_vdf(account_id: str | None = None) -> Path | None:
    """Locate the localconfig.vdf for a specific Steam account.

    A machine can have several `userdata/<account>/` dirs left behind by
    past logins; each one has its own copy of `localconfig.vdf` with
    independent launch options. If the caller knows which account is
    logged in (the rest of the backend does — `config.json` has it),
    pass it directly. Otherwise we fall back to the active-user heuristic.
    """
    active = account_id or find_active_steam_account_id()
    for udir in CANDIDATE_STEAM_USERDATA_DIRS:
        if not udir.exists():
            continue
        # 1. Try the active account first — this is the authoritative match.
        if active:
            cfg = udir / active / "config" / "localconfig.vdf"
            if cfg.exists():
                try:
                    text = cfg.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    text = None
                if text and _find_app_block_bounds(text, DOTA_APP_ID)[0] is not None:
                    return cfg
        # 2. Fallback: scan all user dirs (skip active, we already tried it).
        try:
            children = sorted(udir.iterdir())
        except OSError:
            continue
        for user_dir in children:
            if active and user_dir.name == active:
                continue
            cfg = user_dir / "config" / "localconfig.vdf"
            if not cfg.exists():
                continue
            try:
                text = cfg.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if _find_app_block_bounds(text, DOTA_APP_ID)[0] is not None:
                return cfg
    return None


def _find_app_block_bounds(text: str, app_id: str) -> tuple[int | None, int | None]:
    """Return (body_start, body_end) of the `"<app_id>" { ... }` block inside
    the `"apps"` map. Brace-balanced — handles nested objects inside the
    block (e.g. BadgeData)."""
    apps_idx = text.find('"apps"')
    if apps_idx < 0:
        return None, None
    needle = f'"{app_id}"'
    cursor = apps_idx
    while True:
        idx = text.find(needle, cursor)
        if idx < 0:
            return None, None
        # Skip past whitespace to the opening brace; bail if we hit something else.
        i = idx + len(needle)
        while i < len(text) and text[i] in " \t\r\n":
            i += 1
        if i >= len(text) or text[i] != '{':
            cursor = idx + 1
            continue
        body_start = i + 1
        # Brace-balance forward
        depth = 1
        j = body_start
        while j < len(text):
            ch = text[j]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return body_start, j
            j += 1
        return None, None


def is_steam_running() -> bool:
    """Detect whether steam.exe is currently a running process."""
    return _is_process_running("steam.exe")


def is_dota_running() -> bool:
    """Detect whether dota2.exe is currently a running process."""
    return _is_process_running("dota2.exe")


def _is_process_running(image_name: str) -> bool:
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {image_name}", "/NH"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
        return image_name.lower() in result.stdout.lower()
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return False


def find_steam_exe() -> Path | None:
    """Locate steam.exe by walking the candidate userdata roots."""
    for udir in CANDIDATE_STEAM_USERDATA_DIRS:
        if not udir.exists():
            continue
        exe = udir.parent / "steam.exe"
        if exe.exists():
            return exe
    return None


def request_steam_shutdown() -> bool:
    """Ask Steam to quit gracefully via `steam.exe -shutdown`. Returns True
    if the launcher was successfully invoked (not that Steam has actually
    exited — use wait_for_steam_exit for that)."""
    exe = find_steam_exe()
    if not exe:
        return False
    try:
        subprocess.Popen(
            [str(exe), "-shutdown"],
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
        return True
    except (subprocess.SubprocessError, OSError):
        return False


def wait_for_steam_exit(timeout_sec: float = 15.0, poll_sec: float = 0.5) -> bool:
    """Block until is_steam_running() returns False or timeout elapses."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if not is_steam_running():
            return True
        time.sleep(poll_sec)
    return not is_steam_running()


def apply_dota_launch_options(
    flags_to_ensure: list[str], steam_id: str | None = None
) -> dict:
    """Surgically append missing flags to Dota's LaunchOptions in localconfig.vdf.

    Pass `steam_id` (SteamID64) to scope the edit to the logged-in user's
    `userdata/<account>/config/localconfig.vdf`. Without it we fall back
    to active-user detection.

    Returns a dict suitable for emitting back to the renderer. Always
    writes a `.bak` next to the original on success.
    """
    if not flags_to_ensure:
        return {"ok": False, "error": "No flags requested"}

    account_id = (
        str(int(steam_id) - STEAM64_BASE) if steam_id else None
    )

    if is_steam_running():
        return {
            "ok": False,
            "error": (
                "Steam is running. Quit Steam fully (system-tray icon → "
                "Exit Steam) before applying launch options, then click "
                "again — Steam overwrites localconfig.vdf on shutdown."
            ),
        }

    cfg_path = find_localconfig_vdf(account_id)
    if not cfg_path:
        return {
            "ok": False,
            "error": (
                "Couldn't find Steam's localconfig.vdf with a Dota 2 entry. "
                "Open Steam → right-click Dota 2 → Properties at least once "
                "first, then try again."
            ),
        }

    try:
        text = cfg_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return {"ok": False, "error": f"Couldn't read {cfg_path}: {e}"}

    body_start, body_end = _find_app_block_bounds(text, DOTA_APP_ID)
    if body_start is None:
        return {
            "ok": False,
            "error": "No Dota 2 (app 570) block found in localconfig.vdf.",
        }
    body = text[body_start:body_end]

    # Find the LaunchOptions field at the top level of the block. We allow
    # nested objects in the body but skip over them so we don't pick up a
    # LaunchOptions somewhere unexpected.
    def _top_level_launch_options(body_text: str) -> re.Match | None:
        depth = 0
        i = 0
        while i < len(body_text):
            ch = body_text[i]
            if ch == '{':
                depth += 1
                i += 1
                continue
            if ch == '}':
                depth -= 1
                i += 1
                continue
            if depth == 0 and body_text.startswith('"LaunchOptions"', i):
                # Match field + value: "LaunchOptions"\s*"..."
                m = re.match(r'"LaunchOptions"\s*"([^"]*)"', body_text[i:])
                if m:
                    abs_start = i
                    abs_end = i + m.end()
                    value_start = i + m.start(1)
                    value_end = i + m.end(1)
                    return _LaunchOptsMatch(
                        full_start=abs_start, full_end=abs_end,
                        value_start=value_start, value_end=value_end,
                        existing=m.group(1),
                    )
            i += 1
        return None

    existing_match = _top_level_launch_options(body)

    if existing_match:
        existing = existing_match.existing
        existing_tokens = existing.split()
        existing_lower = {t.lower() for t in existing_tokens}
        added: list[str] = []
        new_tokens = list(existing_tokens)
        for flag in flags_to_ensure:
            if flag.lower() not in existing_lower:
                new_tokens.append(flag)
                added.append(flag)
        new_value = " ".join(new_tokens)
        if not added:
            return {
                "ok": True,
                "noop": True,
                "before": existing,
                "after": existing,
                "added": [],
                "config_path": str(cfg_path),
            }
        new_body = (
            body[: existing_match.value_start]
            + new_value
            + body[existing_match.value_end :]
        )
    else:
        added = list(flags_to_ensure)
        new_value = " ".join(flags_to_ensure)
        existing = ""
        # Insert a new LaunchOptions field before the block's closing brace.
        # Match indentation of the nearest existing sibling field if present.
        sample = re.search(r'\n([ \t]*)"', body)
        indent = sample.group(1) if sample else "\t\t\t\t\t"
        insertion = f'\n{indent}"LaunchOptions"\t\t"{new_value}"'
        new_body = body.rstrip("\r\n") + insertion + "\n"

    new_text = text[:body_start] + new_body + text[body_end:]

    backup = cfg_path.with_suffix(cfg_path.suffix + ".bak")
    try:
        backup.write_text(text, encoding="utf-8")
        cfg_path.write_text(new_text, encoding="utf-8")
    except OSError as e:
        return {"ok": False, "error": f"Couldn't write {cfg_path}: {e}"}

    return {
        "ok": True,
        "noop": False,
        "before": existing,
        "after": new_value,
        "added": added,
        "config_path": str(cfg_path),
        "backup_path": str(backup),
    }


class _LaunchOptsMatch:
    __slots__ = ("full_start", "full_end", "value_start", "value_end", "existing")

    def __init__(self, full_start, full_end, value_start, value_end, existing):
        self.full_start = full_start
        self.full_end = full_end
        self.value_start = value_start
        self.value_end = value_end
        self.existing = existing


# ── Dota window detection (HWND variant of capture._find_dota_window) ────────

def find_dota_hwnd() -> int | None:
    """Return the HWND of the Dota 2 window, or None."""
    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        WNDENUMPROC = ctypes.WINFUNCTYPE(
            ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)
        )
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        result: list[int] = []

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
                    result.append(int(hwnd))
            return True

        user32.EnumWindows(WNDENUMPROC(callback), 0)
        return result[0] if result else None
    except Exception as e:
        log.warning("find_dota_hwnd failed: %s", e)
        return None


# ── F12 keystroke via PostMessageW (works without focus) ─────────────────────

WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
VK_F8 = 0x77


def send_f12_to_dota() -> bool:
    """PostMessage F12 down+up to the Dota window. Returns True on success."""
    hwnd = find_dota_hwnd()
    if not hwnd:
        log.warning("send_f12_to_dota: Dota window not found")
        return False
    try:
        user32 = ctypes.windll.user32
        # 0xC0000001 is the standard repeat=1, transition=1, previous-state=1
        # lParam for a keyup. PostMessageW is async, fire-and-forget.
        user32.PostMessageW(hwnd, WM_KEYDOWN, VK_F12, 0)
        time.sleep(0.05)
        user32.PostMessageW(hwnd, WM_KEYUP, VK_F12, 0xC0000001)
        log.info("Sent F12 to Dota hwnd=%s", hwnd)
        return True
    except Exception as e:
        log.warning("send_f12_to_dota failed: %s", e)
        return False


# ── Ingest helpers (shape rows for dac_nettable_dumps and POST to Supabase) ──

CUSTOM_NETTABLE_PREFIX = "CustomNetTable_"


def normalize_allow(allow_raw: str) -> set[str]:
    """Accept both bare ('dac_table') and prefixed ('CustomNetTable_dac_table') names."""
    out: set[str] = set()
    for name in (s.strip() for s in allow_raw.split(",")):
        if not name:
            continue
        if not name.startswith(CUSTOM_NETTABLE_PREFIX):
            name = CUSTOM_NETTABLE_PREFIX + name
        out.add(name)
    return out


def extract_rows(
    log_path: Path,
    allow: set[str] | None = None,
    include_errors: bool = False,
    all_tables: bool = False,
) -> list[dict[str, Any]]:
    """Decode console.log dumps and shape rows for ``dac_nettable_dumps``.

    Returns ``[{table_name, key, raw}, ...]``. In-run dedup on
    (table_name, key, canonical-JSON of raw).
    """
    decoded = parse_log(log_path)
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    for table_name, entries in decoded.items():
        if not all_tables and not table_name.startswith(CUSTOM_NETTABLE_PREFIX):
            continue
        if allow and table_name not in allow:
            continue
        for key, raw in entries.items():
            if isinstance(raw, dict) and "_decode_error" in raw and not include_errors:
                continue
            canonical = json.dumps(raw, sort_keys=True, ensure_ascii=False)
            sig = (table_name, key, canonical)
            if sig in seen:
                continue
            seen.add(sig)
            rows.append({"table_name": table_name, "key": key, "raw": raw})

    return rows


def insert_dumps(client, rows: list[dict[str, Any]]) -> int:
    """POST rows to dac_nettable_dumps in chunks. ``client`` is an httpx.Client."""
    if not rows:
        return 0
    CHUNK = 250
    written = 0
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i : i + CHUNK]
        resp = client.post(
            "/rest/v1/dac_nettable_dumps",
            headers={"Content-Type": "application/json", "Prefer": "return=minimal"},
            content=json.dumps(chunk),
        )
        resp.raise_for_status()
        written += len(chunk)
    return written


# ── Main capture class ──────────────────────────────────────────────────────

GAME_IN_PROGRESS_RE = "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"
POST_GAME_RE = "DOTA_GAMERULES_STATE_POST_GAME"
STRINGTABLE_MARKER = "[stringtables]"

# Wait this long after GAME_IN_PROGRESS before sending F12. Gives the
# CustomNetTables time to populate.
F12_DELAY_SEC = 30.0

# Wait this long after POST_GAME before sending F12 again. The `end_board`
# table is populated server-side at POST_GAME entry; small buffer for the
# broadcast to land at the client.
F12_POSTGAME_DELAY_SEC = 5.0

# A dump block is considered stable when no new [stringtables] lines arrive
# for this many seconds.
DUMP_STABILISE_SEC = 2.0

# How often to poll the log file when no data is arriving.
POLL_IDLE_SEC = 0.5

# console.log counts as "active" if it was modified within this many seconds.
# Long enough to bridge the gaps between Dota's normal stdout flushes, short
# enough to detect "Dota is running but -condebug isn't on" reasonably fast.
LOG_ACTIVE_WINDOW_SEC = 30.0


class NetTableCapture:
    """Tail Dota's console.log, send F12 mid- and post-game, ingest dumps."""

    def __init__(self, emit: Callable[[dict], None], steam_id: str | None = None):
        self._emit = emit
        self._stop = threading.Event()
        self._dota_dir = find_dota_dir()
        self._log_path = find_console_log(self._dota_dir) if self._dota_dir else None
        # The logged-in Steam user. Used to scope localconfig.vdf reads to
        # the right userdata/<account>/ dir — a machine can have multiple.
        self._steam_id = steam_id
        self._account_id = (
            str(int(steam_id) - STEAM64_BASE) if steam_id else None
        )

        # Status (re-emitted on demand via emit_status())
        self._autoexec_installed = False

        # Tail state
        self._file = None  # type: ignore
        self._inode_size = 0  # last-seen size, used to detect truncation

        # Per-game F12 debounce
        self._f12_armed = False  # set when in-progress seen, cleared after send
        self._f12_timer: threading.Timer | None = None
        self._f12_sent_for_game = False
        self._f12_sent_for_postgame = False

        # Dump block accumulator
        self._dump_active = False
        self._dump_last_line_ts = 0.0
        self._dump_seen_tables: set[str] = set()

        # Latest decoded per-(table, key) state. Updated after each ingest,
        # re-emitted on demand so the UI can render the live snapshot.
        self._last_state: dict[str, dict[str, Any]] = {}
        self._last_state_at: str | None = None

        # Status signature used by the poll thread to decide whether to re-emit.
        self._last_status_signature: tuple = ()

    # ── Public API ─────────────────────────────────────────────────────────

    def start(self) -> None:
        """Install autoexec, then start the daemon tailer thread."""
        self._autoexec_installed = self._install_autoexec()

        # Visibility log: dump what we resolved at startup so it's obvious
        # which Steam account / launch options we're reading.
        cfg_path = find_localconfig_vdf(self._account_id)
        opts = find_dota_launch_options(self._account_id)
        log.info(
            "nettable: steam_id=%s account_id=%s localconfig=%s "
            "launch_options=%r has_condebug=%s has_conclearlog=%s",
            self._steam_id,
            self._account_id,
            cfg_path,
            opts,
            ("-condebug" in (opts or "").split()) if opts is not None else None,
            ("-conclearlog" in (opts or "").split()) if opts is not None else None,
        )

        self.emit_status()
        self._last_status_signature = self._current_status_signature()

        t = threading.Thread(target=self._run, daemon=True, name="nettable-tail")
        t.start()
        p = threading.Thread(target=self._run_status_poll, daemon=True, name="nettable-status-poll")
        p.start()

    def emit_status(self) -> None:
        """Re-emit current status. Called on demand when the renderer asks.

        The status combines:
            - Config-derived flags (parsed from localconfig.vdf — included
              but UI shouldn't trust them as ground truth because Steam
              Cloud can revert them).
            - Empirical ground-truth signals: dota_running, log_active
              (console.log was modified within LOG_ACTIVE_WINDOW_SEC).
              These together are the actual answer to "is -condebug
              doing its job right now". The UI prefers these.
        """
        log_writable = bool(self._log_path and self._log_path.exists())
        opts = find_dota_launch_options(self._account_id)
        opts_tokens = _tokenize_launch_options(opts) if opts is not None else None
        dota_running = is_dota_running()
        log_active = self._is_log_active()
        self._emit({
            "type": "nettable_status",
            "autoexec_installed": bool(self._autoexec_installed),
            "log_path": str(self._log_path) if self._log_path else "",
            "log_writable": log_writable,
            "dota_dir": str(self._dota_dir) if self._dota_dir else "",
            # Empirical ground truth — what's actually happening right now.
            "dota_running": dota_running,
            "log_active": log_active,
            # Config-derived — for the Apply button to know what to write.
            # None for has_* means "couldn't read localconfig".
            "launch_options": opts,
            "has_condebug": ("-condebug" in opts_tokens) if opts_tokens is not None else None,
            "has_conclearlog": ("-conclearlog" in opts_tokens) if opts_tokens is not None else None,
            "steam_running": is_steam_running(),
        })

    def _is_log_active(self) -> bool:
        """True if console.log was modified within the active window.

        This is the actual proof that -condebug is doing its job: if Dota
        is running and the file is being written to, the flag is set.
        If Dota is running and the file isn't being written, the flag is
        missing regardless of what Steam's config claims.
        """
        if not self._log_path:
            return False
        try:
            mtime = self._log_path.stat().st_mtime
        except OSError:
            return False
        age = time.time() - mtime
        return age < LOG_ACTIVE_WINDOW_SEC

    def emit_state(self) -> None:
        """Re-emit the latest decoded per-(table,key) snapshot."""
        self._emit({
            "type": "nettable_state",
            "state": self._last_state,
            "at": self._last_state_at or "",
        })

    def _current_status_signature(self) -> tuple:
        """Snapshot the bits of status that we re-emit when they change.

        Includes the empirical signals (dota_running, log_active) so the
        UI gets pushed an update the moment Dota starts or stops, and the
        moment console.log starts/stops being written to.
        """
        opts = find_dota_launch_options(self._account_id)
        return (
            bool(self._autoexec_installed),
            bool(self._log_path and self._log_path.exists()),
            opts,
            is_steam_running(),
            is_dota_running(),
            self._is_log_active(),
        )

    def _run_status_poll(self) -> None:
        """Re-emit nettable_status whenever Steam state or launch options
        change externally. Catches: user closing Steam manually, user
        editing launch options through Steam's UI."""
        while not self._stop.is_set():
            time.sleep(2.0)
            if self._stop.is_set():
                return
            try:
                sig = self._current_status_signature()
            except Exception:
                continue
            if sig != self._last_status_signature:
                self._last_status_signature = sig
                self.emit_status()

    def stop(self) -> None:
        self._stop.set()
        if self._f12_timer:
            try:
                self._f12_timer.cancel()
            except Exception:
                pass
        if self._file:
            try:
                self._file.close()
            except Exception:
                pass

    # ── autoexec installation ──────────────────────────────────────────────

    def _install_autoexec(self) -> bool:
        if not self._dota_dir:
            log.warning("nettable: Dota dir not found — autoexec not installed")
            return False
        dst = find_autoexec_target(self._dota_dir)
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            desired = AUTOEXEC_CFG_CONTENT.encode("utf-8")
            if dst.exists():
                existing = dst.read_bytes()
                if _sha256(existing) == _sha256(desired):
                    log.info("nettable: autoexec.cfg already current at %s", dst)
                    return True
            dst.write_bytes(desired)
            log.info("nettable: wrote autoexec.cfg to %s", dst)
            return True
        except Exception as e:
            log.warning("nettable: failed to install autoexec.cfg: %s", e)
            return False

    # ── Tail loop ──────────────────────────────────────────────────────────

    def _run(self) -> None:
        if not self._log_path:
            log.warning("nettable: no console.log path — tailer not starting")
            return
        log.info("nettable: tailing %s", self._log_path)

        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as e:
                log.warning("nettable: tail tick error: %s", e, exc_info=True)
                time.sleep(1.0)

    def _tick(self) -> None:
        # Open / reopen if needed
        if self._file is None:
            if not self._log_path.exists():
                time.sleep(POLL_IDLE_SEC * 2)
                return
            self._open_log(seek_to_end=True)

        # Detect truncation (Dota with -conclearlog rewrites the file each launch).
        try:
            size = self._log_path.stat().st_size
        except OSError:
            self._close_log()
            time.sleep(POLL_IDLE_SEC)
            return
        if size < self._inode_size:
            log.info("nettable: console.log truncated (size %d -> %d) — reopening",
                     self._inode_size, size)
            self._close_log()
            self._reset_per_log_state()
            return
        self._inode_size = size

        line = self._file.readline()
        if not line:
            self._maybe_finalize_dump()
            time.sleep(POLL_IDLE_SEC)
            return

        self._handle_line(line.rstrip("\r\n"))

    def _open_log(self, *, seek_to_end: bool) -> None:
        try:
            self._file = open(self._log_path, "r", encoding="utf-8", errors="replace")
            if seek_to_end:
                self._file.seek(0, os.SEEK_END)
            self._inode_size = self._log_path.stat().st_size
        except OSError as e:
            log.warning("nettable: failed to open %s: %s", self._log_path, e)
            self._file = None

    def _close_log(self) -> None:
        if self._file:
            try:
                self._file.close()
            except Exception:
                pass
            self._file = None

    def _reset_per_log_state(self) -> None:
        """Drop game-scoped state when the log file is rewritten."""
        self._f12_armed = False
        self._f12_sent_for_game = False
        self._f12_sent_for_postgame = False
        if self._f12_timer:
            try:
                self._f12_timer.cancel()
            except Exception:
                pass
            self._f12_timer = None
        self._dump_active = False
        self._dump_seen_tables = set()
        self._dump_last_line_ts = 0.0

    # ── Line handlers ──────────────────────────────────────────────────────

    def _handle_line(self, line: str) -> None:
        # F12 trigger #1: mid-game (once per game, ~30s after GAME_IN_PROGRESS).
        if not self._f12_sent_for_game and GAME_IN_PROGRESS_RE in line:
            self._schedule_f12()
            return

        # F12 trigger #2: post-game (captures end_board). Once per game.
        if not self._f12_sent_for_postgame and POST_GAME_RE in line:
            self._schedule_postgame_f12()
            return

        # Dump block accumulation
        if STRINGTABLE_MARKER in line:
            self._note_dump_line(line)

    def _schedule_f12(self) -> None:
        if self._f12_armed or self._f12_sent_for_game:
            return
        self._f12_armed = True
        log.info("nettable: GAME_IN_PROGRESS detected — scheduling F12 in %.0fs",
                 F12_DELAY_SEC)
        t = threading.Timer(F12_DELAY_SEC, self._do_send_f12)
        t.daemon = True
        t.start()
        self._f12_timer = t

    def _do_send_f12(self) -> None:
        if self._f12_sent_for_game:
            return
        ok = send_f12_to_dota()
        self._f12_armed = False
        if ok:
            self._f12_sent_for_game = True
        else:
            log.info("nettable: F12 send failed — leaving disarmed for retry")

    def _schedule_postgame_f12(self) -> None:
        if self._f12_sent_for_postgame:
            return
        log.info(
            "nettable: POST_GAME detected — scheduling F12 in %.0fs",
            F12_POSTGAME_DELAY_SEC,
        )
        t = threading.Timer(F12_POSTGAME_DELAY_SEC, self._do_send_postgame_f12)
        t.daemon = True
        t.start()

    def _do_send_postgame_f12(self) -> None:
        if self._f12_sent_for_postgame:
            return
        ok = send_f12_to_dota()
        if ok:
            self._f12_sent_for_postgame = True
        else:
            log.info("nettable: post-game F12 send failed")

    def _note_dump_line(self, line: str) -> None:
        idx = line.find("table ")
        if idx != -1:
            after = line[idx + len("table "):].split()
            if after and after[0].startswith(CUSTOM_NETTABLE_PREFIX):
                self._dump_seen_tables.add(after[0])

        self._dump_active = True
        self._dump_last_line_ts = time.time()

    def _maybe_finalize_dump(self) -> None:
        if not self._dump_active:
            return
        if time.time() - self._dump_last_line_ts < DUMP_STABILISE_SEC:
            return
        tables = sorted(self._dump_seen_tables)
        self._dump_active = False
        self._dump_seen_tables = set()
        self._dump_last_line_ts = 0.0

        if not tables:
            log.info("nettable: dump block contained no CustomNetTable_* entries — skipping")
            return

        log.info("nettable: dump block stable, tables=%s", tables)
        self._emit({
            "type": "nettable_dump_captured",
            "tables": tables,
            "at": datetime.now().isoformat(),
        })

        threading.Thread(
            target=self._do_ingest,
            args=(tables,),
            daemon=True,
            name="nettable-ingest",
        ).start()

    # ── Ingest ─────────────────────────────────────────────────────────────

    def _do_ingest(self, tables: list[str]) -> None:
        try:
            rows = extract_rows(self._log_path)
            if not rows:
                log.info("nettable: ingest found no rows — skipping")
                return

            try:
                import httpx
            except ImportError as e:
                raise RuntimeError(f"httpx required for ingest: {e}")

            from utils import load_config
            cfg = load_config()
            url = cfg.get("supabase_url")
            key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or cfg.get("supabase_key")
            if not url or not key:
                raise RuntimeError("supabase_url / key missing from config")

            # Merge into local snapshot FIRST. Capture and ingest are
            # independent concerns: if Supabase auth fails the data we
            # decoded is still valid and the live-capture panel should
            # show it. Re-broadcasting state always.
            now_iso = datetime.now().isoformat()
            for r in rows:
                bucket = self._last_state.setdefault(r["table_name"], {})
                bucket[r["key"]] = r["raw"]
            self._last_state_at = now_iso
            self._emit({
                "type": "nettable_state",
                "state": self._last_state,
                "at": now_iso,
            })

            with httpx.Client(
                base_url=url.rstrip("/"),
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Accept": "application/json",
                },
                timeout=60,
            ) as client:
                written = insert_dumps(client, rows)

            log.info("nettable: ingested %d row(s) across %d table(s)", written, len(tables))
            self._emit({
                "type": "nettable_ingest_complete",
                "rows_written": written,
                "tables": tables,
                "at": now_iso,
            })
            self.emit_state()
        except Exception as e:
            log.warning("nettable: ingest failed: %s", e, exc_info=True)
            self._emit({
                "type": "nettable_ingest_error",
                "error": f"{type(e).__name__}: {e}",
            })


# ── helpers ─────────────────────────────────────────────────────────────────

def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
