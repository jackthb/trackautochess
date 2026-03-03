"""Lightweight HTTP server for the detection review UI.

Endpoints:
    GET  /                  — serve review.html
    GET  /api/detections    — return detections.json
    GET  /api/crop          — return JPEG crop of screenshot region
    GET  /icons/units/<stem>.png — serve unit icon
    POST /api/review        — save review decision
    GET  /api/export/yolo   — export YOLO dataset

Usage:
    cd tracker && python review.py [--export-yolo] [--port 8765]
"""

import io
import json
import os
import sys
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
DETECTIONS_PATH = DATA_DIR / "detections.json"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
ICONS_DIR = DATA_DIR / "icons" / "units"
REVIEW_HTML = Path(__file__).parent / "review.html"
YOLO_DIR = DATA_DIR / "yolo"


def load_detections() -> dict:
    if not DETECTIONS_PATH.exists():
        return {"classes": [], "screenshots": []}
    return json.loads(DETECTIONS_PATH.read_text())


def save_detections(data: dict) -> None:
    DETECTIONS_PATH.write_text(json.dumps(data, indent=2))


TILE_SIZE = 640


def export_yolo(data: dict) -> dict:
    """Export reviewed detections as tiled YOLO dataset.

    Cuts 640x640 tiles around each detection so icons are large relative
    to input size. Multiple nearby detections share a tile.
    """
    import cv2

    classes = data["classes"]
    if not classes:
        return {"error": "No classes defined"}

    # Clean and create directories
    import shutil
    if YOLO_DIR.exists():
        shutil.rmtree(YOLO_DIR)
    images_dir = YOLO_DIR / "images" / "train"
    labels_dir = YOLO_DIR / "labels" / "train"
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    # Write data.yaml
    yaml_lines = [
        f"path: {YOLO_DIR.resolve()}",
        "train: images/train",
        "val: images/train",
        "",
        f"nc: {len(classes)}",
        f"names: {json.dumps(classes)}",
    ]
    (YOLO_DIR / "data.yaml").write_text("\n".join(yaml_lines) + "\n")

    total_labels = 0
    total_images = 0

    for screenshot in data["screenshots"]:
        filename = screenshot["file"]
        img_w = screenshot["width"]
        img_h = screenshot["height"]
        src = SCREENSHOTS_DIR / filename
        if not src.exists():
            continue

        # Collect approved detections with class info
        dets = []
        for det in screenshot["detections"]:
            if det["reviewed"] is not True:
                continue
            class_name = det["corrected"] if det["corrected"] is not None else det["predicted"]
            if class_name not in classes:
                continue
            dets.append((det, classes.index(class_name)))

        if not dets:
            continue

        img = cv2.imread(str(src))
        if img is None:
            continue

        # Generate tiles: for each detection, create a tile centered on it.
        # Group nearby detections into the same tile to avoid duplicates.
        used = set()  # track which detections are already in a tile
        tile_idx = 0
        stem = Path(filename).stem

        for i, (det, class_id) in enumerate(dets):
            if i in used:
                continue

            # Center tile on this detection
            cx = det["x"] + det["w"] // 2
            cy = det["y"] + det["h"] // 2
            tx0 = max(cx - TILE_SIZE // 2, 0)
            ty0 = max(cy - TILE_SIZE // 2, 0)
            tx1 = tx0 + TILE_SIZE
            ty1 = ty0 + TILE_SIZE
            # Clamp to image bounds
            if tx1 > img_w:
                tx0 = max(img_w - TILE_SIZE, 0)
                tx1 = img_w
            if ty1 > img_h:
                ty0 = max(img_h - TILE_SIZE, 0)
                ty1 = img_h

            tw = tx1 - tx0
            th = ty1 - ty0

            # Find all detections that fall within this tile
            labels = []
            for j, (d, cid) in enumerate(dets):
                dcx = d["x"] + d["w"] // 2
                dcy = d["y"] + d["h"] // 2
                if tx0 <= dcx < tx1 and ty0 <= dcy < ty1:
                    # Convert to tile-relative normalized coords
                    lcx = (dcx - tx0) / tw
                    lcy = (dcy - ty0) / th
                    lw = d["w"] / tw
                    lh = d["h"] / th
                    labels.append(f"{cid} {lcx:.6f} {lcy:.6f} {lw:.6f} {lh:.6f}")
                    used.add(j)

            if not labels:
                continue

            # Write tile image
            tile = img[ty0:ty1, tx0:tx1]
            tile_name = f"{stem}_t{tile_idx}.jpg"
            cv2.imwrite(str(images_dir / tile_name), tile, [cv2.IMWRITE_JPEG_QUALITY, 95])

            # Write label file
            label_file = labels_dir / f"{stem}_t{tile_idx}.txt"
            label_file.write_text("\n".join(labels) + "\n")

            total_labels += len(labels)
            total_images += 1
            tile_idx += 1

    return {
        "images": total_images,
        "labels": total_labels,
        "classes": len(classes),
        "output_dir": str(YOLO_DIR.resolve()),
    }


class ReviewHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Quieter logging
        pass

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, content_type):
        if not path.exists():
            self.send_error(404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = dict(urllib.parse.parse_qsl(parsed.query))

        if path == "/" or path == "/index.html":
            self._send_file(REVIEW_HTML, "text/html")

        elif path == "/api/detections":
            self._send_json(load_detections())

        elif path == "/api/crop":
            self._handle_crop(params)

        elif path.startswith("/icons/units/"):
            icon_name = path.split("/")[-1]
            self._send_file(ICONS_DIR / icon_name, "image/png")

        elif path == "/api/export/yolo":
            data = load_detections()
            result = export_yolo(data)
            self._send_json(result)

        else:
            self.send_error(404)

    def _handle_crop(self, params):
        try:
            import cv2
            filename = params["file"]
            x = int(params["x"])
            y = int(params["y"])
            w = int(params["w"])
            h = int(params["h"])
            pad = int(params.get("pad", "100"))
        except (KeyError, ValueError) as e:
            self.send_error(400, str(e))
            return

        img_path = SCREENSHOTS_DIR / filename
        if not img_path.exists():
            self.send_error(404, f"Screenshot not found: {filename}")
            return

        img = cv2.imread(str(img_path))
        if img is None:
            self.send_error(500, "Failed to read image")
            return

        ih, iw = img.shape[:2]
        # Crop with padding, clamped to image bounds
        cx0 = max(x - pad, 0)
        cy0 = max(y - pad, 0)
        cx1 = min(x + w + pad, iw)
        cy1 = min(y + h + pad, ih)
        crop = img[cy0:cy1, cx0:cx1]

        # Encode as JPEG
        _, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
        body = buf.tobytes()

        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        # Return crop offset so UI can draw bbox at correct position
        self.send_header("X-Crop-Offset-X", str(cx0))
        self.send_header("X-Crop-Offset-Y", str(cy0))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/review":
            content_len = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_len))
            self._handle_review(body)
        else:
            self.send_error(404)

    def _handle_review(self, body):
        """Save a review decision.

        body: {file: str, detection_id: int, action: "approve"|"correct"|"reject",
               corrected?: str}
        """
        data = load_detections()
        filename = body.get("file")
        det_id = body.get("detection_id")
        action = body.get("action")

        for screenshot in data["screenshots"]:
            if screenshot["file"] != filename:
                continue
            for det in screenshot["detections"]:
                if det["id"] != det_id:
                    continue

                if action == "approve":
                    det["reviewed"] = True
                    det["corrected"] = None
                elif action == "correct":
                    det["reviewed"] = True
                    det["corrected"] = body.get("corrected")
                elif action == "reject":
                    det["reviewed"] = False
                    det["corrected"] = None
                elif action == "undo":
                    det["reviewed"] = None
                    det["corrected"] = None

                save_detections(data)
                self._send_json({"ok": True})
                return

        self._send_json({"error": "Detection not found"}, status=404)


def main():
    if "--export-yolo" in sys.argv:
        data = load_detections()
        result = export_yolo(data)
        if "error" in result:
            print(f"Error: {result['error']}")
            sys.exit(1)
        print(f"Exported YOLO dataset:")
        print(f"  Images: {result['images']}")
        print(f"  Labels: {result['labels']}")
        print(f"  Classes: {result['classes']}")
        print(f"  Output: {result['output_dir']}")
        return

    port = 8765
    for i, arg in enumerate(sys.argv):
        if arg == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])

    server = HTTPServer(("", port), ReviewHandler)
    print(f"Review server running at http://localhost:{port}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
