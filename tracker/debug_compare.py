"""Debug script: show unit matching for ALL rows in my_matches.jpg.

Uses the same per-slot matching as the parser. One code path, one truth.
"""
import sys, base64
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import cv2
import numpy as np
from cv_parser import (
    MM_COL_UNITS, MM_UNIT_GRID_START_FRAC, MM_UNIT_GRID_SPACING_FRAC,
    MM_UNIT_MAX_SLOTS, MM_UNIT_SPLIT_Y, MM_UNIT_ONE_ROW_Y,
    UNIT_ICON_SCALES, UNIT_MATCH_THRESHOLD,
    MM_COL_PLACEMENT,
    _load_templates_multiscale, _find_my_matches_rows,
)
from utils import crop as _crop

def img_to_b64(img, scale=1):
    if scale != 1:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    _, buf = cv2.imencode('.png', img)
    return base64.b64encode(buf).decode()

def match_slot_top5(slot_img, templates):
    """Match templates against a single slot crop. Returns top 5 (name, score, tmpl)."""
    slot_bgr = slot_img if len(slot_img.shape) == 3 else cv2.cvtColor(slot_img, cv2.COLOR_GRAY2BGR)
    results = []
    for name, tmpls in templates.items():
        best_score = -1.0
        best_tmpl = None
        for tmpl in tmpls:
            th, tw = tmpl.shape[:2]
            if slot_bgr.shape[0] < th or slot_bgr.shape[1] < tw:
                continue
            result = np.zeros((slot_bgr.shape[0] - th + 1, slot_bgr.shape[1] - tw + 1), dtype=np.float32)
            for ch in range(3):
                result += cv2.matchTemplate(slot_bgr[:, :, ch], tmpl[:, :, ch],
                                            cv2.TM_CCOEFF_NORMED)
            result /= 3.0
            _, max_val, _, _ = cv2.minMaxLoc(result)
            if max_val > best_score:
                best_score = max_val
                best_tmpl = tmpl
        if best_tmpl is not None:
            results.append((name, best_score, best_tmpl))
    results.sort(key=lambda x: -x[1])
    return results[:5]

def render_row(img, row_idx, row_y0, row_y1, unit_templates, grid_start, grid_spacing):
    """Generate HTML for one row's unit matching debug.

    Uses the same full-height per-slot matching as _match_unit_grid in the parser.
    """
    unit_region = _crop(img, MM_COL_UNITS[0], row_y0, MM_COL_UNITS[1], row_y1)
    context_region = _crop(img, MM_COL_PLACEMENT[0], row_y0, MM_COL_UNITS[1], row_y1)
    ur_h, ur_w = unit_region.shape[:2]
    y_split = int(ur_h * MM_UNIT_SPLIT_Y)

    # Context image
    context_b64 = img_to_b64(context_region, scale=3)

    # Annotated with grid lines
    annotated = unit_region.copy()
    for slot in range(MM_UNIT_MAX_SLOTS):
        sx = grid_start + slot * grid_spacing
        cv2.line(annotated, (sx, 0), (sx, ur_h), (0, 255, 0), 1)
    cv2.line(annotated, (0, y_split), (ur_w, y_split), (0, 200, 255), 1)
    annotated_b64 = img_to_b64(annotated, scale=3)

    # Determine layout: check if any slot has a match in the bottom half
    has_bottom = False
    for slot_idx in range(MM_UNIT_MAX_SLOTS):
        sx = grid_start + slot_idx * grid_spacing
        crop_x0 = max(sx - 5, 0)
        crop_x1 = min(sx + grid_spacing + 5, ur_w)
        bot_img = unit_region[y_split:ur_h, crop_x0:crop_x1]
        if bot_img.size == 0:
            continue
        top5 = match_slot_top5(bot_img, unit_templates)
        if top5 and top5[0][1] >= UNIT_MATCH_THRESHOLD:
            has_bottom = True
            break

    if has_bottom:
        sub_rows = [("top", 0, y_split), ("bot", y_split, ur_h)]
        layout_label = "two-row"
    else:
        sub_rows = [("row", 0, ur_h)]
        layout_label = "one-row"

    # Per-slot matching
    detected = []
    slots_html = ""
    for zone_label, zy0, zy1 in sub_rows:
        for slot in range(MM_UNIT_MAX_SLOTS):
            sx = grid_start + slot * grid_spacing
            crop_x0 = max(sx - 5, 0)
            crop_x1 = min(sx + grid_spacing + 5, ur_w)
            zone_img = unit_region[zy0:zy1, crop_x0:crop_x1]
            if zone_img.size == 0:
                continue

            top5 = match_slot_top5(zone_img, unit_templates)
            if not top5 or top5[0][1] < 0.50:
                continue

            if top5[0][1] >= UNIT_MATCH_THRESHOLD:
                detected.append(top5[0][0])

            zone_b64 = img_to_b64(zone_img, scale=4)

            candidates_html = ""
            for cname, cscore, ctmpl in top5:
                tmpl_b64 = img_to_b64(ctmpl, scale=4)
                color = "lime" if cscore >= UNIT_MATCH_THRESHOLD else "#f80" if cscore >= 0.60 else "#aaa"
                candidates_html += f"""
                <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
                    <img src="data:image/png;base64,{tmpl_b64}" style="border:1px solid #555">
                    <span style="color:{color}">{cname}: {cscore:.3f}</span>
                </div>"""

            slots_html += f"""
            <div style="border:1px solid #444;padding:10px;margin:8px;background:#1a1a1a;border-radius:8px;display:inline-block;vertical-align:top">
                <div style="color:#888;margin-bottom:6px">{zone_label}[{slot}] (x={sx}px)</div>
                <div style="display:flex;gap:20px;align-items:flex-start">
                    <div>
                        <div style="color:#aaa;font-size:12px;margin-bottom:4px">Actual (4x zoom)</div>
                        <img src="data:image/png;base64,{zone_b64}" style="border:2px solid #666">
                    </div>
                    <div>
                        <div style="color:#aaa;font-size:12px;margin-bottom:4px">Top 5 candidates</div>
                        {candidates_html}
                    </div>
                </div>
            </div>"""

    detected_str = ", ".join(detected) if detected else "(none)"

    return f"""
    <div style="border:2px solid #555;padding:16px;margin:16px 0;background:#151515;border-radius:10px">
        <h2>Row {row_idx + 1} <span style="color:#888;font-size:14px">({layout_label}, {len(detected)} units)</span></h2>
        <p style="color:#888">y={int(img.shape[0]*row_y0)}-{int(img.shape[0]*row_y1)} ({row_y0:.4f}-{row_y1:.4f})</p>
        <p style="color:#0f0">Detected: {detected_str}</p>
        <h3>Context (3x zoom)</h3>
        <img src="data:image/png;base64,{context_b64}" style="border:2px solid #888"><br>
        <h3>Grid overlay (3x zoom)</h3>
        <img src="data:image/png;base64,{annotated_b64}" style="border:2px solid #0f0"><br><br>
        <h3>Per-slot comparison</h3>
        {slots_html}
    </div>"""

def main():
    screenshot = Path(__file__).parent.parent / "data" / "screenshots" / "my_matches.jpg"
    icons_dir = Path(__file__).parent.parent / "data" / "icons" / "units"
    img = cv2.imread(str(screenshot))
    h, w = img.shape[:2]

    unit_templates = _load_templates_multiscale(icons_dir, UNIT_ICON_SCALES, inner_frac=0.85, color=True)
    print(f"Loaded {len(unit_templates)} unit templates")

    rows = _find_my_matches_rows(img, debug=True)
    print(f"Found {len(rows)} rows")

    sample_region = _crop(img, MM_COL_UNITS[0], rows[0][0], MM_COL_UNITS[1], rows[0][1])
    ur_w = sample_region.shape[1]
    grid_start = int(ur_w * MM_UNIT_GRID_START_FRAC)
    grid_spacing = max(int(ur_w * MM_UNIT_GRID_SPACING_FRAC), 1)
    print(f"Unit region width={ur_w}, grid_start={grid_start}, spacing={grid_spacing}")

    rows_html = ""
    for i, (row_y0, row_y1) in enumerate(rows):
        print(f"Processing row {i+1}/{len(rows)}...")
        rows_html += render_row(img, i, row_y0, row_y1, unit_templates, grid_start, grid_spacing)

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unit Matching Debug — All Rows</title>
<style>body{{background:#111;color:#eee;font-family:monospace;padding:20px}}
h2{{margin:0 0 8px}}h3{{margin:12px 0 6px;color:#aaa}}</style>
</head><body>
<h1>Unit Matching Debug — All Rows</h1>
<p style="color:#888">Screenshot: {screenshot.name} ({w}x{h}), {len(rows)} rows detected</p>
{rows_html}
</body></html>"""

    out = Path(__file__).parent.parent / "data" / "match_debug.html"
    out.write_text(html)
    print(f"Wrote {out}")

if __name__ == "__main__":
    main()
