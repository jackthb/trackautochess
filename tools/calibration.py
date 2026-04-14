"""Region calibration & debug tool for DAC Tracker.

Serves a web UI for calibrating screen regions and running the CV debug
pipeline on screenshots. Imports directly from app/backend/.

Usage:
    cd dac-tools
    python tools/calibration.py [--port 8080]
"""

import argparse
import base64
import json
import logging
import sys
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "app" / "backend"
DATA = ROOT / "data"
SCREENSHOTS = DATA / "screenshots"
DAC_SCREENSHOTS = Path.home() / ".dac" / "screenshots"

STEAM_SCREENSHOT_DIRS = []
steam_base = Path("C:/Program Files (x86)/Steam/userdata")
if steam_base.exists():
    for user_dir in steam_base.iterdir():
        dota_ss = user_dir / "760" / "remote" / "570" / "screenshots"
        if dota_ss.exists():
            STEAM_SCREENSHOT_DIRS.append(dota_ss)

sys.path.insert(0, str(BACKEND))

TESSERACT = ROOT / "tesseract-portable" / "tesseract.exe"
if TESSERACT.exists():
    import os
    os.environ["PATH"] = str(TESSERACT.parent) + os.pathsep + os.environ.get("PATH", "")

log = logging.getLogger("calibration")
logging.basicConfig(level=logging.INFO, format="%(message)s")


def run_debug(screenshot_path: str) -> dict:
    import cv2
    import numpy as np
    from cv_parser import detect_screen_type

    img = cv2.imread(screenshot_path)
    if img is None:
        return {"error": f"Cannot read {screenshot_path}"}

    h, w = img.shape[:2]
    screen_type = detect_screen_type(img)

    result = {
        "width": w,
        "height": h,
        "screen_type": screen_type,
        "rows": [],
    }

    if screen_type == "my_matches":
        from cv_parser import (
            _find_my_matches_rows,
            _parse_my_matches_row,
            _load_templates_multiscale,
            UNIT_ICON_SCALES,
            RELIC_ICON_SCALES,
            MM_SYNERGY_ICON_SCALES,
        )
        from utils import ICONS_DIR, DATA_DIR, unit_stem as _unit_stem

        units_path = DATA_DIR / "units.json"
        units_data = json.loads(units_path.read_text())["units"] if units_path.exists() else {}
        stem_to_name = {_unit_stem(name): name for name in units_data}

        unit_templates = _load_templates_multiscale(
            ICONS_DIR / "units", UNIT_ICON_SCALES, inner_frac=0.85, color=True)
        relic_templates = _load_templates_multiscale(
            ICONS_DIR / "relics", RELIC_ICON_SCALES, inner_frac=1.0, color=True)
        syn_templates = _load_templates_multiscale(
            ICONS_DIR / "synergies", MM_SYNERGY_ICON_SCALES)

        rows = _find_my_matches_rows(img)
        for i, (y0, y1) in enumerate(rows):
            row_data = _parse_my_matches_row(
                img, y0, y1,
                unit_templates, relic_templates, syn_templates, ICONS_DIR,
                units_data, stem_to_name,
                debug=False, row_idx=i,
            )
            row_data["y0"] = y0
            row_data["y1"] = y1
            result["rows"].append(row_data)

    elif screen_type == "game_over":
        from cv_parser import parse_game_over
        game_data = parse_game_over(img)
        result["game_data"] = game_data

    return result


def run_sentinel_test(screenshot_path: str, region: dict) -> dict:
    import cv2
    import numpy as np

    img = cv2.imread(screenshot_path)
    if img is None:
        return {"error": f"Cannot read {screenshot_path}"}

    h, w = img.shape[:2]
    x0 = int(region["x0"] * w)
    y0 = int(region["y0"] * h)
    x1 = int(region["x1"] * w)
    y1 = int(region["y1"] * h)
    crop = img[y0:y1, x0:x1]

    results = {}
    for template_name in ["sentinel_ref_final_ranking.png", "sentinel_ref_round_start.png"]:
        template_path = DATA / template_name
        if not template_path.exists():
            continue
        template = cv2.imread(str(template_path), cv2.IMREAD_GRAYSCALE)
        crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop

        th, tw = template.shape[:2]
        ch, cw = crop_gray.shape[:2]
        if tw > cw or th > ch:
            results[template_name] = {"score": 0, "error": "template larger than crop"}
            continue

        match = cv2.matchTemplate(crop_gray, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(match)
        results[template_name] = {"score": round(float(max_val), 4), "location": list(max_loc)}

    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
    crop_b64 = base64.b64encode(buf).decode() if ok else ""

    return {"results": results, "crop": crop_b64}


class CalibrationHandler(SimpleHTTPRequestHandler):
    def _resolve_screenshot(self, name):
        for d in [SCREENSHOTS, DAC_SCREENSHOTS] + STEAM_SCREENSHOT_DIRS:
            p = d / name
            if p.exists():
                return p
        return None

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/" or parsed.path == "":
            html_path = ROOT / "tools" / "calibration.html"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html_path.read_bytes())

        elif parsed.path == "/api/screenshots":
            import struct

            groups = []
            def _jpeg_size(fp):
                with open(fp, "rb") as fh:
                    if fh.read(2) != b"\xff\xd8":
                        return None
                    while True:
                        marker = fh.read(2)
                        if len(marker) < 2 or marker[0] != 0xFF:
                            return None
                        if marker[1] in (0xC0, 0xC2):
                            fh.read(3)
                            h = struct.unpack(">H", fh.read(2))[0]
                            w = struct.unpack(">H", fh.read(2))[0]
                            return w, h
                        size = struct.unpack(">H", fh.read(2))[0]
                        fh.read(size - 2)

            def _png_size(fp):
                with open(fp, "rb") as fh:
                    sig = fh.read(8)
                    if sig[:4] != b"\x89PNG":
                        return None
                    fh.read(4)
                    fh.read(4)
                    w = struct.unpack(">I", fh.read(4))[0]
                    h = struct.unpack(">I", fh.read(4))[0]
                    return w, h

            def detect_ar(filepath):
                try:
                    ext = filepath.suffix.lower()
                    if ext in (".jpg", ".jpeg"):
                        dims = _jpeg_size(filepath)
                    elif ext == ".png":
                        dims = _png_size(filepath)
                    else:
                        return None
                    if not dims:
                        return None
                    w, h = dims
                    return "21:9" if w / h > 2.0 else "16:9"
                except Exception:
                    return None

            qs = parse_qs(parsed.query)
            ar_filter = qs.get("ar", [None])[0]

            def scan_dir(directory, label):
                items = []
                if directory.exists():
                    for f in sorted(directory.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
                        if f.suffix.lower() in (".jpg", ".jpeg", ".png"):
                            ar = detect_ar(f)
                            if ar_filter and ar and ar != ar_filter:
                                continue
                            items.append({"name": f.name, "path": str(f), "size": f.stat().st_size, "ar": ar})
                if items:
                    groups.append({"label": label, "files": items})

            scan_dir(SCREENSHOTS, "Reference")
            scan_dir(DAC_SCREENSHOTS, "DAC Tracker")
            for sd in STEAM_SCREENSHOT_DIRS:
                scan_dir(sd, f"Steam ({sd.parts[-4]})")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(groups).encode())

        elif parsed.path.startswith("/screenshots/"):
            rel = parsed.path[len("/screenshots/"):]
            file_path = self._resolve_screenshot(rel)
            if file_path and file_path.exists():
                self.send_response(200)
                ct = "image/jpeg" if file_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                self.send_header("Content-Type", ct)
                self.end_headers()
                self.wfile.write(file_path.read_bytes())
            else:
                self.send_error(404)

        elif parsed.path.startswith("/data/"):
            rel = parsed.path[len("/data/"):]
            file_path = DATA / rel
            if file_path.exists() and file_path.is_file():
                self.send_response(200)
                ct = "image/png" if file_path.suffix == ".png" else "application/octet-stream"
                self.send_header("Content-Type", ct)
                self.end_headers()
                self.wfile.write(file_path.read_bytes())
            else:
                self.send_error(404)

        elif parsed.path == "/api/config":
            config_path = DATA / "regions_config.json"
            if config_path.exists():
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(config_path.read_bytes())
            else:
                self.send_error(404)

        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_len)) if content_len else {}

        if parsed.path == "/api/config":
            config_path = DATA / "regions_config.json"
            config_path.write_text(json.dumps(body, indent=2))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())

        elif parsed.path == "/api/debug":
            screenshot = body.get("screenshot", "")
            if not screenshot or not Path(screenshot).exists():
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "screenshot not found"}).encode())
                return
            try:
                result = run_debug(screenshot)
            except Exception as e:
                log.exception("debug error")
                result = {"error": str(e)}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        elif parsed.path == "/api/sentinel-test":
            screenshot = body.get("screenshot", "")
            region = body.get("region", {})
            if not screenshot or not Path(screenshot).exists():
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "screenshot not found"}).encode())
                return
            try:
                result = run_sentinel_test(screenshot, region)
            except Exception as e:
                log.exception("sentinel test error")
                result = {"error": str(e)}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        else:
            self.send_error(404)

    def log_message(self, format, *args):
        log.info(format % args)


def main():
    parser = argparse.ArgumentParser(description="DAC Region Calibration Tool")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    server = HTTPServer(("127.0.0.1", args.port), CalibrationHandler)
    url = f"http://localhost:{args.port}"
    log.info(f"Calibration tool running at {url}")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
