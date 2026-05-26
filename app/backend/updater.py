"""Auto-update system for DAC Tracker.

Checks GitHub Releases for newer versions, downloads the new .exe,
and performs a self-replacing restart via a helper .bat script.
"""

import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

__version__ = "0.0.0-dev"

GITHUB_OWNER = "jackthb"
GITHUB_REPO = "dac-tools"
CHECK_INTERVAL = 6 * 3600


def is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def _parse_semver(tag: str) -> tuple[int, ...]:
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", tag)
    if not m:
        return (0, 0, 0)
    return tuple(int(x) for x in m.groups())


def check_for_update() -> dict | None:
    import httpx
    url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
    try:
        resp = httpx.get(url, headers={"Accept": "application/vnd.github.v3+json"}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    remote_tag = data.get("tag_name", "")
    html_url = data.get("html_url", "")
    if not remote_tag:
        return None
    if _parse_semver(remote_tag) <= _parse_semver(__version__):
        return None

    for asset in data.get("assets", []):
        if asset["name"].lower().endswith(".exe"):
            return {
                "tag": remote_tag,
                "download_url": asset["browser_download_url"],
                "html_url": html_url,
            }
    return None


def download_update(download_url: str, dest: Path) -> Path:
    import httpx
    with httpx.stream("GET", download_url, follow_redirects=True, timeout=120) as resp:
        resp.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in resp.iter_bytes(chunk_size=65536):
                f.write(chunk)
    return dest


def apply_update_and_restart(new_exe: Path) -> None:
    current_exe = Path(sys.executable)
    bat_path = current_exe.parent / "_dac_update.bat"
    pid = os.getpid()

    bat_script = f"""@echo off
:wait
tasklist /FI "PID eq {pid}" 2>NUL | find /I "{pid}" >NUL
if not errorlevel 1 (
    timeout /t 1 /nobreak >NUL
    goto wait
)
if exist "{current_exe}" (
    del /f "{current_exe.parent / 'DACTracker_old.exe'}" >NUL 2>&1
    rename "{current_exe}" "DACTracker_old.exe"
)
rename "{new_exe}" "{current_exe.name}"
start "" "{current_exe}"
timeout /t 2 /nobreak >NUL
del /f "{current_exe.parent / 'DACTracker_old.exe'}" >NUL 2>&1
del /f "%~f0" >NUL 2>&1
"""
    bat_path.write_text(bat_script)

    CREATE_NEW_PROCESS_GROUP = 0x00000200
    DETACHED_PROCESS = 0x00000008
    subprocess.Popen(
        ["cmd", "/c", str(bat_path)],
        creationflags=CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS,
        close_fds=True,
    )
    sys.exit(0)


def start_update_loop(on_update_available: callable) -> threading.Thread:
    def _loop():
        while True:
            result = check_for_update()
            if result:
                on_update_available(result)
            time.sleep(CHECK_INTERVAL)

    t = threading.Thread(target=_loop, daemon=True, name="updater")
    t.start()
    return t
