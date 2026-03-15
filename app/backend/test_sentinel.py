"""Test sentinel template matching against local screenshots.

Generates an HTML report showing match scores for each image.

Usage:
    python test_sentinel.py [screenshot_dir]
"""

import base64
import sys
from io import BytesIO
from pathlib import Path
from datetime import datetime

import cv2
import numpy as np
from PIL import Image

REF_DIR = Path(__file__).resolve().parent.parent.parent / "data"
TEMPLATE_PATH = REF_DIR / "sentinel_ref_final_ranking.png"
MATCH_THRESHOLD = 0.70

SEARCH_REGION = {
    "x0": 0.0,
    "y0": 0.20,
    "x1": 0.15,
    "y1": 0.35,
}


def img_to_b64(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def arr_to_b64(arr):
    img = Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))
    return img_to_b64(img)


def test_image(img_path, tmpl_gray):
    img = cv2.imread(str(img_path))
    if img is None:
        return None
    h, w = img.shape[:2]

    # Crop search region
    x0 = int(SEARCH_REGION["x0"] * w)
    y0 = int(SEARCH_REGION["y0"] * h)
    x1 = int(SEARCH_REGION["x1"] * w)
    y1 = int(SEARCH_REGION["y1"] * h)
    region = img[y0:y1, x0:x1]

    # Scale template to match this image's resolution
    tmpl_scaled_h = int(47 * h / 1440)
    th, tw = tmpl_gray.shape[:2]
    scale = tmpl_scaled_h / th
    if abs(scale - 1.0) > 0.01:
        scaled = cv2.resize(tmpl_gray, (int(tw * scale), int(th * scale)), interpolation=cv2.INTER_AREA)
    else:
        scaled = tmpl_gray

    region_gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    result = cv2.matchTemplate(region_gray, scaled, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)

    matched = max_val >= MATCH_THRESHOLD

    # Draw match location on region
    region_marked = region.copy()
    sh, sw = scaled.shape[:2]
    cv2.rectangle(region_marked, max_loc, (max_loc[0] + sw, max_loc[1] + sh), (0, 255, 0) if matched else (0, 0, 255), 2)

    # Thumbnail of full image
    thumb_w = 500
    thumb_h = int(thumb_w * h / w)
    thumb = cv2.resize(img, (thumb_w, thumb_h))

    return {
        "path": img_path,
        "size": (w, h),
        "score": max_val,
        "matched": matched,
        "region_b64": arr_to_b64(region_marked),
        "thumb_b64": arr_to_b64(thumb),
    }


def main():
    screenshots_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REF_DIR / "screenshots"
    if not screenshots_dir.exists():
        print(f"Directory not found: {screenshots_dir}")
        sys.exit(1)

    tmpl = cv2.imread(str(TEMPLATE_PATH))
    if tmpl is None:
        print(f"Template not found: {TEMPLATE_PATH}")
        sys.exit(1)
    tmpl_gray = cv2.cvtColor(tmpl, cv2.COLOR_BGR2GRAY)

    images = sorted(screenshots_dir.glob("*.jpg")) + sorted(screenshots_dir.glob("*.png"))
    print(f"Testing {len(images)} images against {TEMPLATE_PATH.name}...")

    results = []
    for img_path in images:
        r = test_image(img_path, tmpl_gray)
        if r:
            results.append(r)
            status = "MATCH" if r["matched"] else "     "
            print(f"  {status} {r['score']:.3f}  {r['path'].name}")

    # Sort: matches first, then by score descending
    results.sort(key=lambda r: (-r["matched"], -r["score"]))

    tmpl_b64 = arr_to_b64(tmpl)
    rows_html = []
    for r in results:
        color = "#4a4" if r["matched"] else "#a44"
        rows_html.append(f"""
        <div style="border:1px solid #444;padding:10px;margin:8px 0;border-left:4px solid {color};display:flex;gap:20px;align-items:start">
          <div style="min-width:120px">
            <p><b>{r['score']:.3f}</b></p>
            <p style="color:{color}">{'MATCH' if r['matched'] else 'NO MATCH'}</p>
            <p style="font-size:0.8em">{r['path'].name}<br>{r['size'][0]}x{r['size'][1]}</p>
          </div>
          <div>
            <p>Search region (match highlighted):</p>
            <img src="data:image/png;base64,{r['region_b64']}" style="max-height:200px;border:1px solid #666">
          </div>
          <div>
            <p>Full screenshot:</p>
            <img src="data:image/png;base64,{r['thumb_b64']}" style="max-height:200px;border:1px solid #666">
          </div>
        </div>""")

    html = f"""<!DOCTYPE html>
<html><head><title>Sentinel Test Report</title></head>
<body style="background:#1a1a1a;color:#eee;font-family:monospace;padding:20px;max-width:1400px;margin:0 auto">
<h1>Sentinel Template Match Report</h1>
<p>Generated: {datetime.now().isoformat()}</p>
<p>Template: {TEMPLATE_PATH.name} | Threshold: {MATCH_THRESHOLD} | Images: {len(results)}</p>
<div style="margin:10px 0">
  <p><b>Template image:</b></p>
  <img src="data:image/png;base64,{tmpl_b64}" style="image-rendering:pixelated;border:2px solid #666;min-width:200px">
</div>
<p>Matches: {sum(1 for r in results if r['matched'])}/{len(results)}</p>
<hr>
{''.join(rows_html)}
</body></html>"""

    out = REF_DIR / "sentinel_test_report.html"
    out.write_text(html, encoding="utf-8")
    matches = sum(1 for r in results if r["matched"])
    print(f"\nReport: {out}")
    print(f"{matches}/{len(results)} matched")


if __name__ == "__main__":
    main()
