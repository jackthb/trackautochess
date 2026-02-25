"""Auto-update checker for DAC Tracker.

Checks GitHub Releases for newer versions and notifies via callback.
"""

import re
import threading
import time
import webbrowser

__version__ = "0.1.0"

GITHUB_OWNER = "jackc"
GITHUB_REPO = "dac-tools"
CHECK_INTERVAL = 6 * 3600  # 6 hours


def _parse_semver(tag: str) -> tuple[int, ...]:
    """Parse 'v1.2.3' or '1.2.3' into (1, 2, 3)."""
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", tag)
    if not m:
        return (0, 0, 0)
    return tuple(int(x) for x in m.groups())


def check_for_update() -> dict | None:
    """Check GitHub for a newer release.

    Returns {"tag": "v1.2.0", "url": "https://..."} if update available,
    or None if up to date or on error.
    """
    import urllib.request
    import json

    url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github.v3+json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception:
        return None

    remote_tag = data.get("tag_name", "")
    html_url = data.get("html_url", "")
    if not remote_tag:
        return None

    if _parse_semver(remote_tag) > _parse_semver(__version__):
        return {"tag": remote_tag, "url": html_url}
    return None


def open_release_page(url: str) -> None:
    """Open the GitHub release page in the default browser."""
    webbrowser.open(url)


def start_update_loop(on_update_available: callable) -> threading.Thread:
    """Run update checks on startup + every CHECK_INTERVAL in a daemon thread.

    on_update_available(tag, url) is called when a newer version is found.
    """
    def _loop():
        while True:
            result = check_for_update()
            if result:
                on_update_available(result["tag"], result["url"])
            time.sleep(CHECK_INTERVAL)

    t = threading.Thread(target=_loop, daemon=True, name="updater")
    t.start()
    return t
