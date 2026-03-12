"""Per-row debug: deep-dive unit slot matching for one row, emit HTML report.

Reuses cv_parser functions — no reimplementation.

Usage:
    cd tracker && python debug_row.py [path/to/screenshot.jpg] [row_index]
"""

import base64
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from utils import ICONS_DIR, DATA_DIR, crop as _crop, unit_stem as _unit_stem
from cv_parser import (
    _find_my_matches_rows,
    _load_templates_multiscale,
    _detect_two_row,
    _match_slot_zone,
    _img_to_b64,
    MM_COL_UNITS,
    UNIT_ICON_SCALES, UNIT_MATCH_THRESHOLD,
    MM_UNIT_GRID_START_FRAC, MM_UNIT_GRID_SPACING_FRAC,
    MM_UNIT_SPLIT_Y, MM_UNIT_ONE_ROW_Y, MM_UNIT_MAX_SLOTS,
)

_default_screenshot = Path(__file__).parent.parent / "data" / "screenshots" / "20260308030800_1.jpg"
SCREENSHOT = Path(sys.argv[1]) if len(sys.argv) > 1 else _default_screenshot
TARGET_ROW = int(sys.argv[2]) if len(sys.argv) > 2 else 6
OUTPUT = Path(__file__).parent.parent / "data" / f"{SCREENSHOT.stem}_row{TARGET_ROW}.html"


def main():
    img = cv2.imread(str(SCREENSHOT))
    if img is None:
        print(f"Cannot read {SCREENSHOT}"); sys.exit(1)

    h, w = img.shape[:2]
    rows = _find_my_matches_rows(img)
    if TARGET_ROW >= len(rows):
        print(f"Only {len(rows)} rows, no row {TARGET_ROW}"); sys.exit(1)

    y0, y1 = rows[TARGET_ROW]

    # Load templates and icon files
    units_data = json.loads((DATA_DIR / "units.json").read_text())["units"]
    stem_to_name = {_unit_stem(name): name for name in units_data}

    unit_templates = _load_templates_multiscale(
        ICONS_DIR / "units", UNIT_ICON_SCALES, inner_frac=0.85, color=True)

    icon_files = {}
    for p in (ICONS_DIR / "units").glob("*.png"):
        icon_files[p.stem] = cv2.imread(str(p))

    # Unit region — reuse same crop as the real parser
    unit_region = _crop(img, MM_COL_UNITS[0], y0, MM_COL_UNITS[1], y1)
    urh, urw = unit_region.shape[:2]
    region_bgr = unit_region if len(unit_region.shape) == 3 else cv2.cvtColor(unit_region, cv2.COLOR_GRAY2BGR)
    grid_start = int(urw * MM_UNIT_GRID_START_FRAC)
    grid_spacing = max(int(urw * MM_UNIT_GRID_SPACING_FRAC), 1)
    y_mid = int(urh * MM_UNIT_SPLIT_Y)
    two_row = _detect_two_row(region_bgr, grid_start, grid_spacing, y_mid, urh, unit_templates)

    if two_row:
        zones = [(0, y_mid, "top"), (max(y_mid - 8, 0), urh, "bot")]
    else:
        oy0 = int(urh * MM_UNIT_ONE_ROW_Y[0])
        oy1 = int(urh * MM_UNIT_ONE_ROW_Y[1])
        zones = [(oy0, oy1, "row")]

    # Show _detect_two_row result using the real function (already called above)
    # Just show the bottom-half slot crops for visual reference
    detect_html = []
    bot_start = max(y_mid - 8, 0)
    for slot_idx in range(3):
        sx = grid_start + slot_idx * grid_spacing
        crop_x0 = max(sx - 5, 0)
        crop_x1 = min(sx + grid_spacing + 5, urw)
        bot_slot = region_bgr[bot_start:urh, crop_x0:crop_x1]
        if bot_slot.size == 0:
            continue
        bot_big = cv2.resize(bot_slot, (bot_slot.shape[1]*3, bot_slot.shape[0]*3),
                             interpolation=cv2.INTER_NEAREST)
        # Use _match_slot_zone to get the top match for display
        top_matches, _ = _match_slot_zone(region_bgr, slot_idx, grid_start, grid_spacing,
                                          bot_start, urh, unit_templates, 0.3, top_n=3)
        if top_matches:
            best_name, best_score = top_matches[0][0], top_matches[0][1]
            disp_name = stem_to_name.get(best_name, best_name)
        else:
            disp_name, best_score = "(none)", 0.0
        sc_color = "#0f0" if best_score >= 0.70 else "#f66"
        detect_html.append(
            f'<div style="display:inline-flex;flex-direction:column;align-items:center;'
            f'margin:0 8px;padding:8px;background:#1a1a2e;border-radius:6px;border:1px solid #333">'
            f'<div style="font-size:10px;color:#888">slot {slot_idx} (bot half)</div>'
            f'<img src="{_img_to_b64(bot_big)}" style="max-height:120px;image-rendering:pixelated;border:1px solid #444;margin:4px 0">'
            f'<div style="color:{sc_color};font-size:12px;font-weight:bold">{disp_name}</div>'
            f'<div style="color:{sc_color};font-size:11px">{best_score:.3f} (need ≥0.70)</div>'
            f'</div>')

    detect_section = (
        f'<div style="margin:16px 0;padding:12px;background:#0a0a0a;border-radius:8px;border:1px solid #333">'
        f'<div style="font-size:13px;font-weight:bold;color:#ff0;margin-bottom:8px">'
        f'_detect_two_row check — bottom half (y_mid-8={bot_start}px to {urh}px = {urh-bot_start}px tall)</div>'
        f'<div style="display:flex;flex-wrap:wrap">{"".join(detect_html)}</div>'
        f'<div style="margin-top:8px;font-size:12px;color:{"#0f0" if two_row else "#f66"}">'
        f'Result: {"two-row ✓" if two_row else "one-row ✗ (no slot ≥ 0.70)"}</div>'
        f'</div>')

    # Build HTML rows by calling the real _match_slot_zone with top_n
    rows_html = []
    for zy0, zy1, zone_label in zones:
        for slot_idx in range(MM_UNIT_MAX_SLOTS):
            result = _match_slot_zone(region_bgr, slot_idx, grid_start, grid_spacing,
                                      zy0, zy1, unit_templates, UNIT_MATCH_THRESHOLD,
                                      top_n=5)
            top_matches, slot_img = result
            if not top_matches or top_matches[0][1] < 0.5:
                continue

            winner_stem, winner_score, _, _ = top_matches[0]
            winner_name = stem_to_name.get(winner_stem, winner_stem)
            sc = "#0f0" if winner_score >= 0.80 else ("#ff0" if winner_score >= UNIT_MATCH_THRESHOLD else "#f66")

            # Slot crop scaled up 3x
            slot_big = cv2.resize(slot_img, (slot_img.shape[1]*3, slot_img.shape[0]*3),
                                  interpolation=cv2.INTER_NEAREST)
            slot_b64 = _img_to_b64(slot_big)

            # Winner icon
            w_icon = icon_files.get(winner_stem)
            w_icon_html = (f'<img src="{_img_to_b64(w_icon)}" '
                           f'style="height:60px;image-rendering:pixelated;border:1px solid #444">'
                           if w_icon is not None else "-")

            # Runner-ups from real match results
            ru_cells = []
            for ru_stem, ru_score, _, _ in top_matches[1:5]:
                ru_name = stem_to_name.get(ru_stem, ru_stem)
                ru_icon = icon_files.get(ru_stem)
                ru_sc = "#0f0" if ru_score >= 0.80 else ("#ff0" if ru_score >= UNIT_MATCH_THRESHOLD else "#f66")
                icon_html = (f'<img src="{_img_to_b64(ru_icon)}" '
                             f'style="height:60px;image-rendering:pixelated;border:1px solid #444">'
                             if ru_icon is not None else "")
                ru_cells.append(
                    f'<div style="display:inline-flex;flex-direction:column;align-items:center;'
                    f'margin:0 6px;padding:4px 8px;background:#0a0a2e;border-radius:6px;'
                    f'border:1px solid #333">'
                    f'{icon_html}'
                    f'<span style="color:{ru_sc};font-size:11px;margin-top:2px">{ru_name}</span>'
                    f'<span style="color:#666;font-size:10px">{ru_score:.3f}</span>'
                    f'</div>')

            bg = "#1a1a2e" if slot_idx % 2 == 0 else "#16213e"
            rows_html.append(
                f'<tr style="background:{bg}">'
                f'<td style="padding:8px;text-align:center">{zone_label} {slot_idx}</td>'
                f'<td style="padding:8px"><img src="{slot_b64}" style="max-height:120px;image-rendering:pixelated;border:1px solid #555"></td>'
                f'<td style="padding:8px;text-align:center">'
                f'{w_icon_html}<br><span style="color:{sc};font-weight:bold">{winner_name}</span>'
                f'<br><span style="color:{sc}">{winner_score:.3f}</span></td>'
                f'<td style="padding:8px"><div style="display:flex;flex-wrap:wrap;gap:4px">{"".join(ru_cells)}</div></td>'
                f'</tr>')

    # Annotated unit region with slot rectangles and zone lines
    annotated = unit_region.copy()
    scale = 3
    annotated = cv2.resize(annotated, (urw * scale, urh * scale), interpolation=cv2.INTER_NEAREST)

    # Draw zone boundaries
    for zy0_z, zy1_z, zone_label in zones:
        # Zone top = green, zone bottom = red
        cv2.line(annotated, (0, zy0_z * scale), (urw * scale, zy0_z * scale), (0, 255, 0), 1)
        cv2.line(annotated, (0, zy1_z * scale), (urw * scale, zy1_z * scale), (0, 0, 255), 1)
        cv2.putText(annotated, zone_label, (4, zy0_z * scale + 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)

    # Draw y_mid split line (cyan dashed effect)
    cv2.line(annotated, (0, y_mid * scale), (urw * scale, y_mid * scale), (255, 255, 0), 1)
    cv2.putText(annotated, "y_mid", (urw * scale - 60, y_mid * scale - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 0), 1)

    # Draw slot rectangles for each zone
    colors = {"top": (0, 255, 0), "bot": (0, 165, 255), "row": (255, 0, 255)}
    for zy0_z, zy1_z, zone_label in zones:
        color = colors.get(zone_label, (255, 255, 255))
        for slot_idx in range(MM_UNIT_MAX_SLOTS):
            sx = grid_start + slot_idx * grid_spacing
            crop_x0 = max(sx - 5, 0)
            crop_x1 = min(sx + grid_spacing + 5, urw)
            cv2.rectangle(annotated,
                          (crop_x0 * scale, zy0_z * scale),
                          (crop_x1 * scale, zy1_z * scale),
                          color, 1)
            cv2.putText(annotated, str(slot_idx),
                        (crop_x0 * scale + 2, zy0_z * scale + 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.3, color, 1)

    # Also draw one-row bounds in magenta even when two_row, for reference
    if two_row:
        oy0_ref = int(urh * MM_UNIT_ONE_ROW_Y[0])
        oy1_ref = int(urh * MM_UNIT_ONE_ROW_Y[1])
        cv2.line(annotated, (0, oy0_ref * scale), (urw * scale, oy0_ref * scale), (255, 0, 255), 1)
        cv2.line(annotated, (0, oy1_ref * scale), (urw * scale, oy1_ref * scale), (255, 0, 255), 1)
        cv2.putText(annotated, "1row_y0", (urw * scale - 80, oy0_ref * scale - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.3, (255, 0, 255), 1)
        cv2.putText(annotated, "1row_y1", (urw * scale - 80, oy1_ref * scale - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.3, (255, 0, 255), 1)

    row_info = (f"Row {TARGET_ROW}: y0={y0:.4f} y1={y1:.4f} "
                f"({int(y0*h)}-{int(y1*h)}px, h={int((y1-y0)*h)}px) | "
                f"unit_region={urw}x{urh} | y_mid={y_mid}px | "
                f"grid_start={grid_start} spacing={grid_spacing}")

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Row {TARGET_ROW} Unit Debug</title>
<style>
body {{ background:#111; color:#eee; font-family:system-ui,monospace; padding:20px; max-width:1600px; margin:0 auto }}
h1 {{ color:#e94560; font-size:18px }}
table {{ border-collapse:collapse; width:100% }}
th {{ background:#0f3460; padding:8px; text-align:left; font-size:12px }}
td {{ vertical-align:middle }}
.info {{ color:#888; font-size:12px; margin-bottom:8px }}
.legend {{ font-size:11px; margin-bottom:12px }}
.legend span {{ padding:2px 8px; border-radius:3px; margin-right:8px }}
</style></head><body>
<h1>Row {TARGET_ROW} — Unit Slots ({"two-row" if two_row else "one-row"})</h1>
<div class="info">{row_info}</div>
<div class="legend">
<span style="border:1px solid #0f0">green = zone top</span>
<span style="border:1px solid #f00">red = zone bottom</span>
<span style="border:1px solid #ff0">yellow = y_mid split</span>
<span style="border:1px solid #f0f">magenta = one-row bounds</span>
</div>
<div style="margin-bottom:16px">
<img src="{_img_to_b64(annotated)}" style="max-width:100%;image-rendering:pixelated;border:1px solid #444">
</div>
{detect_section}
<table>
<tr><th>Slot</th><th>Crop (3x)</th><th>Winner</th><th>Runner-ups</th></tr>
{"".join(rows_html)}
</table>
</body></html>"""

    OUTPUT.write_text(html)
    print(f"Wrote {OUTPUT} ({len(html)//1024}KB)")


if __name__ == "__main__":
    main()
