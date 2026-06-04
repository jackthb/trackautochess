"""Automatic NetTable capture from Dota's console.log.

Flow:
    1. On startup, install autoexec.cfg (binds dump keys) into
       <dota>/game/dota/cfg/.
    2. Tail console.log non-blockingly. Three triggers matter:
       - DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: opens the match session window.
       - DOTA_GAMERULES_STATE_POST_GAME: emit nettable_game_ended so the UI
         knows the match wrapped up.
       - [stringtables] table CustomNetTable_*: collect the dump block;
         when it stabilises (~2s without new [stringtables] lines), archive
         it locally and process it into the canonical match representation.
    3. Dumps are produced by the SendInput poller (see _run_key_poller):
       F23 (game_info) every 2s, F22/F20 snapshots when round_info changes,
       and one F24/F16 lobby metadata dump when a match/session opens while
       Dota is foreground. F21 (dac_table) is held for POST_GAME.

Emits events via the headless _emit callback:
    nettable_status          — startup + on-demand status snapshot
    nettable_dump_captured   — dump block stabilised
    nettable_ingest_complete — dump block processed; raw upload is opt-in
    nettable_ingest_error    — failure during ingest
"""

from __future__ import annotations

import ctypes
import gzip
import hashlib
import json
import logging
import os
import re
import shutil
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


# ── Storage filter ────────────────────────────────────────────────────────────
# Drop static/noise rows before writing to Supabase.
# In-memory state (_last_state, live view, slot mapping) is NOT filtered.

_STORAGE_DROP_TABLES = frozenset({
    "quest_table", "casino_table",
})

_STORAGE_DROP_KEYS: dict[str, frozenset[str]] = {
    "player_id_table": frozenset({"chessboard", "courier"}),
    "game_info": frozenset({"game_version", "quest"}),
}

def _storage_filter(rows: list[dict]) -> list[dict]:
    """Remove rows that shouldn't be persisted to Supabase."""
    out = []
    for r in rows:
        tbl = r.get("table_name", "")
        short = tbl.removeprefix("CustomNetTable_")
        if short in _STORAGE_DROP_TABLES:
            continue
        key = r.get("key", "")
        prefixes = _STORAGE_DROP_KEYS.get(short)
        if prefixes and any(key == p or key.startswith(p + "_") for p in prefixes):
            continue
        out.append(r)
    return out


def _config_bool(name: str, default: bool) -> bool:
    try:
        from utils import load_config
        value = load_config().get(name, default)
    except Exception:
        return default
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def keep_local_nettable_dumps() -> bool:
    """Return whether raw nettable captures should be archived on-device."""
    return _config_bool("keep_local_nettable_dumps", True)


def upload_raw_nettable_dumps() -> bool:
    """Return whether raw nettable rows should be uploaded to Postgres.

    Defaults off: Supabase should receive processed match/timeline records,
    while raw CustomNetTable dumps remain local debug material unless the user
    or developer explicitly opts in.
    """
    return _config_bool("upload_raw_nettable_dumps", False)


# ── autoexec.cfg payload (managed block, preserving user content) ────────────

AUTOEXEC_CFG_BLOCK_BEGIN = "// >>> DAC Tracker NetTable binds >>>"
AUTOEXEC_CFG_BLOCK_END = "// <<< DAC Tracker NetTable binds <<<"

AUTOEXEC_CFG_LEGACY_CONTENT = f"""// DAC NetTable dump triggers — installed by DAC Tracker.
//
// All binds use extended F-keys (F20-F25) to avoid conflicting with
// user keyboard shortcuts. One table per key.
//
// Cascade keys (fired automatically by the tracker):
//   F21 → dac_table            ← end_board at match end (POST_GAME only)
//   F22 → player_info_table    ← live per-player state (on round change)
//   F23 → game_info            ← round_info + death_team (every 2s)
//   F20 → player_id_table      ← board/items/relics (on round change)
//   F24 + F16 → ranking_top_table + player_id_table + chess_pool_table
//              ← Queen ladder, steam_id → slot mapping, one pool snapshot
//                (once per match/session opening)
//
// Debug keys (not in cascade — manual only):
//   F25 → unit_table           ← chess pieces on board

bind "F20" "dumpstringtable CustomNetTable_player_id_table cl verbose"
bind "F21" "dumpstringtable CustomNetTable_dac_table cl verbose"
bind "F22" "dumpstringtable CustomNetTable_player_info_table cl verbose"
bind "F23" "dumpstringtable CustomNetTable_game_info cl verbose"
bind "F24" "dumpstringtable CustomNetTable_ranking_top_table cl verbose;dumpstringtable CustomNetTable_player_id_table cl verbose"
bind "F16" "dumpstringtable CustomNetTable_chess_pool_table cl verbose"
bind "F25" "dumpstringtable CustomNetTable_unit_table cl verbose"
"""

AUTOEXEC_CFG_CONTENT = (
    f"{AUTOEXEC_CFG_BLOCK_BEGIN}\n"
    f"{AUTOEXEC_CFG_LEGACY_CONTENT.rstrip()}\n"
    f"{AUTOEXEC_CFG_BLOCK_END}\n"
)


def _upsert_managed_autoexec_block(existing: str) -> str:
    """Return autoexec.cfg content with only DAC Tracker's block updated.

    Users can have their own autoexec.cfg. We must not overwrite it; append our
    managed block if missing, replace only that block if present, and migrate the
    previous all-DAC file shape without creating duplicate binds.
    """
    desired = AUTOEXEC_CFG_CONTENT
    start = existing.find(AUTOEXEC_CFG_BLOCK_BEGIN)
    end = existing.find(AUTOEXEC_CFG_BLOCK_END)
    if start != -1 and end != -1 and start < end:
        end += len(AUTOEXEC_CFG_BLOCK_END)
        suffix = existing[end:]
        if suffix.startswith("\r\n"):
            suffix = suffix[2:]
        elif suffix.startswith("\n"):
            suffix = suffix[1:]
        return existing[:start] + desired + suffix

    if existing.strip() == AUTOEXEC_CFG_LEGACY_CONTENT.strip():
        return desired

    if not existing.strip():
        return desired

    return existing.rstrip() + "\n\n" + desired


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


def _load_dotenv_value(name: str) -> str | None:
    """Read a single var from `.env.local` files at known dev-repo locations.

    Used as a fallback when an env var isn't set in the shell — convenient
    when running the tracker from source. Returns None for shipped builds
    where these paths don't exist.
    """
    here = Path(__file__).resolve()
    candidates = [
        here.parent.parent.parent / "web" / ".env.local",
        here.parent.parent.parent / ".env.local",
        here.parent.parent / ".env.local",
    ]
    for path in candidates:
        if not path.exists():
            continue
        try:
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == name:
                    v = v.strip()
                    # Strip surrounding quotes if present.
                    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                        v = v[1:-1]
                    return v
        except OSError:
            continue
    return None
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
        # HWND is a 64-bit handle on x64 Windows; using POINTER(c_int) makes
        # ctypes pass the raw 8 bytes as a bytes object and int(hwnd) fails.
        WNDENUMPROC = ctypes.WINFUNCTYPE(
            ctypes.c_bool, wintypes.HWND, wintypes.LPARAM
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


# ── PostMessageW-based input to Dota (works without focus) ─────────────────────

WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_CHAR = 0x0102
VK_F20 = 0x83     # player_id_table (board/items/relics)
VK_F16 = 0x7F     # chess_pool_table
VK_F21 = 0x84     # dac_table (end_board)
VK_F22 = 0x85     # player_info_table (live state)
VK_F23 = 0x86     # game_info (round/death)
VK_F24 = 0x87     # ranking_top_table + player_id_table
VK_F25 = 0x88     # unit_table (board pieces — debug)


# ── SendInput-based key firing (replaces external AHK) ─────────────
# AHK's `Send` uses the Win32 SendInput API which produces input
# events indistinguishable from a real keyboard — Dota's input layer
# accepts these (PostMessage'd events don't reach the bind dispatcher).
# Replicating SendInput from Python via ctypes lets the backend fire
# the cascade itself, no external tool required.

_INPUT_KEYBOARD = 1
_KEYEVENTF_KEYUP = 0x0002


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class _HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class _INPUT_UNION(ctypes.Union):
    # Must include all three so sizeof(INPUT) matches Windows' expected
    # 40 bytes on x64 — SendInput returns ERROR_INVALID_PARAMETER (87)
    # if the cb size we pass doesn't match.
    _fields_ = [
        ("ki", _KEYBDINPUT),
        ("mi", _MOUSEINPUT),
        ("hi", _HARDWAREINPUT),
    ]


class _INPUT(ctypes.Structure):
    _fields_ = [
        ("type", wintypes.DWORD),
        ("u", _INPUT_UNION),
    ]


def _is_dota_foreground() -> bool:
    """Return True only when dota2.exe owns the foreground window.
    Gating key sends on this prevents the backend from spamming keys
    into other apps when the user alt-tabs out."""
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return False
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        # Read the foreground process's image name without psutil
        # to avoid a new dependency.
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.windll.kernel32
        h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not h:
            return False
        try:
            buf = ctypes.create_unicode_buffer(260)
            size = wintypes.DWORD(260)
            ok = kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size))
            if not ok:
                return False
            return buf.value.lower().endswith("\\dota2.exe")
        finally:
            kernel32.CloseHandle(h)
    except Exception:
        return False


# Remote kill switch for the core game-tracking feature. When False (driven by
# the `game-tracking-enabled` PostHog flag), every SendInput key-firing path
# no-ops, so the capture cascade and debug dumps stop poking Dota entirely.
# Telemetry stays on so the disabled state is still observable. Defaults True
# (fail-open: tracking runs unless explicitly switched off).
_key_firing_enabled = True


def set_key_firing_enabled(enabled: bool) -> None:
    """Module-wide gate for ALL SendInput output (the active tracking)."""
    global _key_firing_enabled
    _key_firing_enabled = bool(enabled)


def send_input_key(vk: int) -> bool:
    """Fire a single keydown/keyup for the given virtual-key code via
    SendInput. Returns True iff Dota is foreground AND the call sent
    both events successfully. Silent no-op if Dota isn't active or the
    remote game-tracking kill switch is off."""
    if not _key_firing_enabled:
        return False
    if not _is_dota_foreground():
        return False
    try:
        events = (_INPUT * 2)(
            _INPUT(type=_INPUT_KEYBOARD,
                   u=_INPUT_UNION(ki=_KEYBDINPUT(wVk=vk, wScan=0, dwFlags=0,
                                                  time=0, dwExtraInfo=None))),
            _INPUT(type=_INPUT_KEYBOARD,
                   u=_INPUT_UNION(ki=_KEYBDINPUT(wVk=vk, wScan=0, dwFlags=_KEYEVENTF_KEYUP,
                                                  time=0, dwExtraInfo=None))),
        )
        sent = ctypes.windll.user32.SendInput(2, ctypes.byref(events), ctypes.sizeof(_INPUT))
        return sent == 2
    except Exception as e:
        log.warning("send_input_key(0x%x) failed: %s", vk, e)
        return False
VK_RETURN = 0x0D
VK_OEM_5 = 0xDC  # "\" key — most users have this bound to toggleconsole

# Full command string for one capture. Kept here (not as a Source 2 alias)
# because custom-game addons reload their own keybinds/aliases on map load
# (ModDota Default_Keys), so anything we set via autoexec gets clobbered.
# Typing the commands directly into the console sidesteps that entirely.
DUMP_COMMAND = "exec dac_dump"


def _post_key(hwnd: int, vk: int) -> None:
    user32 = ctypes.windll.user32
    user32.PostMessageW(hwnd, WM_KEYDOWN, vk, 0)
    time.sleep(0.02)
    user32.PostMessageW(hwnd, WM_KEYUP, vk, 0xC0000001)


def send_console_command(cmd: str) -> bool:
    """Programmatically type a command into Dota's in-game console.

    Sequence: open console (`\\` toggleconsole bind) → WM_CHAR each
    character of cmd → Enter → close console. Each step is PostMessageW,
    fire-and-forget. Doesn't require Dota to have focus.

    Why this exists: Source 2 aliases/binds set via autoexec get
    overwritten when DAC's custom game loads (ModDota Default_Keys).
    Typing the dumpstringtable calls directly each time bypasses that
    layer — no persistent state to lose.
    """
    hwnd = find_dota_hwnd()
    if not hwnd:
        log.warning("send_console_command: Dota window not found")
        return False
    try:
        user32 = ctypes.windll.user32

        # Toggle console open.
        _post_key(hwnd, VK_OEM_5)
        time.sleep(0.15)  # give the console panel a beat to mount + focus

        # Type each character. WM_CHAR is the message the panorama text
        # input listens for; small inter-char delay avoids drops.
        for ch in cmd:
            user32.PostMessageW(hwnd, WM_CHAR, ord(ch), 0)
            time.sleep(0.003)

        # Submit + close.
        time.sleep(0.05)
        _post_key(hwnd, VK_RETURN)
        time.sleep(0.05)
        _post_key(hwnd, VK_OEM_5)

        log.info("send_console_command: posted %d chars to hwnd=%s", len(cmd), hwnd)
        return True
    except Exception as e:
        log.warning("send_console_command failed: %s", e)
        return False


def send_dump_key_to_dota() -> bool:
    """Compatibility wrapper — auto-trigger uses send_console_command now,
    but keep this around in case bind-based capture is needed for testing.
    PostMessage Pause down+up to the Dota window.
    """
    hwnd = find_dota_hwnd()
    if not hwnd:
        log.warning("send_dump_key_to_dota: Dota window not found")
        return False
    try:
        _post_key(hwnd, VK_F21)
        log.info("Sent F21 (dac_table dump) to Dota hwnd=%s", hwnd)
        return True
    except Exception as e:
        log.warning("send_dump_key_to_dota failed: %s", e)
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


def make_service_role_client():
    """Build an httpx.Client authed with the Supabase service-role key.

    Resolution order: SUPABASE_SERVICE_ROLE_KEY env var → .env.local in the
    dev repo → config.json supabase_key (publishable, won't pass writes
    that need service role). Returns None if url+key can't be resolved."""
    from utils import load_config
    cfg = load_config()
    url = cfg.get("supabase_url")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or _load_dotenv_value("SUPABASE_SERVICE_ROLE_KEY")
        or cfg.get("supabase_key")
    )
    if not url or not key:
        return None
    import httpx
    return httpx.Client(
        base_url=url.rstrip("/"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
        timeout=60,
    )


def upsert_match_timeline(client, payload: dict[str, Any]) -> bool:
    """UPSERT a single row into match_timelines. Returns True on success.

    ``payload`` is the local timeline JSON shape: keys match_id, played_at
    (unused server-side, just for log context), round_count, first_round,
    last_round, rounds. We map the file shape to the table row here.

    Multiple observers can track the same lobby. They should converge on the
    same deterministic match_id; when that happens, keep whichever observer has
    the richer timeline. For now "richer" means more distinct rounds captured.
    """
    match_id = payload.get("match_id")
    rounds = payload.get("rounds") or []
    if not match_id or not rounds:
        return False
    incoming_round_count = int(payload.get("round_count") or len(rounds))
    incoming_is_finished = bool(payload.get("is_finished")) or payload.get("verification_source") == "end_board"
    existing = client.get(
        "/rest/v1/match_timelines",
        params={
            "match_id": f"eq.{match_id}",
            "select": "match_id,round_count,timeline",
            "limit": "1",
        },
    )
    existing.raise_for_status()
    existing_rows = existing.json()
    if existing_rows:
        existing_round_count = int(existing_rows[0].get("round_count") or 0)
        existing_timeline = existing_rows[0].get("timeline") or {}
        existing_is_finished = (
            bool(existing_timeline.get("is_finished"))
            or existing_timeline.get("verification_source") == "end_board"
        )
        if existing_is_finished and not incoming_is_finished:
            log.info(
                "nettable: existing complete timeline kept — match_id=%s existing_rounds=%d incoming_rounds=%d",
                match_id, existing_round_count, incoming_round_count,
            )
            return False
        if existing_is_finished == incoming_is_finished and existing_round_count >= incoming_round_count:
            log.info(
                "nettable: existing timeline kept — match_id=%s existing_rounds=%d incoming_rounds=%d",
                match_id, existing_round_count, incoming_round_count,
            )
            return False

    row = {
        "match_id": match_id,
        "timeline": payload,
        "round_count": incoming_round_count,
        "first_round": int(payload.get("first_round") or rounds[0].get("round", 0)),
        "last_round": int(payload.get("last_round") or rounds[-1].get("round", 0)),
    }
    resp = client.post(
        "/rest/v1/match_timelines",
        headers={
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        content=json.dumps([row]),
    )
    resp.raise_for_status()
    return True


# ── Main capture class ──────────────────────────────────────────────────────

GAME_IN_PROGRESS_RE = "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"
POST_GAME_RE = "DOTA_GAMERULES_STATE_POST_GAME"
STRINGTABLE_MARKER = "[stringtables]"
PAUSE_FIRED_MARKER = "DAC_DUMP_FIRED"

# How often the backend fires F23 (game_info) for cheap round visibility.
# Mirrors the role AHK's PollRound timer used to play, now in-process.
POLL_INTERVAL_SEC = 2.0
# The backend polls game_info cheaply, then takes heavier player/board snapshots
# only when round_info changes. That lines snapshots up with the round view we
# actually show and avoids multiple equivalent mid-round dumps.
# Gap between individual keys in the cascade. dumpstringtable produces
# hundreds of console lines per call; firing too fast can drop output.
CASCADE_KEY_GAP_SEC = 0.2
# The keys a round snapshot fires, in order. F21 (dac_table) is intentionally
# excluded here and fired at POST_GAME only for end_board. F16 (chess_pool_table)
# fires once per session because its useful values are static enough that
# polling is noise. F24 (ranking_top_table + player_id_table) runs once per
# match/session opening.
ROUND_SNAPSHOT_VK_SEQUENCE = (VK_F22, VK_F20)

# Wait this long after POST_GAME before sending dump-key again. The `end_board`
# table is populated server-side at POST_GAME entry; small buffer for the
# broadcast to land at the client.
DUMP_POSTGAME_DELAY_SEC = 5.0

# A dump block is considered stable when no new [stringtables] lines arrive
# for this many seconds.
DUMP_STABILISE_SEC = 2.0

# After POST_GAME, fire PAUSE this many times spaced this many seconds apart.
# Riding out a brief alt-tab so end_board still lands.
POST_GAME_PAUSE_BURST_COUNT = 3
POST_GAME_PAUSE_BURST_GAP_SEC = 0.4

END_BOARD_FALLBACK_TIMEOUT_SEC = 45.0

# How often to poll the log file when no data is arriving.
POLL_IDLE_SEC = 0.5

# console.log counts as "active" if it was modified within this many seconds.
# Long enough to bridge the gaps between Dota's normal stdout flushes, short
# enough to detect "Dota is running but -condebug isn't on" reasonably fast.
LOG_ACTIVE_WINDOW_SEC = 30.0


class NetTableCapture:
    """Tail Dota's console.log, send dump-key mid- and post-game, ingest dumps."""

    def __init__(
        self,
        emit: Callable[[dict], None],
        steam_id: str | None = None,
        is_dac_active: Callable[[], bool] | None = None,
    ):
        self._emit = emit
        self._stop = threading.Event()
        # Gates the SendInput cascade and POST_GAME PAUSE burst to DAC custom
        # games only — firing PAUSE in regular Dota matches both opens the
        # menu and triggers `dumpstringtable` for tables that don't exist in
        # that game mode, which crashes the client at post-game. Default
        # `lambda: False` keeps us silent if the caller didn't wire a signal;
        # headless wires this to gsi.GSIServer.is_dac_active.
        self._is_dac_active: Callable[[], bool] = is_dac_active or (lambda: False)
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
        self._paused = False
        # Remote game-tracking kill switch (driven by the PostHog flag, applied
        # from headless). Separate from the user's manual `_paused`. Defaults
        # enabled (fail-open).
        self._remote_enabled = True

        # Tail state
        self._file = None  # type: ignore
        self._inode_size = 0  # last-seen size, used to detect truncation

        # Hashes of end_board payloads we've already saved, to dedup if
        # the user presses INS multiple times after game end.
        self._saved_end_board_hashes: set[str] = set()

        # Per-match personal-end snapshot tracking. POST_GAME only fires when
        # the WHOLE lobby finishes, so we'd otherwise miss the moment the
        # local player's own courier dies. Watch game_info.death_team[<own
        # team_id>] flip 0 → 1 and snapshot the player's slot state at that
        # instant.
        #   _prev_personal_death_team: last seen value (None = no signal yet)
        #   _personal_end_recorded: True once we've snapshotted this match
        # Both reset on the GAME_IN_PROGRESS transition.
        self._prev_personal_death_team: int | None = None
        self._personal_end_recorded: bool = False
        self._personal_end_snapshot: dict | None = None
        self._own_slot_key: str | None = None
        self._own_team_id: int | None = None
        self._last_own_player_payload: dict | None = None
        self._partial_match_saved: bool = False

        self._post_game_at: float | None = None
        self._end_board_captured: bool = False

        # Last seen round number from game_info → round_info → round.
        # Updated on every ingest; change → emit nettable_round_changed.
        # When round % 5 == 0, emit nettable_creep_round.
        self._last_round: int | None = None
        # Per-player chess_lineup snapshot for diff detection.
        # Keyed by steam_id, value is the comma-joined chess list.
        self._last_lineups: dict[str, str] = {}

        # Match session window — used to stitch dumps into a match
        # timeline. Set on GAME_IN_PROGRESS (start), reset after a
        # match's timeline is generated. Float epoch seconds.
        self._match_session_start: float | None = None
        self._match_roster_fingerprint: tuple[str, ...] | None = None

        # In-memory dump buffer used to build a curated per-round timeline.
        # Each entry is (epoch_seconds, {"captured_at": ..., "rows": [...]}).
        # Cleared when a match session closes. Raw captures can also be archived
        # locally (not uploaded) by _append_local_raw_dump.
        self._session_dumps: list[tuple[float, dict]] = []
        self._local_capture_dir: Path | None = None
        self._local_capture_started_at: str | None = None
        self._local_capture_cleaned = False

        # Dump block accumulator
        self._dump_active = False
        self._dump_last_line_ts = 0.0
        self._dump_seen_tables: set[str] = set()
        # Per-table wall-clock of the last dump line seen for it. Used by the
        # debug dump sequence to confirm each table actually produced data.
        self._dump_last_seen: dict[str, float] = {}
        # Per-table row count from the last dump header (e.g. "… unit_table  0").
        self._dump_last_rows: dict[str, int] = {}

        # Latest decoded per-(table, key) state. Updated after each ingest,
        # re-emitted on demand so the UI can render the live snapshot.
        self._last_state: dict[str, dict[str, Any]] = {}
        self._last_state_at: str | None = None
        # Latest extracted per-player live state (hp, level, transformed
        # lineup, etc.) — same shape the timeline uses. Powers the live
        # "your board" card so the UI doesn't re-parse raw chess_* codes.
        self._last_players: dict[str, dict] = {}
        # Steam IDs present in player_info_table.player_info.data — i.e. the
        # local player's own client rows. Lets the UI pick "you" out of the
        # extracted players without guessing.
        self._last_local_steam_ids: list[str] = []

        # Fired once per match/session opening. Dumps Queen ladder metadata,
        # current lobby slot mapping, and one chess_pool_table snapshot.
        self._lobby_metadata_fired = False
        self._last_player_id_dump_at = 0.0

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
            "launch_options=%r has_condebug=%s has_conclearlog=%s has_gamestateintegration=%s",
            self._steam_id,
            self._account_id,
            cfg_path,
            opts,
            ("-condebug" in (opts or "").split()) if opts is not None else None,
            ("-conclearlog" in (opts or "").split()) if opts is not None else None,
            ("-gamestateintegration" in (opts or "").split()) if opts is not None else None,
        )

        self.emit_status()
        self._last_status_signature = self._current_status_signature()

        # Warm-start from the most recent local dump so a restart mid-match
        # doesn't blank the live view for ~15s (the next cascade tick). Only
        # trusts dumps newer than WARM_START_MAX_AGE_SEC so we don't surface
        # stale match data on a cold open hours later.
        self._warm_start_state_from_disk()

        t = threading.Thread(target=self._run, daemon=True, name="nettable-tail")
        t.start()
        p = threading.Thread(target=self._run_status_poll, daemon=True, name="nettable-status-poll")
        p.start()
        k = threading.Thread(target=self._run_key_poller, daemon=True, name="nettable-key-poller")
        k.start()

    def _run_key_poller(self) -> None:
        """Fires F23 every 2s; heavier player/board snapshots are round-driven.

        The steady-state loop only runs while Dota is foreground and GSI says
        DAC is active. On startup, an immediate catch-up snapshot handles
        mid-game launches before the first GSI tick arrives.
        """
        # Catch-up: if Dota is already running, fire a live-state snapshot
        # immediately so the live view populates even when the app
        # starts mid-game (before GSI has confirmed DAC is active).
        if _is_dota_foreground():
            log.info("nettable: Dota is foreground at poller start — firing catch-up snapshot")
            self._fire_round_snapshot("poller start")
            self._fire_lobby_metadata_dump("poller start")
        while not self._stop.is_set():
            try:
                if _is_dota_foreground() and self._is_dac_active() and not self._paused:
                    if not self._lobby_metadata_fired:
                        self._fire_lobby_metadata_dump("DAC active")
                    # Cheap poll — just F23 (game_info → round_info/death_team).
                    # _detect_round_change() fires F22/F20 snapshots only when
                    # the round advances.
                    send_input_key(VK_F23)
            except Exception as e:
                log.warning("nettable: key poller iteration failed: %s", e)
            # Sleep till next poll tick.
            self._stop.wait(POLL_INTERVAL_SEC)

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
            # Gates the SendInput cascade — without -gamestateintegration the
            # GSI listener never receives payloads, is_dac_active() stays
            # False, and live capture silently doesn't fire.
            "has_gamestateintegration": (
                "-gamestateintegration" in opts_tokens
            ) if opts_tokens is not None else None,
            "steam_running": is_steam_running(),
            "paused": self._paused,
            "remote_enabled": self._remote_enabled,
        })

    def set_paused(self, paused: bool) -> None:
        self._paused = paused
        log.info("nettable: %s", "paused" if paused else "resumed")
        self.emit_status()

    def set_remote_enabled(self, enabled: bool) -> None:
        """Apply the remote game-tracking kill switch. When disabled, ALL
        SendInput key firing stops (module-wide gate) so the capture cascade and
        debug dumps go quiet across every path — independent of manual pause."""
        enabled = bool(enabled)
        if enabled == self._remote_enabled:
            return
        self._remote_enabled = enabled
        set_key_firing_enabled(enabled)
        log.info("nettable: game tracking %s by remote flag",
                 "ENABLED" if enabled else "DISABLED")
        self.emit_status()

    def _fire_lobby_metadata_dump(self, reason: str) -> None:
        send_input_key(VK_F24)
        time.sleep(CASCADE_KEY_GAP_SEC)
        send_input_key(VK_F16)
        self._lobby_metadata_fired = True
        self._last_player_id_dump_at = time.time()
        log.info("nettable: fired lobby metadata dump (F24 + F16) at %s", reason)

    def _fire_round_snapshot(self, reason: str) -> None:
        for vk in ROUND_SNAPSHOT_VK_SEQUENCE:
            if self._stop.is_set():
                return
            send_input_key(vk)
            time.sleep(CASCADE_KEY_GAP_SEC)
        self._last_player_id_dump_at = time.time()
        log.info("nettable: fired round snapshot (F22 + F20) at %s", reason)

    def _fire_player_id_dump(self, reason: str) -> None:
        send_input_key(VK_F20)
        self._last_player_id_dump_at = time.time()
        log.info("nettable: fired F20 (player_id_table) at %s", reason)

    def _reset_match_tracking(self) -> None:
        self._prev_personal_death_team = None
        self._personal_end_recorded = False
        self._personal_end_snapshot = None
        self._own_slot_key = None
        self._own_team_id = None
        self._last_own_player_payload = None
        self._partial_match_saved = False
        self._post_game_at = None
        self._end_board_captured = False
        self._lobby_metadata_fired = False
        self._last_player_id_dump_at = 0.0
        self._last_round = None
        self._last_lineups.clear()

    def _open_match_session(self, reason: str) -> None:
        self._match_session_start = time.time()
        self._match_roster_fingerprint = None
        self._session_dumps.clear()
        self._close_local_capture_session({"capture_status": "abandoned"})
        self._ensure_local_capture_session()
        self._reset_match_tracking()
        log.info("nettable: match session opened (%s)", reason)

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
            "players": self._last_players,
            "local_steam_ids": self._last_local_steam_ids,
            "at": self._last_state_at or "",
        })

    def _warm_start_state_from_disk(self) -> None:
        """No-op. Previously seeded _last_state from local dump files.
        Local dumps are no longer written — state is populated on the
        first ingest from the console.log tailer."""
        pass

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
        if self._personal_end_recorded:
            self._maybe_save_partial_match_from_latest_dump(
                capture_status="player_eliminated",
                verification_source="death_team",
                close_session=True,
            )
        elif not self._end_board_captured:
            self._close_local_capture_session({"capture_status": "abandoned"})
        self._stop.set()
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
        ok = True
        dst = find_autoexec_target(self._dota_dir)
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            existing = dst.read_text(encoding="utf-8") if dst.exists() else ""
            updated = _upsert_managed_autoexec_block(existing)
            if existing == updated:
                log.info("nettable: autoexec.cfg already current at %s", dst)
                return ok
            dst.write_text(updated, encoding="utf-8", newline="\n")
            log.info("nettable: updated DAC Tracker autoexec.cfg block at %s", dst)
        except Exception as e:
            log.warning("nettable: failed to install autoexec.cfg: %s", e)
            ok = False
        return ok

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
            self._check_end_board_fallback()
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
        self._dump_active = False
        self._dump_seen_tables = set()
        self._dump_last_line_ts = 0.0
        self._lobby_metadata_fired = False
        self._last_player_id_dump_at = 0.0

    # ── Local capture archive ───────────────────────────────────────────────

    def _local_capture_root(self) -> Path:
        from utils import DAC_DIR
        return DAC_DIR / "captures" / "sessions"

    def _cleanup_local_captures_once(self) -> None:
        if self._local_capture_cleaned:
            return
        self._local_capture_cleaned = True
        try:
            from utils import load_config
            cfg = load_config()
            retention_days = int(cfg.get("local_nettable_retention_days", 14) or 14)
            max_mb = int(cfg.get("local_nettable_max_mb", 500) or 500)
        except Exception:
            retention_days = 14
            max_mb = 500

        root = self._local_capture_root()
        if not root.exists():
            return
        now = time.time()
        cutoff = now - max(retention_days, 1) * 86400
        try:
            sessions = [p for p in root.iterdir() if p.is_dir()]
            for path in sessions:
                try:
                    if path.stat().st_mtime < cutoff:
                        shutil.rmtree(path, ignore_errors=True)
                except OSError:
                    continue

            sessions = [p for p in root.iterdir() if p.is_dir()]
            total_bytes = sum(
                f.stat().st_size
                for session in sessions
                for f in session.rglob("*")
                if f.is_file()
            )
            max_bytes = max_mb * 1024 * 1024
            if max_bytes <= 0:
                return
            for session in sorted(sessions, key=lambda p: p.stat().st_mtime):
                if total_bytes <= max_bytes:
                    break
                session_bytes = sum(f.stat().st_size for f in session.rglob("*") if f.is_file())
                shutil.rmtree(session, ignore_errors=True)
                total_bytes -= session_bytes
        except Exception as e:
            log.warning("nettable: local capture cleanup failed: %s", e)

    def _ensure_local_capture_session(self) -> Path | None:
        if not keep_local_nettable_dumps():
            return None
        if self._local_capture_dir is not None:
            return self._local_capture_dir
        try:
            self._cleanup_local_captures_once()
            root = self._local_capture_root()
            root.mkdir(parents=True, exist_ok=True)
            now = datetime.now().astimezone()
            self._local_capture_started_at = now.isoformat()
            stamp = now.strftime("%Y%m%d_%H%M%S")
            observer = str(self._steam_id or "anonymous")
            path = root / f"{stamp}_{observer}"
            suffix = 1
            while path.exists():
                suffix += 1
                path = root / f"{stamp}_{observer}_{suffix}"
            path.mkdir(parents=True, exist_ok=True)
            self._local_capture_dir = path
            self._write_local_manifest({
                "session_id": path.name,
                "started_at": self._local_capture_started_at,
                "observer_steam_id": self._steam_id,
                "raw_upload_enabled": upload_raw_nettable_dumps(),
            })
            log.info("nettable: local capture session opened at %s", path)
            return path
        except Exception as e:
            log.warning("nettable: failed to open local capture session: %s", e)
            return None

    def _write_local_manifest(self, updates: dict) -> None:
        path = self._local_capture_dir
        if path is None:
            return
        try:
            manifest_path = path / "manifest.json"
            current = {}
            if manifest_path.exists():
                current = json.loads(manifest_path.read_text(encoding="utf-8"))
            current.update({k: v for k, v in updates.items() if v is not None})
            manifest_path.write_text(
                json.dumps(current, ensure_ascii=False, indent=2, sort_keys=True),
                encoding="utf-8",
            )
        except Exception as e:
            log.warning("nettable: failed to write local capture manifest: %s", e)

    def _append_local_raw_dump(self, dump_doc: dict) -> None:
        path = self._ensure_local_capture_session()
        if path is None:
            return
        try:
            with gzip.open(path / "raw_dumps.jsonl.gz", "at", encoding="utf-8") as fh:
                fh.write(json.dumps(dump_doc, ensure_ascii=False, separators=(",", ":")))
                fh.write("\n")
        except Exception as e:
            log.warning("nettable: failed to append local raw dump: %s", e)

    def _write_local_processed_json(self, name: str, payload: dict) -> None:
        path = self._local_capture_dir
        if path is None:
            return
        try:
            (path / name).write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
                encoding="utf-8",
            )
        except Exception as e:
            log.warning("nettable: failed to write local %s: %s", name, e)

    def _close_local_capture_session(self, updates: dict | None = None) -> None:
        if self._local_capture_dir is None:
            return
        final_updates = {"ended_at": datetime.now().astimezone().isoformat()}
        if updates:
            final_updates.update(updates)
        self._write_local_manifest(final_updates)
        self._local_capture_dir = None
        self._local_capture_started_at = None

    # ── Line handlers ──────────────────────────────────────────────────────

    def _handle_line(self, line: str) -> None:
        # PAUSE_FIRED_MARKER: legacy echo marker. Echo no longer writes
        # to console.log on this Dota build, so this branch is effectively
        # never taken — but we keep it as a free signal in case Valve
        # restores echo logging.
        if line.rstrip().endswith(PAUSE_FIRED_MARKER):
            log.info("nettable: dac_dump fired in Dota")
            self._emit({"type": "nettable_pause_fired", "at": datetime.now().isoformat()})
            return

        # Match start — opens the session window so dumps captured
        # between now and POST_GAME / end_board belong to this match.
        if GAME_IN_PROGRESS_RE in line:
            if self._match_session_start is None:
                self._open_match_session("GAME_IN_PROGRESS")
                self._fire_lobby_metadata_dump("match start")
            else:
                # A reconnect can re-emit GAME_IN_PROGRESS for the same lobby.
                # Do not close the existing session here; wait for the next
                # player_info_table roster and compare Steam IDs exactly.
                log.info("nettable: GAME_IN_PROGRESS while session open — waiting for roster comparison")

        # Game state — POST_GAME tells us a match ended. Fire PAUSE
        # immediately via SendInput so dac_table.end_board is captured
        # NOW — waiting for the next 15s cascade tick loses the dump
        # if the user alt-tabs (SendInput only delivers while Dota is
        # foreground).
        if POST_GAME_RE in line:
            now = time.time()
            last = getattr(self, "_last_post_game_emit", 0.0)
            if now - last > 10.0:  # debounce: POST_GAME can re-emit
                self._last_post_game_emit = now
                # POST_GAME fires for every Dota match mode, not just DAC.
                # Without this gate the PAUSE burst below crashes the Dota
                # client at the end of regular Dota matches (confirmed by
                # crash dumps in Steam/dumps/, May 20-21 2026).
                if not self._is_dac_active():
                    log.info("nettable: POST_GAME detected in non-DAC match — skipping PAUSE burst")
                    return
                log.info("nettable: POST_GAME detected — match ended, firing PAUSE")
                self._emit({
                    "type": "nettable_game_ended",
                    "message": "Match ended — capturing end_board.",
                    "at": datetime.now().isoformat(),
                })
                threading.Thread(
                    target=self._fire_post_game_pause_burst,
                    daemon=True,
                    name="nettable-postgame-pause",
                ).start()
                self._post_game_at = time.time()
                self._end_board_captured = False

        if STRINGTABLE_MARKER in line:
            self._note_dump_line(line)

    def _fire_post_game_pause_burst(self) -> None:
        """Fire PAUSE several times spaced ~400ms apart immediately after
        POST_GAME. Rides out a brief alt-tab so end_board still lands —
        the 15s cascade alone misses it when the user clicks away."""
        for i in range(POST_GAME_PAUSE_BURST_COUNT):
            if self._stop.is_set():
                return
            send_input_key(VK_F21)
            log.info("nettable: post-game F21 (dac_table) fire %d/%d", i + 1, POST_GAME_PAUSE_BURST_COUNT)
            if i == 0:
                self._stop.wait(CASCADE_KEY_GAP_SEC)
                if self._stop.is_set():
                    return
                self._fire_player_id_dump("post-game board/items snapshot")
            self._stop.wait(POST_GAME_PAUSE_BURST_GAP_SEC)

    def _check_end_board_fallback(self) -> None:
        if self._post_game_at is None:
            return
        if self._end_board_captured:
            return
        if time.time() - self._post_game_at < END_BOARD_FALLBACK_TIMEOUT_SEC:
            return

        log.warning(
            "nettable: end_board not captured %.0fs after POST_GAME — building match from last dump",
            time.time() - self._post_game_at,
        )
        self._end_board_captured = True
        self._post_game_at = None

        threading.Thread(
            target=self._build_match_from_dump,
            daemon=True,
            name="nettable-fallback-match",
        ).start()

    def _latest_dump_rows(self) -> list[dict]:
        if self._session_dumps:
            _ts, doc = self._session_dumps[-1]
            rows = doc.get("rows") or []
            if isinstance(rows, list):
                return rows
        return []

    def _pseudo_end_board_from_rows(self, rows: list[dict]) -> dict | None:
        """Build an end_board-like payload from the latest live dump rows."""
        if not rows:
            return None

        pit_data: dict[str, dict] = {}
        for r in rows:
            if r.get("table_name", "").endswith("player_info_table") \
                    and r.get("key") == "player_info":
                raw = r.get("raw")
                if isinstance(raw, dict):
                    d = raw.get("data")
                    if isinstance(d, dict):
                        for sid, p in d.items():
                            if isinstance(p, dict):
                                pit_data[str(sid)] = dict(p)
                break

        dac_info: dict[str, dict] = {}
        for r in rows:
            if r.get("table_name", "").endswith("dac_table") \
                    and r.get("key") == "player_info":
                raw = r.get("raw")
                if isinstance(raw, dict):
                    info = raw.get("info")
                    if isinstance(info, dict):
                        for sid, p in info.items():
                            if isinstance(p, dict):
                                dac_info[str(sid)] = dict(p)
                break

        all_sids = set(pit_data.keys()) | set(dac_info.keys())
        if not all_sids:
            return None

        merged: dict[str, dict] = {}
        for sid in all_sids:
            base = dac_info.get(sid, {})
            overlay = pit_data.get(sid, {})
            combined = {**base, **overlay}
            if "hp" in base and base["hp"] not in (None, 100):
                combined["hp"] = base["hp"]
            if "curr_rank" in base and base.get("curr_rank"):
                combined["curr_rank"] = base["curr_rank"]
            merged[sid] = combined
        return {"data": merged}

    def _generate_partial_match_id(self, pseudo_end_board: dict) -> str:
        data = pseudo_end_board.get("data") if isinstance(pseudo_end_board, dict) else None
        pairs: list[tuple[str, int]] = []
        if isinstance(data, dict):
            for sid, p in data.items():
                if not isinstance(p, dict):
                    continue
                rank = p.get("curr_rank") or p.get("rank") or 0
                try:
                    rank_i = int(rank)
                except (TypeError, ValueError):
                    rank_i = 0
                pairs.append((str(sid), rank_i))
        pairs.sort()
        seed = {
            "kind": "partial",
            "observer_steam_id": self._steam_id,
            "match_session_start": self._match_session_start,
            "personal_end": self._personal_end_snapshot,
            "players": pairs,
        }
        return hashlib.sha256(
            json.dumps(seed, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        ).hexdigest()[:16]

    def _maybe_save_partial_match_from_latest_dump(
        self,
        *,
        capture_status: str,
        verification_source: str,
        close_session: bool,
    ) -> None:
        """Persist a useful unfinished match when the final end_board is absent."""
        if self._partial_match_saved or self._end_board_captured:
            return
        if capture_status == "player_eliminated" and not self._personal_end_recorded:
            return

        rows = self._latest_dump_rows()
        pseudo_end_board = self._pseudo_end_board_from_rows(rows)
        if pseudo_end_board is None:
            if close_session:
                self._close_local_capture_session({"capture_status": capture_status})
            return

        played_at = datetime.now().astimezone().isoformat()
        match_id = self._generate_partial_match_id(pseudo_end_board)
        extracted = self._extract_structured_match(
            pseudo_end_board,
            played_at,
            match_id,
            capture_status=capture_status,
            is_finished=False,
            verification_source=verification_source,
        )
        if extracted is None:
            return

        match_record, player_rows = extracted
        if self._personal_end_snapshot:
            match_record["personal_end_snapshot"] = self._personal_end_snapshot
        self._write_local_processed_json("processed_match.json", {
            "match": match_record,
            "players": player_rows,
        })
        self._upload_match_to_supabase(match_record, player_rows)
        self._partial_match_saved = True
        log.info(
            "nettable: partial match saved — match_id=%s status=%s players=%d",
            match_id, capture_status, len(player_rows),
        )
        if close_session:
            self._close_local_capture_session({
                "match_id": match_id,
                "capture_status": capture_status,
                "is_finished": False,
                "verification_source": verification_source,
            })
        self._emit({
            "type": "nettable_partial_match_saved",
            "match_id": match_id,
            "capture_status": capture_status,
            "verification_source": verification_source,
            "at": played_at,
        })

    def _build_match_from_dump(self) -> None:
        """Fallback: reconstruct a match from the most recent in-memory dump
        when end_board wasn't captured in time."""
        try:
            if not self._session_dumps:
                log.warning("nettable: fallback — no in-memory dumps")
                return

            # Use the most recent dump.
            _ts, doc = self._session_dumps[-1]
            rows = doc.get("rows") or []
            if not rows:
                log.warning("nettable: fallback — latest dump has no rows")
                return

            pit_data: dict[str, dict] = {}
            for r in rows:
                if r.get("table_name", "").endswith("player_info_table") \
                        and r.get("key") == "player_info":
                    raw = r.get("raw")
                    if isinstance(raw, dict):
                        d = raw.get("data")
                        if isinstance(d, dict):
                            for sid, p in d.items():
                                if isinstance(p, dict):
                                    pit_data[str(sid)] = dict(p)
                    break

            dac_info: dict[str, dict] = {}
            for r in rows:
                if r.get("table_name", "").endswith("dac_table") \
                        and r.get("key") == "player_info":
                    raw = r.get("raw")
                    if isinstance(raw, dict):
                        info = raw.get("info")
                        if isinstance(info, dict):
                            for sid, p in info.items():
                                if isinstance(p, dict):
                                    dac_info[str(sid)] = dict(p)
                    break

            all_sids = set(pit_data.keys()) | set(dac_info.keys())
            if not all_sids:
                log.warning("nettable: fallback — no player data in latest dump")
                return

            merged: dict[str, dict] = {}
            for sid in all_sids:
                base = dac_info.get(sid, {})
                overlay = pit_data.get(sid, {})
                combined = {**base, **overlay}
                if "hp" in base and base["hp"] not in (None, 100):
                    combined["hp"] = base["hp"]
                if "curr_rank" in base and base.get("curr_rank"):
                    combined["curr_rank"] = base["curr_rank"]
                merged[sid] = combined

            pseudo_end_board = {"data": merged}

            from db import generate_live_match_id
            match_id = generate_live_match_id(pseudo_end_board)

            if match_id in {h[:16] for h in self._saved_end_board_hashes}:
                log.info("nettable: fallback — match %s already saved", match_id)
                return

            # tz-aware: include the local UTC offset so the timestamptz column
            # stores the correct instant rather than treating local time as UTC.
            played_at = datetime.now().astimezone().isoformat()
            extracted = self._extract_structured_match(
                pseudo_end_board,
                played_at,
                match_id,
                capture_status="timeout",
                is_finished=False,
                verification_source="last_dump_timeout",
            )

            if extracted is not None:
                match_record, player_rows = extracted
                self._upload_match_to_supabase(match_record, player_rows)
                log.info(
                    "nettable: fallback match saved — match_id=%s players=%d",
                    match_id, len(player_rows),
                )
            else:
                log.warning("nettable: fallback — _extract_structured_match returned None")
                return

            self._partial_match_saved = True
            self._close_local_capture_session({
                "match_id": match_id,
                "capture_status": "timeout",
                "is_finished": False,
                "verification_source": "last_dump_timeout",
            })
            self._emit({
                "type": "nettable_end_board_saved",
                "at": played_at,
                "fallback": True,
            })
            self._emit({
                "type": "nettable_notification",
                "message": "Match saved (fallback)",
                "detail": "end_board was not captured — match reconstructed from last dump data.",
                "at": played_at,
            })
        except Exception as e:
            log.warning("nettable: fallback match build failed: %s", e, exc_info=True)

    def _note_dump_line(self, line: str) -> None:
        idx = line.find("table ")
        if idx != -1:
            after = line[idx + len("table "):].split()
            if after and after[0].startswith(CUSTOM_NETTABLE_PREFIX):
                self._dump_seen_tables.add(after[0])
                self._dump_last_seen[after[0]] = time.time()
                # Trailing integer on the header is the row count.
                if len(after) > 1 and after[1].isdigit():
                    self._dump_last_rows[after[0]] = int(after[1])

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

    def _detect_round_change(self, rows: list[dict]) -> None:
        """If game_info.round_info.round has changed since last ingest,
        emit nettable_round_changed (and nettable_creep_round at every
        5th round)."""
        round_now = None
        for r in rows:
            if r.get("table_name", "").endswith("game_info") and r.get("key") == "round_info":
                raw = r.get("raw")
                if isinstance(raw, dict):
                    round_now = raw.get("round")
                break
        if round_now is None:
            return
        try:
            round_now = int(round_now)
        except (TypeError, ValueError):
            return
        if round_now == self._last_round:
            return
        prev = self._last_round
        self._last_round = round_now
        log.info("nettable: round changed %s -> %s", prev, round_now)
        self._emit({
            "type": "nettable_round_changed",
            "round": round_now,
            "prev_round": prev,
            "at": datetime.now().isoformat(),
        })
        if round_now > 0 and _is_dota_foreground() and self._is_dac_active() and not self._paused:
            self._fire_round_snapshot(f"round changed {prev} -> {round_now}")
        # Creep rounds in DAC fire every 5 rounds (5, 10, 15, ...).
        # Worth flagging so consumers can fire a heavier snapshot.
        if round_now > 0 and round_now % 5 == 0:
            log.info("nettable: creep round %d", round_now)
            self._emit({
                "type": "nettable_creep_round",
                "round": round_now,
                "at": datetime.now().isoformat(),
            })

    def _detect_lineup_change(self, rows: list[dict]) -> None:
        """Diff per-player chess_lineup against last snapshot. Emit
        nettable_lineup_changed for each player whose lineup changed
        (units added, removed, or reordered)."""
        # Locate player_info_table.player_info → data → {steam_id: {chess_lineup}}.
        # Older captures also had dac_table.player_info, so keep accepting it.
        for r in rows:
            table_name = r.get("table_name", "")
            if not ((table_name.endswith("player_info_table") or table_name.endswith("dac_table"))
                    and r.get("key") == "player_info"):
                continue
            raw = r.get("raw")
            if not isinstance(raw, dict):
                continue
            info = raw.get("info") or raw.get("data") or {}
            if not isinstance(info, dict):
                continue
            for steam_id, p in info.items():
                if not isinstance(p, dict):
                    continue
                lineup = p.get("chess_lineup")
                if not isinstance(lineup, str):
                    continue
                prev = self._last_lineups.get(str(steam_id))
                if prev == lineup:
                    continue
                self._last_lineups[str(steam_id)] = lineup
                if prev is None:
                    # First time we've seen this player — not a "change".
                    continue
                prev_units = set(u for u in prev.split(",") if u)
                new_units = set(u for u in lineup.split(",") if u)
                added = sorted(new_units - prev_units)
                removed = sorted(prev_units - new_units)
                log.info(
                    "nettable: lineup changed for %s: +%s -%s",
                    steam_id, added or "-", removed or "-",
                )
                self._emit({
                    "type": "nettable_lineup_changed",
                    "steam_id": str(steam_id),
                    "added": added,
                    "removed": removed,
                    "lineup": lineup,
                    "at": datetime.now().isoformat(),
                })
            break

    @staticmethod
    def _first_present_int(source: dict, keys: tuple[str, ...], *, lo: int | None = None) -> int | None:
        for key in keys:
            val = source.get(key)
            if val in (None, ""):
                continue
            try:
                n = int(str(val).strip())
            except (TypeError, ValueError):
                continue
            if lo is not None and n < lo:
                continue
            return n
        return None

    @staticmethod
    def _first_present_str(source: dict, keys: tuple[str, ...]) -> str | None:
        for key in keys:
            val = source.get(key)
            if val in (None, ""):
                continue
            text = str(val).strip()
            if text:
                return text
        return None

    @classmethod
    def _extract_ranking_top_players(cls, raw: dict, scanned_at: str) -> list[dict]:
        """Return normalized Queen-ladder rows from ranking_top_table.

        Drodo has changed the exact field names in this CustomNetTable over
        time, so this accepts a small set of observed/likely aliases instead
        of depending on one brittle shape.
        """
        top = raw.get("ranking_top") or {}
        if not isinstance(top, dict):
            return []
        season = cls._first_present_str(raw, ("season", "current_season", "season_id"))
        players: list[dict] = []
        for fallback_rank, entry in enumerate(top.values(), start=1):
            if not isinstance(entry, dict):
                continue
            steam_id = cls._first_present_str(entry, (
                "steam_id", "steamid", "player", "player_id", "uid", "id",
            ))
            if not steam_id or not steam_id.startswith("7656"):
                continue
            players.append({
                "steam_id": steam_id,
                "name": cls._first_present_str(entry, (
                    "name", "player_name", "nick_name", "nickname", "user_name",
                )),
                "rank": cls._first_present_int(entry, (
                    "rank", "ranking", "queen_rank", "ladder_rank", "index", "place",
                ), lo=1) or fallback_rank,
                "mmr": cls._first_present_int(entry, (
                    "mmr", "score", "rank_score", "season_mmr", "points",
                ), lo=0),
                "season": season,
                "seen_at": scanned_at,
            })
        return players

    def _maybe_extract_ranking_top(self, rows: list[dict]) -> None:
        """Find ranking_top_table.ranking_top and upsert discovered Queen players."""
        for r in rows:
            if not (r.get("table_name", "").endswith("ranking_top_table")
                    and r.get("key") == "ranking_top"):
                continue
            raw = r.get("raw")
            if not isinstance(raw, dict):
                continue
            scanned_at = datetime.now().astimezone().isoformat()
            players = self._extract_ranking_top_players(raw, scanned_at)
            player_count = len(players)
            if player_count > 0:
                pushed = 0
                try:
                    from db import upsert_queen_ladder_players
                    pushed = upsert_queen_ladder_players(players)
                except Exception as e:
                    log.warning("nettable: queen ladder upsert failed: %s", e)
                season = players[0].get("season") or ""
                log.info(
                    "nettable: ranking_top scan found %d player(s), upserted %d",
                    player_count, pushed,
                )
                self._emit({
                    "type": "nettable_ranking_scanned",
                    "player_count": player_count,
                    "upserted_count": pushed,
                    "season": season,
                    "at": scanned_at,
                })
            break

    def _maybe_save_end_board(self, rows: list[dict]) -> None:
        """If the dump contains dac_table.end_board, trigger structured
        extraction and upload to Supabase. Dedupes on payload hash."""
        end_board = None
        for r in rows:
            if r.get("table_name") in ("CustomNetTable_dac_table", "dac_table") \
                    and r.get("key") == "end_board":
                end_board = r.get("raw")
                break
        if end_board is None:
            return
        try:
            # tz-aware: include the local UTC offset so the timestamptz column
            # stores the correct instant rather than treating local time as UTC.
            saved_at = datetime.now().astimezone().isoformat()
            # Hash only the GAMEPLAY-relevant fields, not the wrapper or
            # the `hehe` randomization field that DAC sprinkles into
            # every nettable payload. Otherwise each PAUSE press
            # generates a new "unique" end_board and we extract the
            # same match over and over.
            stable = self._stable_end_board_payload(end_board)
            payload_hash = hashlib.sha256(
                json.dumps(stable, sort_keys=True, ensure_ascii=False).encode("utf-8")
            ).hexdigest()
            if payload_hash in self._saved_end_board_hashes:
                log.info("nettable: end_board already saved this session — skipping duplicate")
                self._end_board_captured = True
                self._post_game_at = None
                return
            self._saved_end_board_hashes.add(payload_hash)
            self._end_board_captured = True
            self._post_game_at = None

            # Deterministic match_id from end_board contents — two installs
            # in the same lobby produce the same id, so cross-observer dedup
            # works without any coordination.
            from db import generate_live_match_id
            match_id = generate_live_match_id(end_board)

            # Drive the transform: match header, per-player rows, player profiles.
            extracted = self._extract_structured_match(end_board, saved_at, match_id)

            # Upload to Supabase if extraction produced rows.
            if extracted is not None:
                match_record, player_rows = extracted
                self._upload_match_to_supabase(match_record, player_rows)

            self._partial_match_saved = True
            self._close_local_capture_session({
                "match_id": match_id,
                "capture_status": "complete",
                "is_finished": True,
                "verification_source": "end_board",
            })
            self._emit({
                "type": "nettable_end_board_saved",
                "at": saved_at,
            })
        except Exception as e:
            log.warning("nettable: failed to save end_board: %s", e)

    def _maybe_save_personal_end_board(self, rows: list[dict]) -> None:
        """Detect the moment the local player's courier dies and emit an event.

        POST_GAME only fires when the whole lobby finishes, so the
        existing end_board path misses the "I'm out but the rest are still
        playing" window — which is most of every match from the local
        player's POV. Watches `game_info.death_team[<own team_id>]` flip
        0 → 1.

        Idempotent per match: `_personal_end_recorded` blocks re-fires
        until GAME_IN_PROGRESS resets it.
        """
        if self._personal_end_recorded:
            return
        if not self._steam_id:
            return  # no logged-in player → can't identify own slot

        # 1. Pull the live per-slot table when present. F23-only polls do not
        #    include player_info_table, so cache the local player's team/payload
        #    from the last round snapshot and still allow death_team to detect
        #    elimination between heavy captures.
        live_data: dict | None = None
        for r in rows:
            if r.get("table_name", "").endswith("player_info_table") \
                    and r.get("key") == "player_info":
                raw = r.get("raw")
                if isinstance(raw, dict):
                    d = raw.get("data")
                    if isinstance(d, dict) and d:
                        live_data = d
                break

        # 2. Find our slot by steam_id match. team_id lives on the slot row.
        own_slot_key: str | None = None
        own_slot_payload: dict | None = None
        own_team_id: int | None = None
        if live_data is not None:
            for slot_key, slot_payload in live_data.items():
                if not isinstance(slot_payload, dict):
                    continue
                if str(slot_payload.get("steam_id")) == str(self._steam_id):
                    own_slot_key = str(slot_key)
                    own_slot_payload = slot_payload
                    tid = slot_payload.get("team_id")
                    try:
                        own_team_id = int(tid) if tid is not None else None
                    except (TypeError, ValueError):
                        own_team_id = None
                    break
            if own_slot_payload is not None:
                self._own_slot_key = own_slot_key
                self._last_own_player_payload = dict(own_slot_payload)
            if own_team_id is not None:
                self._own_team_id = own_team_id

        if own_slot_key is None:
            own_slot_key = self._own_slot_key
        if own_slot_payload is None:
            own_slot_payload = self._last_own_player_payload
        if own_team_id is None:
            own_team_id = self._own_team_id
        if own_slot_payload is None or own_team_id is None:
            return  # not in this lobby (yet?)

        # 3. Read game_info.death_team for our team's elimination bit.
        death_team: dict | None = None
        for r in rows:
            if r.get("table_name", "").endswith("game_info") \
                    and r.get("key") == "death_team":
                raw = r.get("raw")
                if isinstance(raw, dict):
                    death_team = raw
                break
        if death_team is None:
            return

        current_raw = death_team.get(str(own_team_id))
        try:
            current = int(current_raw) if current_raw is not None else 0
        except (TypeError, ValueError):
            current = 0

        prev = self._prev_personal_death_team
        self._prev_personal_death_team = current

        if current != 1:
            return  # still alive (or unknown)

        # current == 1 — capture. If prev was None (first dump after app
        # start), we missed the actual moment; flag late_capture so the
        # consumer knows. Otherwise prev == 0 → real 0 → 1 transition.
        late_capture = prev is None

        try:
            saved_at = datetime.now().isoformat()
            round_at_death = own_slot_payload.get("round")
            rank_at_death = (own_slot_payload.get("rank")
                             or own_slot_payload.get("curr_rank"))
            self._personal_end_recorded = True
            self._personal_end_snapshot = {
                "at": saved_at,
                "round": round_at_death,
                "rank": rank_at_death,
                "late_capture": late_capture,
                "slot_key": own_slot_key,
                "team_id": own_team_id,
                "player": dict(own_slot_payload),
            }
            log.info(
                "nettable: personal end_board snapshotted (slot=%s team=%s round=%s rank=%s late=%s)",
                own_slot_key, own_team_id,
                round_at_death, rank_at_death, late_capture,
            )
            self._emit({
                "type": "nettable_personal_game_ended",
                "at": saved_at,
                "round": round_at_death,
                "rank": rank_at_death,
                "late_capture": late_capture,
            })
        except Exception as e:
            log.warning("nettable: failed to process personal end_board: %s", e)

    def _extract_structured_match(
        self,
        end_board: dict,
        played_at: str,
        match_id: str,
        capture_status: str = "complete",
        is_finished: bool = True,
        verification_source: str = "end_board",
    ) -> tuple[dict, list[dict]] | None:
        """Transform raw end_board into a match record and per-player rows
        suitable for Supabase upload.

        match_id is computed by the caller (deterministic per end_board) so
        two installs in the same lobby agree without coordination.

        Returns (match_record, player_rows) — the caller uploads the bundle
        to Supabase. Returns None when end_board.data is missing/empty."""
        data = end_board.get("data") if isinstance(end_board, dict) else None
        if not isinstance(data, dict) or not data:
            return None

        match_players: list[dict] = []
        all_player_rows: list[dict] = []
        match_duration: float | None = None
        match_final_round: int | None = None

        for steam_id, p in data.items():
            if not isinstance(p, dict):
                continue
            sid = str(steam_id)

            placement = _safe_int(p.get("curr_rank") or p.get("rank"))
            mmr_level = _safe_int(p.get("mmr_level"))

            # Transformed match_player record — only gameplay-relevant fields.
            # chess_lineup / chess_hand / max_lineup_value_lineup / mvp_chess
            # are translated from raw 'chess_br11' codes to 'Broodmother(3)'
            # so the History tab's parser can resolve them in unitsFull.
            mvp_raw = p.get("mvp_chess_name", "") or ""
            mvp_translated, mvp_stars = (
                _resolve_chess_piece(mvp_raw, _load_chess_id_map()) if mvp_raw else ("", 0)
            )
            mvp_display = (f"{mvp_translated}({mvp_stars})" if mvp_stars > 1 else mvp_translated) if mvp_translated else mvp_raw
            row = {
                "match_id": match_id,
                "played_at": played_at,
                "steam_id": sid,
                "placement": placement,
                "mmr_level": mmr_level,
                "hero_level": _safe_int(p.get("hero_level")),
                "chess_lineup": _transform_chess_lineup(p.get("chess_lineup")),
                "chess_hand": _transform_chess_lineup(p.get("chess_hand")),
                # `show_buff` can be stale/repeated across end-board players.
                # `buff` is the per-player full count list; filter it through
                # the synergy tier metadata so inactive one-offs are omitted.
                "synergies": _transform_synergies(p.get("buff") or p.get("show_buff"), active_only=True),
                "relic": _transform_relic(p.get("relic", "") or ""),
                "relic_history": p.get("relic_history") or {},
                "talents": self._format_talents(p.get("talent_tree")),
                "win_round": _safe_int(p.get("win_round")) or 0,
                "lose_round": _safe_int(p.get("lose_round")) or 0,
                "draw_round": _safe_int(p.get("draw_round")) or 0,
                "kills": _safe_int(p.get("kills")) or 0,
                "deaths": _safe_int(p.get("deaths")) or 0,
                "hero_damage": _safe_int(p.get("hero_damage")) or 0,
                "hero_damaged": _safe_int(p.get("hero_damaged")) or 0,
                "mvp_chess_name": mvp_display,
                "mvp_chess_items": _pipe(p.get("mvp_chess_items")),
                "max_lineup_value": _safe_int(p.get("max_lineup_value")) or 0,
                "max_lineup_value_lineup": _transform_chess_lineup(p.get("max_lineup_value_lineup")),
                "duration": p.get("duration") or 0,
                "final_round": _safe_int(p.get("round")) or 0,
                "zhugong": p.get("zhugong", "") or "",
                "total_money": _safe_int(p.get("total_money")) or 0,
                "candy": _safe_int(p.get("candy")) or 0,
            }
            all_player_rows.append(row)

            # Match-level player summary line — small, for fast match-list views.
            match_players.append({
                "steam_id": sid,
                "placement": placement,
                "mmr_level": mmr_level,
            })

            # Match-wide stats — pull from any player (they all share these).
            if match_duration is None and row["duration"]:
                match_duration = row["duration"]
            if match_final_round is None and row["final_round"]:
                match_final_round = row["final_round"]

        # Match header
        match_record = {
            "match_id": match_id,
            "played_at": played_at,
            "duration": match_duration or 0,
            "final_round": match_final_round or 0,
            "player_count": len(match_players),
            "players": sorted(match_players, key=lambda x: (x["placement"] or 99)),
            "capture_status": capture_status,
            "is_finished": is_finished,
            "verification_source": verification_source,
            "verified_at": played_at if capture_status == "complete" else None,
            "capture_started_at": self._local_capture_started_at,
            "capture_ended_at": played_at,
            "observer_steam_id": self._steam_id,
        }
        log.info(
            "nettable: structured match extracted — match_id=%s players=%d duration=%.0fs final_round=%d",
            match_id, len(match_players), match_duration or 0, match_final_round or 0,
        )
        self._emit({
            "type": "nettable_match_extracted",
            "match_id": match_id,
            "player_count": len(match_players),
            "at": played_at,
        })

        self._write_local_processed_json("processed_match.json", {
            "match": match_record,
            "players": all_player_rows,
        })

        # Round-by-round timeline — stitch in-memory dumps into an
        # ordered action log so the UI can replay the match.
        try:
            self._extract_match_timeline(match_id, played_at)
        except Exception as e:
            log.warning("nettable: failed to build match timeline: %s", e)

        # Close the session window so the NEXT match starts clean.
        self._match_session_start = None
        self._session_dumps.clear()

        return match_record, all_player_rows

    def _upload_match_to_supabase(
        self, match_record: dict, player_rows: list[dict],
    ) -> None:
        """Fan out the match to Supabase: ensure_user for every player (FK),
        push the match header, bulk-push match_players. Each step swallows
        its own failures — partial success is preferred to total loss."""
        from db import ensure_user, push_match, push_match_players
        match_id = match_record.get("match_id") or ""

        # Step 1 — satisfy match_players.steam_id FK to users.
        for r in player_rows:
            sid = str(r.get("steam_id") or "").strip()
            if sid:
                try:
                    ensure_user(sid)
                except Exception as e:
                    log.warning("nettable: ensure_user(%s) failed: %s", sid, e)

        # Step 2 — match header.
        try:
            push_match(match_record)
        except Exception as e:
            log.warning("nettable: push_match failed: %s", e)

        # Step 3 — rich per-player rows (bulk).
        try:
            push_match_players(match_id, player_rows)
        except Exception as e:
            log.warning("nettable: push_match_players failed: %s", e)

    def _extract_match_timeline(self, match_id: str, played_at: str) -> dict | None:
        """Walk in-memory dumps that belong to the just-ended match, pull
        per-round per-player state, and upload the timeline to Supabase.

        Match-window detection (in priority order):
          1. If GAME_IN_PROGRESS fired this session (_match_session_start
             is set), use that as the lower bound.
          2. Otherwise, walk dumps backwards from now; collect them
             until the round number STOPS being monotonically
             non-decreasing (i.e. the previous match begins). That
             gives us this match's dumps even if backend missed the
             session start."""
        all_dumps = sorted(self._session_dumps)
        if not all_dumps:
            log.info("nettable: no dumps to build timeline from")
            return None

        session_start = self._match_session_start
        if session_start is not None:
            in_session = [(ts, d) for ts, d in all_dumps if ts >= session_start - 1.0]
        else:
            # GAME_IN_PROGRESS was missed (app likely started mid-game), so
            # there's no clean lower bound. Segment all buffered dumps into
            # matches and keep the most recent one. _last_match_dumps tolerates
            # a noisy single-round reading; the old break-on-first-increase walk
            # did not, so one stale round truncated the timeline to a single
            # round (the 1-round-timeline bug).
            in_session = self._last_match_dumps(all_dumps)
        if not in_session:
            log.info("nettable: no in-session dumps to build timeline from")
            return None

        # Group dumps by round_info.round. Each round can have multiple
        # dumps -- keep the LATEST per round so the snapshot reflects
        # the round's final state.
        by_round: dict[int, dict] = {}
        for _ts, d in in_session:
            rows = d.get("rows") or []
            round_n = self._extract_round_from_rows(rows)
            if round_n is None:
                continue
            snapshot = {
                "round": round_n,
                "captured_at": d.get("captured_at"),
                "players": self._extract_players_state_from_rows(rows),
                "draft": self._extract_draft_state_from_rows(rows),
                "death_team": self._extract_death_team_from_rows(rows),
            }
            existing = by_round.get(round_n)
            # Keep the latest dump per round.
            if existing is None or (snapshot["captured_at"] or "") >= (existing["captured_at"] or ""):
                by_round[round_n] = snapshot

        if not by_round:
            log.info("nettable: in-session dumps had no round_info — skipping timeline")
            return None

        timeline = [by_round[r] for r in sorted(by_round.keys())]

        payload = {
            "match_id": match_id,
            "played_at": played_at,
            "roster_fingerprint": list(self._match_roster_fingerprint or []),
            "observer_steam_id": self._steam_id,
            "is_finished": self._end_board_captured,
            "verification_source": "end_board" if self._end_board_captured else "timeline",
            "round_count": len(timeline),
            "first_round": timeline[0]["round"],
            "last_round": timeline[-1]["round"],
            "rounds": timeline,
        }

        self._write_local_processed_json("processed_timeline.json", payload)

        # Direct-to-Supabase. The desktop app's timelines:fetch IPC reads
        # from Supabase too, so there's one source of truth.
        try:
            client = make_service_role_client()
            if client is None:
                log.warning(
                    "nettable: no Supabase client (missing url/key) — timeline %s NOT uploaded",
                    match_id,
                )
            else:
                with client:
                    uploaded = upsert_match_timeline(client, payload)
                if uploaded:
                    log.info(
                        "nettable: match timeline uploaded — match_id=%s rounds=%d (round %d → %d, from %d dumps)",
                        match_id, len(timeline), timeline[0]["round"], timeline[-1]["round"], len(in_session),
                    )
                else:
                    log.info(
                        "nettable: match timeline not replaced — match_id=%s incoming_rounds=%d",
                        match_id, len(timeline),
                    )
        except Exception as e:
            log.warning("nettable: timeline upload failed for %s: %s", match_id, e)

        self._emit({
            "type": "nettable_timeline_extracted",
            "match_id": match_id,
            "round_count": len(timeline),
            "at": played_at,
        })
        return payload

    @staticmethod
    def _stable_end_board_payload(end_board: dict) -> dict:
        """Strip nondeterministic fields (`hehe` random noise) so two
        consecutive PAUSE-press captures of the same end_board hash
        identically and dedup correctly."""
        if not isinstance(end_board, dict):
            return end_board
        # Recursively drop all `hehe` keys at any depth.
        def scrub(node):
            if isinstance(node, dict):
                return {k: scrub(v) for k, v in node.items() if k != "hehe"}
            if isinstance(node, list):
                return [scrub(x) for x in node]
            return node
        return scrub(end_board)

    @staticmethod
    def _extract_round_from_rows(rows: list[dict]) -> int | None:
        for r in rows:
            if r.get("table_name", "").endswith("game_info") and r.get("key") == "round_info":
                raw = r.get("raw")
                if isinstance(raw, dict):
                    val = raw.get("round")
                    try:
                        return int(val)
                    except (TypeError, ValueError):
                        return None
        return None

    # A round number only ever climbs within a single match, so a sustained
    # drop marks a match boundary. Allow a few rounds of slack so one stale or
    # out-of-order reading from the live cascade doesn't look like a new match.
    _ROUND_DROP_TOLERANCE = 3

    @classmethod
    def _last_match_dumps(cls, all_dumps: list[tuple]) -> list[tuple]:
        """From chronological (ts, dump) pairs that may span several matches,
        return only the most recent match's dumps.

        Splits the stream wherever the round number drops by more than
        _ROUND_DROP_TOLERANCE (a new match starting over at a low round) and
        keeps the last segment. Dumps with no round_info attach to whatever
        segment is currently open. Robust to a single noisy round reading,
        unlike a break-on-first-increase scan."""
        segments: list[list[tuple]] = []
        current: list[tuple] = []
        last_round: int | None = None
        for ts, d in all_dumps:
            round_n = cls._extract_round_from_rows(d.get("rows") or [])
            if (
                round_n is not None
                and last_round is not None
                and round_n < last_round - cls._ROUND_DROP_TOLERANCE
            ):
                segments.append(current)
                current = []
            current.append((ts, d))
            if round_n is not None:
                last_round = round_n
        if current:
            segments.append(current)
        return segments[-1] if segments else []

    @staticmethod
    def _extract_players_state_from_rows(rows: list[dict]) -> dict:
        """Pull live per-player state for a round snapshot.

        Three data sources, merged in priority order:
          1. `player_info_table.player_info.data.<steam_id>` — full
             per-player state (hp, hero_level, curr_rank, lineup).
             Empirically this is the one that updates round-to-round
             for the LOCAL player.
          2. `dac_table.player_info.info.<steam_id>` — same shape, accepted
             for old/local dumps and POST_GAME, but observed live values are
             often stale/default, so the 15s cascade no longer polls it.
          3. `player_id_table.<key>_<slot>` (slot = 0..7) — the
             per-slot tables: vchess_<n> (live board), courier_<n>
             (level, win_streak, courier model), relic_ttl_<n>
             (active relic + remaining duration), mmr_level_<n>.
             These populate even when (1) doesn't include a given
             player.

        Field notes:
          - `hero_level` is the round-by-round XP level shown on the
            portrait — the "level" we want.
          - `curr_rank` is current placement in the lobby (1-8).
          - `rank` is MMR-ladder rank (always 0 if unranked); we
            ignore it.

        Output is keyed by steam_id when known, otherwise by the
        synthetic key `slot_<n>` so unknown players still appear.
        """
        out: dict[str, dict] = {}

        def merge(key: str, fields: dict) -> None:
            existing = out.setdefault(key, {})
            for k, v in fields.items():
                if v is None:
                    continue
                # Don't downgrade live values with stale ones (hp=100 is
                # the static-table sentinel — only accept it if we have
                # nothing else yet).
                if k == "hp" and v == 100 and existing.get("hp") not in (None, 100):
                    continue
                if existing.get(k) in (None, "", 0) or k in ("hp", "level", "placement", "lineup"):
                    existing[k] = v

        # Build slot → steam_id map. `player_<n>.player_id` is the slot
        # number; the steam_id mapping comes from cross-referencing the
        # `player_info` containers (each player's row has its own
        # `player_id` field).
        slot_to_sid: dict[int, str] = {}
        for r in rows:
            tname = r.get("table_name", "")
            if not (tname.endswith("dac_table") or tname.endswith("player_info_table")):
                continue
            if r.get("key") != "player_info":
                continue
            raw = r.get("raw") or {}
            container = raw.get("data") or raw.get("info") or {}
            if not isinstance(container, dict):
                continue
            for sid, p in container.items():
                if not isinstance(p, dict):
                    continue
                pid = p.get("player_id")
                if pid is None:
                    continue
                try:
                    slot_to_sid.setdefault(int(pid), str(sid))
                except (TypeError, ValueError):
                    continue

        # (1) + (2): harvest from player_info containers.
        def harvest_player_info(raw: dict, key: str) -> None:
            if not isinstance(raw, dict):
                return
            container = raw.get(key) or {}
            if not isinstance(container, dict):
                return
            for sid, p in container.items():
                if not isinstance(p, dict):
                    continue
                lineup_raw = p.get("chess_lineup", "") or ""
                relic_raw = p.get("relic", "") or ""
                merge(str(sid), {
                    "hp": p.get("hp"),
                    "level": p.get("hero_level"),
                    "placement": p.get("curr_rank"),
                    "duration": p.get("duration"),
                    "lineup": _transform_chess_lineup(lineup_raw) if lineup_raw else None,
                    "lineup_value": p.get("lineup_value"),
                    "total_money": p.get("total_money"),
                    "win_round": p.get("win_round"),
                    "lose_round": p.get("lose_round"),
                    # buff: raw synergy stems "is_mage:6,is_human:6," — the UI
                    # renders these on the live card. relic: active relic code
                    # (player_info carries it directly as e.g. item_stolen_vault).
                    "buff": p.get("buff"),
                    "relic": _transform_relic(relic_raw) if relic_raw else None,
                })

        for r in rows:
            if r.get("table_name", "").endswith("player_info_table") and r.get("key") == "player_info":
                harvest_player_info(r.get("raw") or {}, "data")
        for r in rows:
            if r.get("table_name", "").endswith("dac_table") and r.get("key") == "player_info":
                harvest_player_info(r.get("raw") or {}, "info")

        # (3): per-slot tables — fill in board / courier / relic for any
        # slot, including ones whose steam_id we don't know yet.
        slot_data: dict[int, dict] = {}

        def slot_for_key(k: str, prefix: str) -> int | None:
            if not k.startswith(prefix + "_"):
                return None
            try:
                return int(k.removeprefix(prefix + "_"))
            except ValueError:
                return None

        for r in rows:
            if not r.get("table_name", "").endswith("player_id_table"):
                continue
            k = r.get("key", "")
            raw = r.get("raw") or {}
            if not isinstance(raw, dict):
                continue

            n = slot_for_key(k, "vchess")
            if n is not None:
                board = _extract_vchess_board(raw)
                if board:
                    slot_data.setdefault(n, {})["board"] = board
                chess_ids = [p.get("chess") for p in board if p.get("chess")]
                if chess_ids:
                    slot_data.setdefault(n, {})["lineup"] = _transform_chess_lineup(",".join(chess_ids))
                continue

            n = slot_for_key(k, "courier")
            if n is not None:
                slot_data.setdefault(n, {}).update({
                    "courier_level": raw.get("level"),
                    "win_streak": raw.get("win_streak"),
                })
                continue

            n = slot_for_key(k, "relic_ttl")
            if n is not None:
                relic_name = raw.get("relic_name") or ""
                slot_data.setdefault(n, {}).update({
                    "relic": _transform_relic(relic_name) if relic_name else None,
                    "relic_ttl": raw.get("ttl"),
                })
                continue

            n = slot_for_key(k, "mmr_level")
            if n is not None:
                slot_data.setdefault(n, {}).update({
                    "mmr_level": raw.get("mmr_level"),
                    "candy": raw.get("candy"),
                })
                continue

            n = slot_for_key(k, "player")
            if n is not None:
                slot_data.setdefault(n, {}).update({
                    "team_id": raw.get("team_id"),
                    "hero_index": raw.get("hero_index"),
                    "player_id": raw.get("player_id"),
                })
                continue

        for slot, fields in slot_data.items():
            sid = slot_to_sid.get(slot, f"slot_{slot}")
            merge(sid, fields)

        return out

    @staticmethod
    def _extract_draft_state_from_rows(rows: list[dict]) -> dict:
        """Pull ban_info_* and legendary list from chess_pool_table."""
        bans: dict[str, str] = {}
        legendaries_revealed: list = []
        for r in rows:
            if not r.get("table_name", "").endswith("chess_pool_table"):
                continue
            key = r.get("key", "")
            raw = r.get("raw")
            if key.startswith("ban_info_") and isinstance(raw, dict):
                pid = key.removeprefix("ban_info_")
                ban = raw.get("ban") or raw.get("synergy") or ""
                bans[pid] = ban
            elif key == "revealed_legendary_chess_list" and isinstance(raw, (list, dict)):
                legendaries_revealed = list(raw.values()) if isinstance(raw, dict) else list(raw)
        return {"bans": bans, "legendaries_revealed": legendaries_revealed}

    @staticmethod
    def _extract_death_team_from_rows(rows: list[dict]) -> dict:
        for r in rows:
            if r.get("table_name", "").endswith("game_info") and r.get("key") == "death_team":
                raw = r.get("raw")
                if isinstance(raw, dict):
                    return raw
        return {}

    @staticmethod
    def _extract_roster_fingerprint(rows: list[dict]) -> tuple[str, ...] | None:
        """Return sorted Steam IDs from player_info_table for lobby identity.

        Reconnects can re-emit GAME_IN_PROGRESS, but the same lobby should have
        the exact same player Steam IDs. A different roster means the previous
        open session was abandoned/replaced by a new lobby.
        """
        for r in rows:
            if not (r.get("table_name", "").endswith("player_info_table")
                    and r.get("key") == "player_info"):
                continue
            raw = r.get("raw")
            if not isinstance(raw, dict):
                continue
            data = raw.get("data")
            if not isinstance(data, dict) or not data:
                continue
            roster = tuple(sorted(str(sid) for sid in data.keys() if str(sid).startswith("7656")))
            return roster or None
        return None

    @staticmethod
    def _format_talents(talent_tree) -> str:
        """end_board.talent_tree is a dict like {'1': 'talent_1a_winbonus', ...}.
        Flatten to pipe-separated string sorted by key."""
        if not isinstance(talent_tree, dict):
            return ""
        try:
            return "|".join(talent_tree[k] for k in sorted(talent_tree.keys(), key=lambda x: int(x)))
        except Exception:
            return "|".join(str(v) for v in talent_tree.values())

    def _do_ingest(self, tables: list[str]) -> None:
        try:
            rows = extract_rows(self._log_path)
            if not rows:
                log.info("nettable: ingest found no rows — skipping")
                return

            from utils import load_config, local_only_mode

            roster = self._extract_roster_fingerprint(rows)
            if roster is not None:
                if self._match_session_start is None:
                    self._open_match_session("roster seen")
                    self._match_roster_fingerprint = roster
                    log.info("nettable: match roster set (%d player(s))", len(roster))
                elif self._match_roster_fingerprint is None:
                    self._match_roster_fingerprint = roster
                    log.info("nettable: match roster set (%d player(s))", len(roster))
                elif roster != self._match_roster_fingerprint:
                    log.info(
                        "nettable: roster changed (%d -> %d player(s)) — closing previous session as abandoned",
                        len(self._match_roster_fingerprint), len(roster),
                    )
                    self._maybe_save_partial_match_from_latest_dump(
                        capture_status="player_eliminated" if self._personal_end_recorded else "abandoned",
                        verification_source="death_team" if self._personal_end_recorded else "roster_changed",
                        close_session=True,
                    )
                    self._match_session_start = None
                    self._open_match_session("roster changed")
                    self._match_roster_fingerprint = roster

            # Round + lineup change detection — cheap, runs on every ingest.
            self._detect_round_change(rows)
            self._detect_lineup_change(rows)

            # Snapshot the local player's slot the moment their team flips
            # death_team 0 → 1 — covers "I'm out but match continues."
            # Cheap; per-match latch prevents re-fires.
            self._maybe_save_personal_end_board(rows)

            # Look for dac_table.end_board — the server writes this once when
            # a match finishes. Saving it gives us a finished-match record
            # independent of the unreachable match_history_table.
            self._maybe_save_end_board(rows)

            # Scan ranking_top_table for top players → upsert their profiles.
            self._maybe_extract_ranking_top(rows)

            # Buffer full raw rows in memory for timeline building and archive
            # them locally for debugging/reprocessing. Raw rows are not uploaded
            # unless upload_raw_nettable_dumps is explicitly enabled.
            now_ts = time.time()
            dump_doc = {
                "captured_at": datetime.now().isoformat(),
                "tables": tables,
                "rows": rows,
            }
            self._session_dumps.append((now_ts, dump_doc))
            self._append_local_raw_dump(dump_doc)
            log.info("nettable: dump buffered locally (%d row(s))", len(rows))

            # Cross-dump dedupe: only POST rows that actually changed since
            # the last successful capture. ranking_top alone is ~79 KB and
            # rarely changes mid-game — without this every dump uploads
            # the entire leaderboard.
            changed_rows = _storage_filter([
                r for r in rows
                if self._last_state.get(r["table_name"], {}).get(r["key"]) != r["raw"]
            ])
            skipped = len(rows) - len(changed_rows)

            # Merge into local snapshot. Capture and ingest are independent
            # concerns: if Supabase auth fails the data we decoded is still
            # valid and the live-capture panel should show it. Re-broadcast
            # always so the UI reflects the latest capture.
            now_iso = datetime.now().isoformat()
            for r in rows:
                bucket = self._last_state.setdefault(r["table_name"], {})
                bucket[r["key"]] = r["raw"]
            self._last_state_at = now_iso
            # Extract clean per-player state (transformed lineup, live hp with
            # the hp=100 static sentinel handled) via the same code the
            # timeline uses — the live "your board" card renders this directly
            # instead of re-parsing raw chess_* codes in the UI.
            self._last_players = self._extract_players_state_from_rows(rows)
            # "Local" = the configured local player's SteamID64. The
            # player_info_table.data container carries *every* visible player
            # in an 8-player lobby (not just our own client rows), so its keys
            # can't stand in for "you" — doing so flags all 8 seats as local
            # and labels every opponent "You". Fall back to the data keys only
            # when we don't know our own id and there's exactly one of them.
            if self._steam_id:
                self._last_local_steam_ids = [str(self._steam_id)]
            else:
                data_keys = [
                    str(sid)
                    for r in rows
                    if r.get("table_name", "").endswith("player_info_table")
                    and r.get("key") == "player_info"
                    for sid in ((r.get("raw") or {}).get("data") or {}).keys()
                ]
                self._last_local_steam_ids = data_keys if len(data_keys) == 1 else []
            self._emit({
                "type": "nettable_state",
                "state": self._last_state,
                "players": self._last_players,
                "local_steam_ids": self._last_local_steam_ids,
                "at": now_iso,
            })

            written = 0
            if local_only_mode():
                log.info(
                    "nettable: local_only — supabase POST skipped (%d changed, %d unchanged)",
                    len(changed_rows), skipped,
                )
            elif changed_rows and upload_raw_nettable_dumps():
                import httpx
                cfg = load_config()
                url = cfg.get("supabase_url")
                # Service-role required because dac_nettable_dumps RLS has an
                # anon SELECT policy but no INSERT — anon key gets 401 on write.
                # Resolution order: env var (cleanest), .env.local in the dev
                # repo (convenient when running from source), config.json
                # supabase_key (publishable, will 401 on insert but lets reads
                # still work). End-user shipped builds won't have .env.local.
                key = (
                    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
                    or _load_dotenv_value("SUPABASE_SERVICE_ROLE_KEY")
                    or cfg.get("supabase_key")
                )
                if not url or not key:
                    raise RuntimeError("supabase_url / key missing from config")
                with httpx.Client(
                    base_url=url.rstrip("/"),
                    headers={
                        "apikey": key,
                        "Authorization": f"Bearer {key}",
                        "Accept": "application/json",
                    },
                    timeout=60,
                ) as client:
                    written = insert_dumps(client, changed_rows)
            elif changed_rows:
                log.info(
                    "nettable: raw Supabase dump upload disabled (%d changed, %d unchanged)",
                    len(changed_rows), skipped,
                )

            log.info(
                "nettable: ingested %d row(s) across %d table(s) (skipped %d unchanged)",
                written, len(tables), skipped,
            )
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

def _safe_int(value) -> int | None:
    """Coerce to int, returning None on failure or empty value.
    end_board fields arrive as native ints normally but some show up as
    strings or null — keep the transform tolerant."""
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _pipe(value) -> str:
    """Convert comma-separated string (end_board convention) to
    pipe-separated (our schema convention). Empty / non-string → ''."""
    if not isinstance(value, str):
        return ""
    return value.replace(",", "|").strip("|")


def _string_list(value) -> list[str]:
    """Normalize VBKV item containers into a stable list of non-empty ids."""
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [str(v) for v in value if v]
    if isinstance(value, dict):
        def sort_key(k) -> tuple[int, str]:
            try:
                return (0, f"{int(k):08d}")
            except (TypeError, ValueError):
                return (1, str(k))

        return [
            str(value[k])
            for k in sorted(value.keys(), key=sort_key)
            if value.get(k)
        ]
    return [str(value)]


_CHESS_ID_MAP_CACHE: dict[str, str] | None = None
_SYNERGY_ID_MAP_CACHE: dict[str, str] | None = None
_SYNERGY_MIN_TIER_MAP_CACHE: dict[str, int] | None = None
_RELIC_ID_MAP_CACHE: dict[str, str] | None = None


def _load_relic_id_map() -> dict[str, str]:
    """Read data/relics.json → {'item_repeat_relic': 'Repeat Relic', ...}.
    The file shape is {'relics': {<item_id>: {'name': '...', ...}}}."""
    global _RELIC_ID_MAP_CACHE
    if _RELIC_ID_MAP_CACHE is not None:
        return _RELIC_ID_MAP_CACHE
    try:
        from utils import DATA_DIR
        path = DATA_DIR / "relics.json"
        if not path.exists():
            _RELIC_ID_MAP_CACHE = {}
            return _RELIC_ID_MAP_CACHE
        data = json.loads(path.read_text(encoding="utf-8"))
        relics = data.get("relics", data) if isinstance(data, dict) else {}
        out: dict[str, str] = {}
        if isinstance(relics, dict):
            for item_id, info in relics.items():
                if isinstance(info, dict):
                    out[item_id] = info.get("name") or item_id
        _RELIC_ID_MAP_CACHE = out
    except Exception as e:
        log.warning("nettable: failed to load relic id map: %s", e)
        _RELIC_ID_MAP_CACHE = {}
    return _RELIC_ID_MAP_CACHE


def _transform_relic(raw: str) -> str:
    """'item_repeat_relic' → 'Repeat Relic'. Single relic, not a list."""
    if not raw:
        return ""
    return _load_relic_id_map().get(raw, raw)


def _load_chess_id_map() -> dict[str, str]:
    """Read data/units_full.json → {internal chess_id: 'Display Name'}.
    Lets us convert raw end_board strings like 'chess_br11' into the
    'Broodmother(3)' format the History tab's parsers expect."""
    global _CHESS_ID_MAP_CACHE
    if _CHESS_ID_MAP_CACHE is not None:
        return _CHESS_ID_MAP_CACHE
    try:
        from utils import DATA_DIR
        path = DATA_DIR / "units_full.json"
        if not path.exists():
            _CHESS_ID_MAP_CACHE = {}
            return _CHESS_ID_MAP_CACHE
        data = json.loads(path.read_text(encoding="utf-8"))
        _CHESS_ID_MAP_CACHE = {
            u.get("id"): name for name, u in data.items() if u.get("id")
        }
    except Exception as e:
        log.warning("nettable: failed to load chess id map: %s", e)
        _CHESS_ID_MAP_CACHE = {}
    return _CHESS_ID_MAP_CACHE


def _load_synergy_id_map() -> dict[str, str]:
    """Read data/synergies.json → {'is_mage': 'Mage', 'is_human': 'Human', ...}.
    synergies.json is keyed BY the internal id ('is_aqir') with a
    nested 'name' field holding the display label."""
    global _SYNERGY_ID_MAP_CACHE
    if _SYNERGY_ID_MAP_CACHE is not None:
        return _SYNERGY_ID_MAP_CACHE
    try:
        from utils import DATA_DIR
        path = DATA_DIR / "synergies.json"
        if not path.exists():
            _SYNERGY_ID_MAP_CACHE = {}
            return _SYNERGY_ID_MAP_CACHE
        data = json.loads(path.read_text(encoding="utf-8"))
        out: dict[str, str] = {}
        if isinstance(data, dict):
            for internal_id, info in data.items():
                if isinstance(info, dict):
                    display = info.get("name") or internal_id
                    out[internal_id] = display
        _SYNERGY_ID_MAP_CACHE = out
    except Exception as e:
        log.warning("nettable: failed to load synergy id map: %s", e)
        _SYNERGY_ID_MAP_CACHE = {}
    return _SYNERGY_ID_MAP_CACHE


def _load_synergy_min_tier_map() -> dict[str, int]:
    """Read data/synergies.json -> {'is_mage': 3, 'is_demon': 1, ...}."""
    global _SYNERGY_MIN_TIER_MAP_CACHE
    if _SYNERGY_MIN_TIER_MAP_CACHE is not None:
        return _SYNERGY_MIN_TIER_MAP_CACHE
    try:
        from utils import DATA_DIR
        path = DATA_DIR / "synergies.json"
        if not path.exists():
            _SYNERGY_MIN_TIER_MAP_CACHE = {}
            return _SYNERGY_MIN_TIER_MAP_CACHE
        data = json.loads(path.read_text(encoding="utf-8"))
        out: dict[str, int] = {}
        if isinstance(data, dict):
            for internal_id, info in data.items():
                tiers = info.get("tiers") if isinstance(info, dict) else None
                nums: list[int] = []
                for tier in tiers or []:
                    n = _safe_int(tier)
                    if n is not None:
                        nums.append(n)
                if nums:
                    out[internal_id] = min(nums)
        _SYNERGY_MIN_TIER_MAP_CACHE = out
    except Exception as e:
        log.warning("nettable: failed to load synergy tier map: %s", e)
        _SYNERGY_MIN_TIER_MAP_CACHE = {}
    return _SYNERGY_MIN_TIER_MAP_CACHE


def _resolve_chess_piece(piece_id: str, id_map: dict[str, str]) -> tuple[str, int]:
    """'chess_br11' → ('Broodmother', 3). Strips trailing '1's, looks
    up the base id; star count = 1 + number stripped. Unknown ids
    fall through as-is at 1 star so the UI shows the raw token (so
    breakage is visible, not silent)."""
    if not piece_id or piece_id == "placeholder":
        return ("", 0)
    import re as _re
    base = _re.sub(r"1+$", "", piece_id)
    if base in id_map:
        stars = 1 + (len(piece_id) - len(base))
        return (id_map[base], max(1, min(stars, 3)))
    return (piece_id, 1)


def _transform_chess_lineup(raw: str) -> str:
    """'chess_br11,chess_chen11,chess_wl1' → 'Broodmother(3)|Chen(3)|Warlock(2)'."""
    if not raw:
        return ""
    id_map = _load_chess_id_map()
    if not id_map:
        return _pipe(raw)  # fallback: at least normalize separators
    out: list[str] = []
    for p in str(raw).replace("|", ",").split(","):
        p = p.strip()
        if not p or p == "placeholder":
            continue
        name, stars = _resolve_chess_piece(p, id_map)
        if not name:
            continue
        out.append(f"{name}({stars})" if stars > 1 else name)
    return "|".join(out)


def _extract_vchess_board(raw: dict) -> list[dict]:
    """Normalize player_id_table.vchess_N into positioned board pieces."""
    if not isinstance(raw, dict):
        return []
    id_map = _load_chess_id_map()
    board: list[dict] = []
    for slot_key, cell in raw.items():
        if not isinstance(cell, dict):
            continue
        chess_id = str(cell.get("chess") or "")
        if not chess_id or chess_id == "placeholder":
            continue
        name, stars = _resolve_chess_piece(chess_id, id_map)
        if not name:
            continue
        piece = {
            "slot_key": str(slot_key),
            "chess": chess_id,
            "name": name,
            "stars": stars,
            "x": _safe_int(cell.get("x")),
            "y": _safe_int(cell.get("y")),
            "items": _string_list(cell.get("item")),
            "last_items": _string_list(cell.get("lastitem")),
        }
        for raw_key, out_key in (
            ("index", "index"),
            ("buy_price", "buy_price"),
            ("water_id", "water_id"),
        ):
            value = _safe_int(cell.get(raw_key))
            if value is not None:
                piece[out_key] = value
        board.append(piece)

    board.sort(key=lambda p: (
        p.get("y") if p.get("y") is not None else 99,
        p.get("x") if p.get("x") is not None else 99,
        p.get("slot_key") or "",
    ))
    return board


def _transform_synergies(raw: str, active_only: bool = False) -> str:
    """'is_mage:9,is_human:6' → 'Mage:9|Human:6'."""
    if not raw:
        return ""
    id_map = _load_synergy_id_map()
    min_tiers = _load_synergy_min_tier_map() if active_only else {}
    out: list[str] = []
    for p in str(raw).replace("|", ",").split(","):
        p = p.strip()
        if not p:
            continue
        if ":" in p:
            sid, count = p.split(":", 1)
            sid = sid.strip()
            count_text = count.strip()
            count_int = _safe_int(count_text)
            if active_only and count_int is not None:
                min_tier = min_tiers.get(sid)
                if min_tier is not None and count_int < min_tier:
                    continue
            display = id_map.get(sid, sid)
            out.append(f"{display}:{count_text}")
        else:
            display = id_map.get(p, p)
            out.append(display)
    return "|".join(out)
