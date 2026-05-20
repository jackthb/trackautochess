"""Automatic NetTable capture from Dota's console.log.

Flow:
    1. On startup, install autoexec.cfg (binds dump-key to dac_dump_all) into
       <dota>/game/dota/cfg/.
    2. Tail console.log non-blockingly. Three triggers matter:
       - DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: opens the match session window.
       - DOTA_GAMERULES_STATE_POST_GAME: emit nettable_game_ended so the UI
         knows the match wrapped up.
       - [stringtables] table CustomNetTable_*: collect the dump block;
         when it stabilises (~2s without new [stringtables] lines), ingest
         to Supabase.
    3. Dumps are produced by the continuous SendInput cascade (see
       _run_key_poller) — no scheduled timers; the poller fires F20 every
       2s and the full cascade (PAUSE, F11, F13, F15, F16, F20) every 15s
       while Dota is foreground.

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

# Static reference tables we've already snapshotted to fixtures
# (ability definitions, chess piece stats, user UI settings) are
# excluded from the live bind — they're ~95% of dump volume and never
# change between games. If we ever need them refreshed (e.g. after a
# DAC patch), add them back temporarily and run a single capture.
_DUMP_COMMANDS_INLINE = (
    "dumpstringtable CustomNetTable_ranking_top_table cl verbose;"
    "dumpstringtable CustomNetTable_match_history_tab cl verbose;"
    "dumpstringtable CustomNetTable_dac_table cl verbose;"
    "dumpstringtable CustomNetTable_player_id_table cl verbose;"
    "dumpstringtable CustomNetTable_player_info_table cl verbose;"
    "dumpstringtable CustomNetTable_game_info cl verbose;"
    "dumpstringtable CustomNetTable_chess_pool_table cl verbose;"
    "dumpstringtable CustomNetTable_unit_table cl verbose;"
    "dumpstringtable CustomNetTable_quest_table cl verbose;"
    "dumpstringtable CustomNetTable_casino_table cl verbose;"
    "dumpstringtable CustomNetTable_hp_bar_table cl verbose"
)

AUTOEXEC_CFG_CONTENT = f"""// DAC NetTable dump triggers — installed by DAC Tracker.
//
// Source 2's bind dispatcher drops chained `dumpstringtable` calls
// because they fire too fast for the console output pipeline — only
// the first one in a chain actually runs (observed empirically:
// PAUSE was producing only ranking_top_table). So we bind ONE table
// per key. Each press fires a single command, fully processed.
//
// Press the key you want; the backend tailer ingests whatever lands.
// `dac_table` (INS) is the critical one — it carries `end_board` at
// match end.
//
// F-keys mapped per table. Single command per key — chained
// dumpstringtable in one bind silently drops everything after the
// first (Valve disabled multi-command binds).
//
// Excluded keys:
//   F7  → toggleconsole (default)
//   F8  → Dota Options reserved
//   F9  → Dota Options reserved
//   F12 → Steam screenshot
//
// Note on F10: Dota's GUI hotkey file (dotakeys_personal.lst) claims
// F10 for SpectatorBroadcasterMenu by default. The autoexec bind
// usually wins, but on some accounts/sessions the GUI layer may
// override. If F10 stops firing, paste `bind "F10" "..."` in console
// (or unbind SpectatorBroadcasterMenu in Dota Settings → Hotkeys).
//
// Snapshot keys (press once per moment of interest):
//   PAUSE → dac_table          ← has end_board after match
//   F11   → player_info_table  ← full live per-player state
//   F13   → unit_table         ← chess pieces on board right now
//   F15   → player_id_table    ← MMR + candy per slot
//   F16   → chess_pool_table   ← draft / ban / legendary state
//   F18   → match_history_tab  ← set ONCE per match after the DAC
//                                backend HTTP callback completes
//                                (~5s into GAME_IN_PROGRESS)
//
// Polling key (safe to spam — extended F-key, no keyboard conflict):
//   F20 → game_info          ← round_info + death_team

// F10 deliberately NOT bound — per-account user_keys.vcfg may have
// `"F10" "<unbound>"` which overrides autoexec, making F10 unreliable
// across users. PAUSE replaces it (consistently free, not in any
// dotakeys_personal.lst or user_keys.vcfg override file).
bind "PAUSE" "dumpstringtable CustomNetTable_dac_table cl verbose"
bind "F11" "dumpstringtable CustomNetTable_player_info_table cl verbose"
bind "F13" "dumpstringtable CustomNetTable_unit_table cl verbose"
bind "F15" "dumpstringtable CustomNetTable_player_id_table cl verbose"
bind "F16" "dumpstringtable CustomNetTable_chess_pool_table cl verbose"
bind "F18" "dumpstringtable CustomNetTable_match_history_tab cl verbose"
bind "F20" "dumpstringtable CustomNetTable_game_info cl verbose"
"""

DAC_DUMP_CFG_CONTENT = """// DAC NetTable dump commands — installed by DAC Tracker.
// Invoked via `exec dac_dump` (bind or manual paste).
//
// Leading `echo DAC_DUMP_FIRED` is a diagnostic marker the tailer
// surfaces so we can confirm the file actually executed even when
// every table is empty.
//
// `match_history_tab` is intentional — Source 2 truncates stringtable
// names at 32 chars; the real name is `_tab` (32) not `_table` (34).

echo DAC_DUMP_FIRED
dumpstringtable CustomNetTable_ranking_top_table cl verbose
dumpstringtable CustomNetTable_match_history_tab cl verbose
dumpstringtable CustomNetTable_dac_table cl verbose
dumpstringtable CustomNetTable_player_id_table cl verbose
dumpstringtable CustomNetTable_player_info_table cl verbose
dumpstringtable CustomNetTable_game_info cl verbose
dumpstringtable CustomNetTable_chess_pool_table cl verbose
dumpstringtable CustomNetTable_unit_table cl verbose
dumpstringtable CustomNetTable_quest_table cl verbose
dumpstringtable CustomNetTable_casino_table cl verbose
dumpstringtable CustomNetTable_hp_bar_table cl verbose
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


def find_dac_dump_cfg_target(dota_dir: Path) -> Path:
    return dota_dir / "game" / "dota" / "cfg" / "dac_dump.cfg"


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
VK_PAUSE = 0x13
VK_F8 = 0x77
VK_INSERT = 0x2D
VK_F11 = 0x7A
VK_F13 = 0x7C
VK_F15 = 0x7E
VK_F16 = 0x7F
VK_F18 = 0x81
VK_F20 = 0x83


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


def send_input_key(vk: int) -> bool:
    """Fire a single keydown/keyup for the given virtual-key code via
    SendInput. Returns True iff Dota is foreground AND the call sent
    both events successfully. Silent no-op if Dota isn't active."""
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
        _post_key(hwnd, VK_INSERT)
        log.info("Sent Pause to Dota hwnd=%s", hwnd)
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


# ── Main capture class ──────────────────────────────────────────────────────

GAME_IN_PROGRESS_RE = "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"
POST_GAME_RE = "DOTA_GAMERULES_STATE_POST_GAME"
STRINGTABLE_MARKER = "[stringtables]"
PAUSE_FIRED_MARKER = "DAC_DUMP_FIRED"

# How often the backend fires F20 (game_info) for cheap round visibility.
# Mirrors the role AHK's PollRound timer used to play, now in-process.
POLL_INTERVAL_SEC = 2.0
# How often the backend fires the full cascade (dac_table + player_info +
# unit + player_id + chess_pool + game_info). Heavier — gives a complete
# state snapshot.
FULL_CASCADE_INTERVAL_SEC = 15.0
# Gap between individual keys in the cascade. dumpstringtable produces
# hundreds of console lines per call; firing too fast can drop output.
CASCADE_KEY_GAP_SEC = 0.2

# The keys the cascade fires, in order. Mirrors the autoexec binds.
CASCADE_VK_SEQUENCE = (VK_PAUSE, VK_F11, VK_F13, VK_F15, VK_F16, VK_F20)

# Wait this long after POST_GAME before sending dump-key again. The `end_board`
# table is populated server-side at POST_GAME entry; small buffer for the
# broadcast to land at the client.
DUMP_POSTGAME_DELAY_SEC = 5.0

# A dump block is considered stable when no new [stringtables] lines arrive
# for this many seconds.
DUMP_STABILISE_SEC = 2.0

# After GAME_IN_PROGRESS fires, the DAC backend's autochess.ppbizon.com/game/new
# HTTP request needs to complete before `match_history_table` is populated (see
# addon_game_mode.lua:3088). Empirically 1-5s; we wait 8s to be safe, then fire
# F18 once. The table is then frozen for the rest of the match.
MATCH_HISTORY_CAPTURE_DELAY_SEC = 8.0

# After POST_GAME, fire PAUSE this many times spaced this many seconds apart.
# Riding out a brief alt-tab so end_board still lands.
POST_GAME_PAUSE_BURST_COUNT = 3
POST_GAME_PAUSE_BURST_GAP_SEC = 0.4

# How often to poll the log file when no data is arriving.
POLL_IDLE_SEC = 0.5

# console.log counts as "active" if it was modified within this many seconds.
# Long enough to bridge the gaps between Dota's normal stdout flushes, short
# enough to detect "Dota is running but -condebug isn't on" reasonably fast.
LOG_ACTIVE_WINDOW_SEC = 30.0


class NetTableCapture:
    """Tail Dota's console.log, send dump-key mid- and post-game, ingest dumps."""

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

        # Hashes of end_board payloads we've already saved, to dedup if
        # the user presses INS multiple times after game end.
        self._saved_end_board_hashes: set[str] = set()

        # Last seen round number from game_info → round_info → round.
        # Updated on every ingest; change → emit nettable_round_changed.
        # When round % 5 == 0, emit nettable_creep_round.
        self._last_round: int | None = None
        # Per-player chess_lineup snapshot for diff detection.
        # Keyed by steam_id, value is the comma-joined chess list.
        self._last_lineups: dict[str, str] = {}

        # Match session window — used to stitch dump files into a
        # match timeline. Set on GAME_IN_PROGRESS (start), reset
        # after a match's timeline is generated. Float epoch seconds.
        self._match_session_start: float | None = None
        # Whether we've fired the one-shot F18 to capture match_history
        # for this session. Reset when _match_session_start resets.
        self._match_history_captured: bool = False

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
        k = threading.Thread(target=self._run_key_poller, daemon=True, name="nettable-key-poller")
        k.start()

    def _run_key_poller(self) -> None:
        """Replaces AHK: fires F20 every 2s and the full cascade every
        15s, but only while Dota is the foreground window. SendInput
        keystrokes are accepted by Dota the same way real key presses
        are (PostMessage gets filtered by the input layer)."""
        last_full_cascade = 0.0
        while not self._stop.is_set():
            now = time.time()
            try:
                if _is_dota_foreground():
                    if now - last_full_cascade >= FULL_CASCADE_INTERVAL_SEC:
                        last_full_cascade = now
                        for vk in CASCADE_VK_SEQUENCE:
                            if self._stop.is_set():
                                break
                            send_input_key(vk)
                            time.sleep(CASCADE_KEY_GAP_SEC)
                    else:
                        # Cheap poll — just F20 (game_info → round_info).
                        send_input_key(VK_F20)
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
        for dst, content, label in (
            (find_autoexec_target(self._dota_dir), AUTOEXEC_CFG_CONTENT, "autoexec.cfg"),
            (find_dac_dump_cfg_target(self._dota_dir), DAC_DUMP_CFG_CONTENT, "dac_dump.cfg"),
        ):
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                desired = content.encode("utf-8")
                if dst.exists() and _sha256(dst.read_bytes()) == _sha256(desired):
                    log.info("nettable: %s already current at %s", label, dst)
                    continue
                dst.write_bytes(desired)
                log.info("nettable: wrote %s to %s", label, dst)
            except Exception as e:
                log.warning("nettable: failed to install %s: %s", label, e)
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
        # Also schedules a one-shot F18 press ~8s later to capture
        # match_history_tab once the DAC backend's HTTP callback
        # populates it (the table is set ONCE per match via
        # addon_game_mode.lua:3088 after autochess.ppbizon.com/game/new
        # returns, then never updated — see VPK survey).
        if GAME_IN_PROGRESS_RE in line:
            if self._match_session_start is None:
                self._match_session_start = time.time()
                self._match_history_captured = False
                log.info("nettable: GAME_IN_PROGRESS — match session opened")
                t = threading.Timer(MATCH_HISTORY_CAPTURE_DELAY_SEC,
                                    self._fire_match_history_capture)
                t.daemon = True
                t.start()

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
                log.info("nettable: POST_GAME detected — match ended, firing PAUSE")
                self._emit({
                    "type": "nettable_game_ended",
                    "message": "Match ended — capturing end_board.",
                    "at": datetime.now().isoformat(),
                })
                # Fire PAUSE three times spaced ~250ms to ride out
                # transient foreground loss (alt-tab can be split-second).
                threading.Thread(
                    target=self._fire_post_game_pause_burst,
                    daemon=True,
                    name="nettable-postgame-pause",
                ).start()

        if STRINGTABLE_MARKER in line:
            self._note_dump_line(line)

    def _fire_match_history_capture(self) -> None:
        """One-shot F18 press to capture match_history_tab. Skipped if
        Dota isn't foreground (rare during pre-game / round 0) or if
        we already captured this session."""
        if self._stop.is_set() or self._match_history_captured:
            return
        if not _is_dota_foreground():
            # Reschedule once — give Dota a chance to come back to focus
            # before giving up for this session.
            log.info("nettable: match_history capture skipped (Dota not foreground); retrying in 5s")
            t = threading.Timer(5.0, self._fire_match_history_capture)
            t.daemon = True
            t.start()
            return
        if send_input_key(VK_F18):
            self._match_history_captured = True
            log.info("nettable: fired F18 for match_history_tab capture")

    def _fire_post_game_pause_burst(self) -> None:
        """Fire PAUSE several times spaced ~400ms apart immediately after
        POST_GAME. Rides out a brief alt-tab so end_board still lands —
        the 15s cascade alone misses it when the user clicks away."""
        for i in range(POST_GAME_PAUSE_BURST_COUNT):
            if self._stop.is_set():
                return
            send_input_key(VK_PAUSE)
            log.info("nettable: post-game PAUSE fire %d/%d", i + 1, POST_GAME_PAUSE_BURST_COUNT)
            self._stop.wait(POST_GAME_PAUSE_BURST_GAP_SEC)

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
        # Locate dac_table.player_info → info → {steam_id: {chess_lineup}}
        for r in rows:
            if not (r.get("table_name", "").endswith("dac_table")
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

    def _maybe_extract_ranking_top(self, rows: list[dict]) -> None:
        """Find ranking_top_table.ranking_top and upsert a player profile
        for every steam_id in the leaderboard. Lets us build a global
        player DB without having to personally play with everyone."""
        from utils import LOCAL_PLAYERS_DIR

        for r in rows:
            if not (r.get("table_name", "").endswith("ranking_top_table")
                    and r.get("key") == "ranking_top"):
                continue
            raw = r.get("raw")
            if not isinstance(raw, dict):
                continue
            top = raw.get("ranking_top") or {}
            if not isinstance(top, dict):
                continue
            season = raw.get("season") or ""
            scanned_at = datetime.now().isoformat()
            upserted = 0
            LOCAL_PLAYERS_DIR.mkdir(parents=True, exist_ok=True)
            for rank_str, entry in top.items():
                if not isinstance(entry, dict):
                    continue
                sid = str(entry.get("player") or "")
                if not sid or not sid.startswith("7656"):  # SteamID64 prefix
                    continue
                try:
                    ppath = LOCAL_PLAYERS_DIR / f"{sid}.json"
                    existing: dict = {}
                    if ppath.exists():
                        try:
                            existing = json.loads(ppath.read_text(encoding="utf-8"))
                        except Exception:
                            existing = {}
                    profile = {
                        **existing,
                        "steam_id": sid,
                        "last_ranking_seen": scanned_at,
                        "queen_rank": _safe_int(entry.get("queen_rank")),
                        "mmr_level": _safe_int(entry.get("mmr_level")),
                        "is_vip": bool(entry.get("is_vip")),
                        "chicken_count": _safe_int(entry.get("chicken_count")),
                        "season": season,
                        "source": "ranking_top_scan",
                    }
                    ppath.write_text(json.dumps(profile, indent=2, ensure_ascii=False), encoding="utf-8")
                    upserted += 1
                except Exception as e:
                    log.warning("nettable: failed to upsert ranking player %s: %s", sid, e)
            if upserted > 0:
                log.info("nettable: ranking_top scan upserted %d player profile(s)", upserted)
                self._emit({
                    "type": "nettable_ranking_scanned",
                    "player_count": upserted,
                    "season": season,
                    "at": scanned_at,
                })
            break

    def _maybe_save_end_board(self, rows: list[dict], games_dir) -> None:
        """If the dump contains dac_table.end_board, archive the raw payload
        and trigger structured extraction (transformed match + match_players
        + players). Dedupes on payload hash to avoid double-writes."""
        from utils import LOCAL_END_BOARDS_DIR

        end_board = None
        for r in rows:
            if r.get("table_name") in ("CustomNetTable_dac_table", "dac_table") \
                    and r.get("key") == "end_board":
                end_board = r.get("raw")
                break
        if end_board is None:
            return
        try:
            saved_at = datetime.now().isoformat()
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
                return
            self._saved_end_board_hashes.add(payload_hash)

            raw_payload = json.dumps({
                "saved_at": saved_at,
                "source": "dac_table.end_board",
                "end_board": end_board,
            }, indent=2, ensure_ascii=False, sort_keys=True)

            # Archive raw to its own dir (separate from transformed records).
            LOCAL_END_BOARDS_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            raw_path = LOCAL_END_BOARDS_DIR / f"{ts}__end_board.json"
            raw_path.write_text(raw_payload, encoding="utf-8")
            log.info("nettable: archived raw end_board to %s", raw_path.name)

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

            self._emit({
                "type": "nettable_end_board_saved",
                "path": str(raw_path),
                "at": saved_at,
            })
        except Exception as e:
            log.warning("nettable: failed to save end_board: %s", e)

    def _extract_structured_match(
        self, end_board: dict, played_at: str, match_id: str,
    ) -> tuple[dict, list[dict]] | None:
        """Turn raw end_board into three transformed views:
          * matches/<match_id>.json         — match header + player summary
          * match_players/<match_id>__p<N>.json — per-player rows for ME only
          * players/<steam_id>.json         — append-only profile per player

        match_id is computed by the caller (deterministic per end_board) so
        two installs in the same lobby agree without coordination.

        Returns (match_record, player_rows) — the caller uploads the bundle
        to Supabase. Returns None when end_board.data is missing/empty."""
        from utils import LOCAL_MATCH_PLAYERS_DIR, LOCAL_MATCHES_DIR, LOCAL_PLAYERS_DIR

        data = end_board.get("data") if isinstance(end_board, dict) else None
        if not isinstance(data, dict) or not data:
            return None

        my_steam_id = str(self.config.get("steam_id") or "").strip() if hasattr(self, "config") else ""
        # Fall back to load_config() if the NetTableCapture instance doesn't
        # carry config (defensive — older entrypoints constructed it without).
        if not my_steam_id:
            try:
                from utils import load_config
                my_steam_id = str(load_config().get("steam_id") or "").strip()
            except Exception:
                my_steam_id = ""

        match_players: list[dict] = []
        all_player_rows: list[dict] = []
        match_duration: float | None = None
        match_final_round: int | None = None

        LOCAL_PLAYERS_DIR.mkdir(parents=True, exist_ok=True)
        LOCAL_MATCH_PLAYERS_DIR.mkdir(parents=True, exist_ok=True)
        LOCAL_MATCHES_DIR.mkdir(parents=True, exist_ok=True)

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
                "synergies": _transform_synergies(p.get("show_buff")),
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
            # Per-player deep row for EVERY player in end_board, not just
            # the logged-in user. Distribution: friends play their own
            # matches, end_board reports their data, we want it all.
            mp_path = LOCAL_MATCH_PLAYERS_DIR / f"{match_id}__p{placement or 'X'}__{sid}.json"
            try:
                mp_path.write_text(json.dumps(row, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception as e:
                log.warning("nettable: failed to write match_player %s: %s", sid, e)

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

            # Player profile — append-only, accumulates match_ids over time.
            try:
                ppath = LOCAL_PLAYERS_DIR / f"{sid}.json"
                existing: dict = {}
                if ppath.exists():
                    try:
                        existing = json.loads(ppath.read_text(encoding="utf-8"))
                    except Exception:
                        existing = {}
                match_ids = existing.get("match_ids") or []
                if match_id not in match_ids:
                    match_ids.append(match_id)
                profile = {
                    "steam_id": sid,
                    "last_seen": played_at,
                    "last_mmr_level": mmr_level,
                    "last_match_id": match_id,
                    "match_count": len(match_ids),
                    "match_ids": match_ids,
                }
                ppath.write_text(json.dumps(profile, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception as e:
                log.warning("nettable: failed to write player profile %s: %s", sid, e)

        # Match header
        match_record = {
            "match_id": match_id,
            "played_at": played_at,
            "duration": match_duration or 0,
            "final_round": match_final_round or 0,
            "player_count": len(match_players),
            "players": sorted(match_players, key=lambda x: (x["placement"] or 99)),
        }
        try:
            mpath = LOCAL_MATCHES_DIR / f"{match_id}.json"
            mpath.write_text(json.dumps(match_record, indent=2, ensure_ascii=False), encoding="utf-8")
            log.info(
                "nettable: structured match saved — match_id=%s players=%d duration=%.0fs final_round=%d",
                match_id, len(match_players), match_duration or 0, match_final_round or 0,
            )
            self._emit({
                "type": "nettable_match_extracted",
                "match_id": match_id,
                "player_count": len(match_players),
                "at": played_at,
            })
        except Exception as e:
            log.warning("nettable: failed to write match record: %s", e)

        # Round-by-round timeline — stitch in-session dumps into an
        # ordered action log so the UI can replay the match.
        try:
            self._extract_match_timeline(match_id, played_at)
        except Exception as e:
            log.warning("nettable: failed to write match timeline: %s", e)

        # Close the session window so the NEXT match starts clean.
        self._match_session_start = None

        return match_record, all_player_rows

    def _upload_match_to_supabase(
        self, match_record: dict, player_rows: list[dict],
    ) -> None:
        """Fan out the match → Supabase: ensure_user for every player (FK),
        push the match header, bulk-push match_players, then write 8 trimmed
        rows into the legacy `games` table so the web viewer's player
        profile pages light up. Each step swallows its own failures —
        partial success is preferred to total loss."""
        from db import (
            ensure_user, push_match, push_match_players, push_live_game,
        )
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

        # Step 4 — trimmed games rows so every player profile sees the match.
        for r in player_rows:
            try:
                push_live_game(r)
            except Exception as e:
                log.warning("nettable: push_live_game(%s) failed: %s",
                            r.get("steam_id"), e)

    def _extract_match_timeline(self, match_id: str, played_at: str) -> None:
        """Walk dumps that belong to the just-ended match, pull
        per-round per-player state, write match_timelines/<match_id>.json
        as an ordered list of round snapshots.

        Match-window detection (in priority order):
          1. If GAME_IN_PROGRESS fired this session (_match_session_start
             is set), use that as the lower bound.
          2. Otherwise, walk dumps backwards from now; collect them
             until the round number STOPS being monotonically
             non-decreasing (i.e. the previous match begins). That
             gives us this match's dumps even if backend missed the
             session start."""
        from utils import LOCAL_DUMPS_DIR, LOCAL_MATCH_TIMELINES_DIR

        # Collect ALL dump files with their mtimes.
        all_dumps = []
        for p in LOCAL_DUMPS_DIR.glob("*.json"):
            try:
                all_dumps.append((p.stat().st_mtime, p))
            except Exception:
                continue
        all_dumps.sort()
        if not all_dumps:
            log.info("nettable: no dumps to build timeline from")
            return

        session_start = self._match_session_start
        if session_start is not None:
            dump_files = [t for t in all_dumps if t[0] >= session_start - 1.0]
        else:
            # Walk backwards. Each in-match dump should have a round
            # number >= the previous one (rounds go up). Stop when we
            # see a drop (= previous match's later round → end_board's
            # match's earlier round transition).
            reversed_dumps = list(reversed(all_dumps))
            in_match = []
            prev_round = None
            for mtime, path in reversed_dumps:
                try:
                    d = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                round_n = self._extract_round_from_rows(d.get("rows") or [])
                if round_n is None:
                    in_match.append((mtime, path))
                    continue
                # Walking backwards, round numbers should DECREASE or
                # stay equal. If we see an INCREASE (older dump has
                # higher round than newer one), that's a boundary.
                if prev_round is not None and round_n > prev_round:
                    break
                prev_round = round_n
                in_match.append((mtime, path))
            dump_files = sorted(in_match)
        if not dump_files:
            log.info("nettable: no in-session dumps to build timeline from")
            return

        # Group dumps by round_info.round. Each round can have multiple
        # dumps — keep the LATEST per round so the snapshot reflects
        # the round's final state.
        by_round: dict[int, dict] = {}
        for mtime, path in dump_files:
            try:
                d = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
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
            return

        timeline = [by_round[r] for r in sorted(by_round.keys())]

        LOCAL_MATCH_TIMELINES_DIR.mkdir(parents=True, exist_ok=True)
        out_path = LOCAL_MATCH_TIMELINES_DIR / f"{match_id}.json"
        out_path.write_text(json.dumps({
            "match_id": match_id,
            "played_at": played_at,
            "round_count": len(timeline),
            "first_round": timeline[0]["round"],
            "last_round": timeline[-1]["round"],
            "rounds": timeline,
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        log.info(
            "nettable: match timeline saved — match_id=%s rounds=%d (round %d → %d, from %d dumps)",
            match_id, len(timeline), timeline[0]["round"], timeline[-1]["round"], len(dump_files),
        )
        self._emit({
            "type": "nettable_timeline_extracted",
            "match_id": match_id,
            "round_count": len(timeline),
            "at": played_at,
        })

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

    @staticmethod
    def _extract_players_state_from_rows(rows: list[dict]) -> dict:
        """Pull live per-player state for a round snapshot.

        Three data sources, merged in priority order:
          1. `player_info_table.player_info.data.<steam_id>` — full
             per-player state (hp, hero_level, curr_rank, lineup).
             Empirically this is the one that updates round-to-round
             for the LOCAL player.
          2. `dac_table.player_info.info.<steam_id>` — same shape,
             carries all 8 players in 8-player lobbies (the local
             user's client receives everyone's state here).
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
                chess_ids = [
                    v.get("chess") for v in raw.values()
                    if isinstance(v, dict) and v.get("chess")
                ]
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

            from utils import LOCAL_DUMPS_DIR, LOCAL_GAMES_DIR, load_config, local_only_mode

            # Round + lineup change detection — cheap, runs on every ingest.
            self._detect_round_change(rows)
            self._detect_lineup_change(rows)

            # Look for dac_table.end_board — the server writes this once when
            # a match finishes. Saving it gives us a finished-match record
            # independent of the unreachable match_history_table.
            self._maybe_save_end_board(rows, LOCAL_GAMES_DIR)

            # Scan ranking_top_table for top players → upsert their profiles.
            # This is how we populate the player DB for everyone we haven't
            # personally played with.
            self._maybe_extract_ranking_top(rows)

            # Always snapshot the parsed dump to disk before doing anything
            # else — that way local testing has a record even if Supabase
            # is unreachable or disabled.
            try:
                LOCAL_DUMPS_DIR.mkdir(parents=True, exist_ok=True)
                ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                dump_path = LOCAL_DUMPS_DIR / f"{ts}.json"
                dump_path.write_text(json.dumps({
                    "captured_at": datetime.now().isoformat(),
                    "tables": tables,
                    "rows": rows,
                }, indent=2, ensure_ascii=False), encoding="utf-8")
                log.info("nettable: dump saved locally: %s (%d row(s))", dump_path.name, len(rows))
            except Exception as e:
                log.warning("nettable: local dump save failed: %s", e)

            # Cross-dump dedupe: only POST rows that actually changed since
            # the last successful capture. ranking_top alone is ~79 KB and
            # rarely changes mid-game — without this every dump uploads
            # the entire leaderboard.
            changed_rows = [
                r for r in rows
                if self._last_state.get(r["table_name"], {}).get(r["key"]) != r["raw"]
            ]
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
            self._emit({
                "type": "nettable_state",
                "state": self._last_state,
                "at": now_iso,
            })

            written = 0
            if local_only_mode():
                log.info(
                    "nettable: local_only — supabase POST skipped (%d changed, %d unchanged)",
                    len(changed_rows), skipped,
                )
            elif changed_rows:
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

def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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


_CHESS_ID_MAP_CACHE: dict[str, str] | None = None
_SYNERGY_ID_MAP_CACHE: dict[str, str] | None = None
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


def _transform_synergies(raw: str) -> str:
    """'is_mage:9,is_human:6' → 'Mage:9|Human:6'."""
    if not raw:
        return ""
    id_map = _load_synergy_id_map()
    out: list[str] = []
    for p in str(raw).replace("|", ",").split(","):
        p = p.strip()
        if not p:
            continue
        if ":" in p:
            sid, count = p.split(":", 1)
            display = id_map.get(sid.strip(), sid.strip())
            out.append(f"{display}:{count.strip()}")
        else:
            display = id_map.get(p, p)
            out.append(display)
    return "|".join(out)
