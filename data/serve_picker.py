"""Tiny local server for the sentinel picker.

Usage:
    python serve_picker.py
    # Opens http://localhost:8089/sentinel_picker.html
"""

import http.server
import json
import os
import sys
import base64
import webbrowser
from pathlib import Path
from urllib.parse import unquote

PORT = 8089
DATA_DIR = Path(__file__).parent


class PickerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DATA_DIR), **kwargs)

    def do_POST(self):
        if self.path == "/save-screenshot":
            length = int(self.headers["Content-Length"])
            body = json.loads(self.rfile.read(length))
            filename = body["filename"]
            data_url = body["dataUrl"]

            # Strip data URL prefix
            header, encoded = data_url.split(",", 1)
            img_bytes = base64.b64decode(encoded)

            dest = DATA_DIR / "screenshots" / filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(img_bytes)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"path": f"screenshots/{filename}"}).encode())
            print(f"  Saved screenshot: {dest}")
            return

        self.send_error(404)

    def log_message(self, format, *args):
        # Quieter logging
        if "GET" in str(args) and (".js" in str(args) or ".css" in str(args)):
            return
        super().log_message(format, *args)


if __name__ == "__main__":
    os.chdir(DATA_DIR)
    server = http.server.HTTPServer(("127.0.0.1", PORT), PickerHandler)
    url = f"http://localhost:{PORT}/sentinel_picker.html"
    print(f"Serving picker at {url}")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
