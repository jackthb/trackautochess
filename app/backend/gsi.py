"""Dota 2 Game State Integration listener for Auto Chess.

Runs a tiny HTTP server that receives JSON payloads from Dota 2's GSI.
When an Auto Chess game ends, fires a callback so the tray app can
capture and parse the screen.

Setup:
  1. Add -gamestateintegration to Dota 2 launch options.
  2. Copy the generated .cfg file to:
     <Steam>/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/

Debug mode (standalone):
  python gsi.py          # logs every payload to console + ~/.dac/gsi_debug.log
"""

import json
import logging
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

log = logging.getLogger("dac")

DEFAULT_PORT = 4001
DAC_WORKSHOP_ID = "1613886175"

# If no GSI payload arrives within this many seconds, treat is_dac_active() as
# stale → False. Dota's heartbeat cadence is 30s per the cfg, so 60s leaves
# room for one missed beat.
GSI_STALE_AFTER_SEC = 60.0

# Debug log for raw payloads — separate from main tracker log
GSI_DEBUG_LOG = Path.home() / ".dac" / "gsi_debug.log"


class _GSIHandler(BaseHTTPRequestHandler):
    """Handle POST requests from Dota 2 GSI."""

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        self.send_response(200)
        self.end_headers()

        try:
            data = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return

        self.server.gsi_callback(data)

    def log_message(self, format, *args):
        pass


class GSIServer:
    """Listens for Dota 2 GSI events and detects Auto Chess game end."""

    def __init__(self, on_game_end=None, port: int = DEFAULT_PORT, debug: bool = False):
        """
        Args:
            on_game_end: Called (with no args) when an Auto Chess game ends.
                         None in debug-only mode.
            port: Local port to listen on.
            debug: If True, log every raw payload.
        """
        self._on_game_end = on_game_end
        self._port = port
        self._debug = debug
        self._server = None
        self._thread = None
        self._prev_state = None
        self._fired = False
        self._payload_count = 0
        # Latest game state, for is_dac_active() consumers (nettable cascade
        # gate). Updated on every payload.
        self._latest_custom_game = ""
        self._latest_payload_monotonic = 0.0

    def start(self):
        """Start the GSI listener in a daemon thread."""
        self._server = HTTPServer(("127.0.0.1", self._port), _GSIHandler)
        self._server.gsi_callback = self._handle_payload
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            daemon=True,
            name="gsi-listener",
        )
        self._thread.start()
        log.info("GSI listener started on port %d (debug=%s)", self._port, self._debug)

    def stop(self):
        """Shut down the server."""
        if self._server:
            self._server.shutdown()

    def _handle_payload(self, data: dict):
        """Process a GSI payload."""
        self._payload_count += 1
        self._latest_payload_monotonic = time.monotonic()

        if self._debug:
            self._log_debug(data)

        map_data = data.get("map", {})
        game_state = map_data.get("game_state")
        custom_game = map_data.get("customgamename", "")
        self._latest_custom_game = custom_game or ""

        # Log state changes
        if game_state != self._prev_state:
            log.info("GSI: state changed: %s -> %s (custom_game=%r)",
                     self._prev_state, game_state, custom_game)

        # Only trigger callback for Auto Chess (identified by workshop ID in path)
        if self._on_game_end and DAC_WORKSHOP_ID in custom_game:
            if game_state == "DOTA_GAMERULES_STATE_POST_GAME" and not self._fired:
                log.info("GSI: Auto Chess game ended (state: %s -> %s)",
                         self._prev_state, game_state)
                self._fired = True
                self._on_game_end()
            elif game_state != "DOTA_GAMERULES_STATE_POST_GAME":
                self._fired = False

        self._prev_state = game_state

    def is_dac_active(self) -> bool:
        """True iff a recent GSI payload reports the player is in a DAC custom
        game. Used to gate the SendInput cascade in nettable_capture — pressing
        the cascade keys in non-DAC Dota matches both disrupts gameplay (PAUSE)
        and crashes the client (post-game dumpstringtable burst on tables that
        don't exist in this game mode)."""
        if self._latest_payload_monotonic == 0.0:
            return False
        if time.monotonic() - self._latest_payload_monotonic > GSI_STALE_AFTER_SEC:
            return False
        return DAC_WORKSHOP_ID in self._latest_custom_game

    def _log_debug(self, data: dict):
        """Write raw payload to debug log file."""
        # Extract the interesting top-level keys for the summary line
        map_data = data.get("map", {})
        player_data = data.get("player", {})
        summary = {
            "game_state": map_data.get("game_state"),
            "customgamename": map_data.get("customgamename"),
            "game_time": map_data.get("clock_time"),
            "player_name": player_data.get("name"),
        }
        log.info("GSI payload #%d: %s", self._payload_count, json.dumps(summary))

        # Full payload to debug file
        GSI_DEBUG_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(GSI_DEBUG_LOG, "a", encoding="utf-8") as f:
            f.write(f"--- payload #{self._payload_count} ---\n")
            f.write(json.dumps(data, indent=2))
            f.write("\n\n")


def generate_cfg(port: int = DEFAULT_PORT) -> str:
    """Return the contents of a GSI config file for Dota 2."""
    return f'''"DAC Tracker"
{{
    "uri"           "http://127.0.0.1:{port}"
    "timeout"       "5.0"
    "buffer"        "0.5"
    "throttle"      "1.0"
    "heartbeat"     "30.0"
    "data"
    {{
        "map"           "1"
        "player"        "1"
    }}
}}
'''


def find_gsi_cfg_path(dota_dir: Path) -> Path:
    """Return where our GSI cfg file lives inside a given Dota 2 install."""
    return (
        dota_dir
        / "game"
        / "dota"
        / "cfg"
        / "gamestate_integration"
        / "gamestate_integration_dac_tracker.cfg"
    )


def install_cfg(dota_dir: Path | None = None, port: int = DEFAULT_PORT) -> str | None:
    """Write the GSI cfg file to the Dota 2 directory if missing or stale.

    `dota_dir` should be the install root (e.g.
    ``…/steamapps/common/dota 2 beta``). If omitted, the function tries to
    find one via ``nettable_capture.find_dota_dir`` so a fresh user gets the
    file installed automatically on first run.

    Returns the cfg path on success, or None if no Dota install was found.
    Idempotent — only rewrites the file when the contents differ, so the
    file's mtime stays clean across restarts.
    """
    if dota_dir is None:
        # Local import avoids a circular dependency at module load time.
        from nettable_capture import find_dota_dir
        dota_dir = find_dota_dir()
    if dota_dir is None:
        log.warning("GSI: no Dota 2 install found, skipping cfg install")
        return None

    cfg_path = find_gsi_cfg_path(dota_dir)
    desired = generate_cfg(port)
    try:
        existing = cfg_path.read_text(encoding="utf-8") if cfg_path.exists() else None
    except OSError:
        existing = None
    if existing == desired:
        log.info("GSI config already present at %s", cfg_path)
        return str(cfg_path)
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(desired, encoding="utf-8")
    log.info("GSI config written to %s", cfg_path)
    return str(cfg_path)


if __name__ == "__main__":
    # Standalone debug mode — just log everything
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s  %(levelname)-5s  %(message)s",
        datefmt="%H:%M:%S",
    )
    log.setLevel(logging.DEBUG)

    print(f"GSI debug listener on port {DEFAULT_PORT}")
    print(f"Raw payloads will be written to: {GSI_DEBUG_LOG}")
    print("Make sure Dota 2 has -gamestateintegration in launch options.")
    print("Waiting for payloads... (Ctrl+C to stop)\n")

    server = GSIServer(on_game_end=None, debug=True)
    server.start()

    try:
        server._thread.join()
    except KeyboardInterrupt:
        print(f"\nStopped. {server._payload_count} payloads logged to {GSI_DEBUG_LOG}")
        server.stop()
