"""Debug script: visualise star-level detection for each matched unit.

Generates data/star_debug.html showing:
  1. Full unit region with detected squares highlighted
  2. Per-unit: slot crop, nearest star cluster, detected star level
"""
import sys, base64
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import cv2
import numpy as np
from cv_parser import (
    MM_COL_UNITS, UNIT_ICON_SCALES, UNIT_MATCH_THRESHOLD,
    STAR_SQUARE_SIZE, STAR_SQUARE_MIN_AREA, STAR_SQUARE_MAX_GAP,
    _load_templates_multiscale, _find_my_matches_rows, _match_unit_grid,
    _find_star_clusters, _assign_stars,
)
from utils import crop as _crop


def img_to_b64(img, scale=1):
    if scale != 1:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    _, buf = cv2.imencode('.png', img)
    return base64.b64encode(buf).decode()


def render_row(img, row_idx, row_y0, row_y1, unit_templates):
    unit_region = _crop(img, MM_COL_UNITS[0], row_y0, MM_COL_UNITS[1], row_y1)
    ur_h, ur_w = unit_region.shape[:2]

    matches = _match_unit_grid(unit_region, unit_templates, threshold=UNIT_MATCH_THRESHOLD)
    clusters = _find_star_clusters(unit_region, debug=False)
    star_map = _assign_stars(matches, clusters)

    # Build annotated overview: green boxes for matches, colored circles for star squares
    overview = unit_region.copy()
    icon_h = UNIT_ICON_SCALES[len(UNIT_ICON_SCALES) // 2]
    for stem, score, ux, uy in matches:
        cv2.rectangle(overview, (ux, uy), (ux + icon_h, uy + icon_h), (0, 255, 0), 1)

    cluster_colors = [(0, 255, 255), (255, 0, 255), (255, 255, 0),
                      (0, 200, 200), (200, 0, 200), (200, 200, 0),
                      (100, 255, 100), (255, 100, 100), (100, 100, 255)]
    for ci, cluster in enumerate(clusters):
        color = cluster_colors[ci % len(cluster_colors)]
        for cx, cy in cluster:
            cv2.circle(overview, (cx, cy), 6, color, 2)
            cv2.circle(overview, (cx, cy), 1, color, -1)
    overview_b64 = img_to_b64(overview, scale=3)

    # Also show the raw bright mask
    hsv = cv2.cvtColor(unit_region, cv2.COLOR_BGR2HSV)
    s_ch, v_ch = hsv[:, :, 1], hsv[:, :, 2]
    bright_mask = ((s_ch > 80) & (v_ch > 100)).astype(np.uint8) * 255
    # Mark accepted squares with green rectangles on the mask
    mask_vis = cv2.cvtColor(bright_mask, cv2.COLOR_GRAY2BGR)
    contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = cv2.contourArea(c)
        is_star = (STAR_SQUARE_SIZE - 2 <= w <= STAR_SQUARE_SIZE + 2
                   and STAR_SQUARE_SIZE - 2 <= h <= STAR_SQUARE_SIZE + 2
                   and area >= STAR_SQUARE_MIN_AREA)
        color = (0, 255, 0) if is_star else (0, 0, 100)
        cv2.rectangle(mask_vis, (x, y), (x + w, y + h), color, 1)
    mask_b64 = img_to_b64(mask_vis, scale=3)

    # Per-unit cards
    cards_html = ""
    for mi, (stem, score, ux, uy) in enumerate(matches):
        stars = star_map.get(mi, 1)
        star_color = {1: "#aaa", 2: "#0af", 3: "#fa0"}.get(stars, "#fff")

        # Find which cluster was matched
        best_cluster = None
        best_dist = float("inf")
        for cluster in clusters:
            cx_mean = sum(x for x, _ in cluster) / len(cluster)
            d = abs(cx_mean - ux)
            if d < best_dist:
                best_dist = d
                best_cluster = cluster

        cluster_info = ""
        if best_cluster and best_dist < 60:
            pts = ", ".join(f"({x},{y})" for x, y in best_cluster)
            cluster_info = f'<div style="color:#888;font-size:10px">cluster: [{pts}] dist={best_dist:.0f}px</div>'
        else:
            cluster_info = f'<div style="color:#666;font-size:10px">no cluster within 60px (nearest={best_dist:.0f}px)</div>'

        # Crop around icon
        crop_y0 = max(uy - 2, 0)
        crop_y1 = min(uy + icon_h + 16, ur_h)
        crop_x0 = max(ux - 4, 0)
        crop_x1 = min(ux + icon_h + 6, ur_w)
        slot_crop = unit_region[crop_y0:crop_y1, crop_x0:crop_x1]
        slot_b64 = img_to_b64(slot_crop, scale=4)

        cards_html += f"""
        <div style="border:1px solid #444;padding:10px;margin:6px;background:#1a1a1a;border-radius:8px;display:inline-block;vertical-align:top">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:20px">
                <span style="color:#ccc;font-weight:bold">{stem}</span>
                <span style="color:{star_color};font-size:18px">{stars}★</span>
            </div>
            <div style="color:#666;font-size:10px">match=({ux},{uy}) score={score:.3f}</div>
            {cluster_info}
            <img src="data:image/png;base64,{slot_b64}" style="border:1px solid #555;margin-top:4px">
        </div>"""

    detected_summary = ", ".join(
        f"{stem}{'(' + str(star_map.get(mi, 1)) + ')' if star_map.get(mi, 1) > 1 else ''}"
        for mi, (stem, _, ux, _) in enumerate(matches)
    )

    return f"""
    <div style="border:2px solid #555;padding:16px;margin:16px 0;background:#151515;border-radius:10px">
        <h2>Row {row_idx + 1} <span style="color:#888;font-size:14px">({len(matches)} units, {len(clusters)} star clusters)</span></h2>
        <p style="color:#0f0;font-size:13px">{detected_summary}</p>
        <h3>Overview (3x) — <span style="color:#0f0">green rect</span>=icon, <span style="color:#ff0">circles</span>=star squares</h3>
        <img src="data:image/png;base64,{overview_b64}" style="border:2px solid #888"><br>
        <h3>Bright mask (3x) — <span style="color:#0f0">green</span>=accepted 9x9 square, <span style="color:#600">dark red</span>=rejected</h3>
        <img src="data:image/png;base64,{mask_b64}" style="border:2px solid #888"><br>
        <h3>Per-unit</h3>
        {cards_html}
    </div>"""


def main():
    screenshot = Path(__file__).parent.parent / "data" / "screenshots" / "my_matches.jpg"
    icons_dir = Path(__file__).parent.parent / "data" / "icons" / "units"
    img = cv2.imread(str(screenshot))
    if img is None:
        print(f"ERROR: cannot read {screenshot}")
        return
    h, w = img.shape[:2]

    unit_templates = _load_templates_multiscale(icons_dir, UNIT_ICON_SCALES, inner_frac=0.85, color=True)
    print(f"Loaded {len(unit_templates)} unit templates")

    rows = _find_my_matches_rows(img, debug=True)
    print(f"Found {len(rows)} rows")

    rows_html = ""
    for i, (row_y0, row_y1) in enumerate(rows):
        print(f"Processing row {i+1}/{len(rows)}...")
        rows_html += render_row(img, i, row_y0, row_y1, unit_templates)

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Star Detection Debug</title>
<style>body{{background:#111;color:#eee;font-family:monospace;padding:20px}}
h2{{margin:0 0 8px}}h3{{margin:12px 0 6px;color:#aaa}}</style>
</head><body>
<h1>Star Detection Debug</h1>
<p style="color:#888">Screenshot: {screenshot.name} ({w}x{h}), {len(rows)} rows</p>
<p style="color:#888">Square detection: {STAR_SQUARE_SIZE}x{STAR_SQUARE_SIZE}px, area≥{STAR_SQUARE_MIN_AREA},
   cluster gap≤{STAR_SQUARE_MAX_GAP}px, HSV: S&gt;80 &amp; V&gt;100</p>
{rows_html}
</body></html>"""

    out = Path(__file__).parent.parent / "data" / "star_debug.html"
    out.write_text(html)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
