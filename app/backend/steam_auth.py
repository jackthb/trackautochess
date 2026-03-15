"""Steam OpenID 2.0 login flow.

Opens the user's browser to Steam login, receives the callback on a local
HTTP server, verifies the assertion, and returns the steamid64.

All stdlib — no new dependencies.
"""

import re
import threading
import webbrowser
import xml.etree.ElementTree as ET
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import urlopen, Request

STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
RETURN_PORT = 27034


class _CallbackHandler(BaseHTTPRequestHandler):
    """Handle the Steam OpenID callback."""

    steamid: str | None = None

    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)

        # Extract claimed_id → steamid64
        claimed = params.get("openid.claimed_id", [""])[0]
        match = re.search(r"/id/(\d+)$", claimed)
        if not match:
            self._respond(400, "Login failed — no Steam ID found.")
            return

        steamid = match.group(1)

        # Verify assertion with Steam
        if not _verify_assertion(params):
            self._respond(400, "Login failed — verification rejected.")
            return

        _CallbackHandler.steamid = steamid
        self._respond(200, "Login successful! You can close this tab.")

        # Shut down server in background so we don't block the response
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def _respond(self, code: int, message: str):
        self.send_response(code)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h2>{message}</h2></body></html>"""
        self.wfile.write(html.encode())

    def log_message(self, format, *args):
        # Silence default stderr logging
        pass


def _verify_assertion(params: dict) -> bool:
    """POST params back to Steam with mode=check_authentication."""
    verify_params = {}
    for key, values in params.items():
        verify_params[key] = values[0] if isinstance(values, list) else values
    verify_params["openid.mode"] = "check_authentication"

    data = urlencode(verify_params).encode()
    req = Request(STEAM_OPENID_URL, data=data)
    try:
        with urlopen(req, timeout=15) as resp:
            body = resp.read().decode()
            return "is_valid:true" in body
    except Exception as e:
        print(f"[steam] verification error: {e}")
        return False


def steam_login(timeout: int = 120) -> str | None:
    """Run the full Steam OpenID login flow.

    Returns steamid64 on success, None on timeout/failure.
    """
    _CallbackHandler.steamid = None

    # Try preferred port, fall back to OS-assigned
    try:
        server = HTTPServer(("127.0.0.1", RETURN_PORT), _CallbackHandler)
    except OSError:
        server = HTTPServer(("127.0.0.1", 0), _CallbackHandler)

    port = server.server_address[1]
    return_url = f"http://127.0.0.1:{port}"

    openid_params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_url,
        "openid.realm": return_url,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    login_url = f"{STEAM_OPENID_URL}?{urlencode(openid_params)}"

    print(f"[steam] Opening browser for Steam login (port {port})...")
    webbrowser.open(login_url)

    server.timeout = timeout
    # Serve until callback shuts us down or timeout
    server.handle_request()
    # Handle the shutdown request if callback triggered it
    server.server_close()

    return _CallbackHandler.steamid


def fetch_steam_name(steamid64: str) -> str | None:
    """Fetch display name from Steam community XML profile (no API key needed)."""
    url = f"https://steamcommunity.com/profiles/{steamid64}/?xml=1"
    try:
        with urlopen(url, timeout=10) as resp:
            tree = ET.parse(resp)
            node = tree.find("steamID")
            if node is not None and node.text:
                return node.text.strip()
    except Exception as e:
        print(f"[steam] name fetch error: {e}")
    return None


if __name__ == "__main__":
    sid = steam_login()
    if sid:
        name = fetch_steam_name(sid)
        print(f"Steam ID: {sid}")
        print(f"Name: {name}")
    else:
        print("Login failed or timed out.")
