"""Regenerate parse_results.html — run the full parser on ALL screenshots
and display results with visual strips."""
import sys, base64, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import cv2
import numpy as np
from cv_parser import (
    MM_COL_UNITS, MM_COL_PLACEMENT, MM_COL_RANK, MM_COL_RELIC,
    MM_RELIC_COLS, MM_RELIC_ROWS, MM_RELIC_SPLIT_Y, MM_RELIC_COL_RANGES,
    RELIC_ICON_SCALES,
    _load_templates_multiscale, _load_icon, _match_relic_grid,
    parse_my_matches, _find_my_matches_rows,
    parse_game_over, detect_screen_type,
)
from utils import crop as _crop

ICONS_DIR = Path(__file__).parent.parent / "data" / "icons"
SCREENSHOTS_DIR = Path(__file__).parent.parent / "data" / "screenshots"

# Preload relic reference icons as base64 for HTML embedding
RELIC_ICON_B64 = {}
for _f in sorted((ICONS_DIR / "relics").glob("*.png")):
    _icon = _load_icon(_f, inner_frac=1.0, color=True)
    if _icon is not None:
        _resized = cv2.resize(_icon, (48, 48))
        _, _buf = cv2.imencode('.png', _resized)
        RELIC_ICON_B64[_f.stem] = base64.b64encode(_buf).decode()

# Preload relic templates for per-slot matching in render
RELIC_TMPLS = _load_templates_multiscale(
    ICONS_DIR / "relics", RELIC_ICON_SCALES, inner_frac=1.0, color=True
)


def img_to_b64(img, scale=1):
    if scale != 1:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    _, buf = cv2.imencode('.png', img)
    return base64.b64encode(buf).decode()


def render_row_card(rd, img=None, row_y0=None, row_y1=None):
    """Render a single result dict as an HTML card."""
    placement = rd.get("placement", "?")
    level = rd.get("level", "?")
    wl = rd.get("wl", "?")
    rank = rd.get("rank", "")
    rank_change = rd.get("rank_change", "none")
    relic = rd.get("relic", "")
    synergies = rd.get("synergies", "")
    units = rd.get("units", [])

    # Unit pills
    units_html = ""
    for u in units:
        m = re.match(r"(.+)\((\d)\)$", u)
        if m:
            name, stars = m.group(1), int(m.group(2))
            cls = f"u s{stars}"
            label = f"{name} {'★' * stars}"
        else:
            cls = "u"
            label = u
        units_html += f'<span class="{cls}">{label}</span>'

    # Synergy pills
    syns_html = ""
    if synergies:
        for syn in synergies.split("|"):
            syns_html += f'<span class="syn">{syn}</span>'

    # Relic pills with scores (text fallback)
    relics_html = ""
    relic_scores = rd.get("relic_scores", {})
    if relic:
        for r in relic.split("|"):
            score = relic_scores.get(r, 0)
            relics_html += f'<span class="rel">{r} <span style="color:#4a4">{score:.0%}</span></span>'

    # Per-slot relic comparison: slot crop → matched template icon
    relic_slots_html = ""
    relic_grid_matches = rd.get("_relic_grid_matches", [])  # injected below

    # Rank change arrow
    rank_arrow = ""
    if rank_change == "up":
        rank_arrow = '<span style="color:#4caf50">▲</span>'
    elif rank_change == "down":
        rank_arrow = '<span style="color:#f44336">▼</span>'

    rank_tag = f'<span class="tag">{rank} {rank_arrow}</span>' if rank else ""

    # Image strips (only for my_matches rows with known bounds)
    strips_html = ""
    if img is not None and row_y0 is not None:
        context_region = _crop(img, MM_COL_PLACEMENT[0], row_y0, MM_COL_RANK[1], row_y1)
        unit_region = _crop(img, MM_COL_UNITS[0], row_y0, MM_COL_UNITS[1], row_y1)
        ry0 = row_y0 + (row_y1 - row_y0) * 0.20
        ry1 = row_y0 + (row_y1 - row_y0) * 0.80
        rank_region = _crop(img, MM_COL_RANK[0], ry0, MM_COL_RANK[1], ry1)
        relic_region = _crop(img, MM_COL_RELIC[0], row_y0, MM_COL_RELIC[1], row_y1)

        # Build per-slot relic comparison grid
        rh, rw = relic_region.shape[:2]
        y_mid = int(rh * MM_RELIC_SPLIT_Y)

        # Build match lookup from grid matches
        match_map = {}
        for name, score, mx, my in relic_grid_matches:
            # Find which col this match belongs to
            for ci, (xf0, xf1) in enumerate(MM_RELIC_COL_RANGES):
                if int(rw * xf0) <= mx < int(rw * xf1):
                    break
            ri = 0 if my < y_mid else 1
            match_map[(ci, ri)] = (name, score)

        slot_pairs_html = ""
        for ri in range(MM_RELIC_ROWS):
            for ci, (xf0, xf1) in enumerate(MM_RELIC_COL_RANGES):
                cx0 = int(rw * xf0)
                cx1 = int(rw * xf1)
                cy0 = 0 if ri == 0 else y_mid
                cy1 = y_mid if ri == 0 else rh
                slot_crop = relic_region[cy0:cy1, cx0:cx1]
                slot_b64 = img_to_b64(slot_crop, 2)
                pos = "top" if ri == 0 else "bot"

                if (ci, ri) in match_map:
                    mname, mscore = match_map[(ci, ri)]
                    icon_b64 = RELIC_ICON_B64.get(mname, "")
                    icon_img = f'<img src="data:image/png;base64,{icon_b64}" style="height:48px;border-radius:4px">' if icon_b64 else "?"
                    score_color = "#4caf50" if mscore >= 0.75 else "#ff9800" if mscore >= 0.6 else "#f44336"
                    slot_pairs_html += f'''
  <div class="relic-slot">
    <div class="rslbl">[{pos}][{ci}]</div>
    <img src="data:image/png;base64,{slot_b64}" style="height:48px;border:1px solid #555;border-radius:4px">
    <span style="color:#666;font-size:16px">→</span>
    {icon_img}
    <span style="font-size:11px"><span style="color:{score_color}">{mscore:.0%}</span> {mname.replace("_"," ")}</span>
  </div>'''
                else:
                    slot_pairs_html += f'''
  <div class="relic-slot">
    <div class="rslbl">[{pos}][{ci}]</div>
    <img src="data:image/png;base64,{slot_b64}" style="height:48px;border:1px solid #333;border-radius:4px;opacity:0.4">
    <span style="color:#444;font-size:11px">no match</span>
  </div>'''

        relic_slots_html = f'''
  <div class="lbl">Relic slots → matched template</div>
  <div class="relic-grid">{slot_pairs_html}</div>'''

        strips_html = f"""
  <div class="lbl">Full row</div>
  <div class="strip"><img src="data:image/png;base64,{img_to_b64(context_region, 2)}"></div>
  <div class="lbl">Unit region (3x)</div>
  <div class="strip"><img src="data:image/png;base64,{img_to_b64(unit_region, 3)}"></div>
  <div class="lbl">Rank crop (3x)</div>
  <div class="strip"><img src="data:image/png;base64,{img_to_b64(rank_region, 3)}"></div>"""

    return f"""
<div class="card">
  <div class="hdr">
    <span class="place">#{placement}</span>
    <span class="tag">Lv {level}</span>
    <span class="tag">{wl}</span>
    {rank_tag}
  </div>{strips_html}
  <div class="lbl">Units ({len(units)})</div>
  <div class="units">{units_html}</div>
  <div class="lbl">Synergies</div>
  <div class="syns">{syns_html}</div>
  <div class="lbl">Relic</div>
  <div class="relics">{relics_html if relics_html else '<span style="color:#666">none</span>'}</div>
  {relic_slots_html}
</div>"""


def process_screenshot(path):
    """Parse a single screenshot, return (screen_type, section_html)."""
    img = cv2.imread(str(path))
    if img is None:
        return "error", f'<div class="card"><span style="color:red">Cannot read image</span></div>'

    h, w = img.shape[:2]
    screen_type = detect_screen_type(img)
    print(f"  {path.name} ({w}x{h}) → {screen_type}")

    if screen_type != "my_matches":
        return None, ""

    print(f"  Processing...")

    # Thumbnail of full screenshot
    thumb_scale = 400 / w
    thumb = cv2.resize(img, None, fx=thumb_scale, fy=thumb_scale)
    thumb_b64 = img_to_b64(thumb)

    cards = ""
    rows_data = parse_my_matches(img, player_name="", icons_dir=ICONS_DIR, debug=True)
    rows_bounds = _find_my_matches_rows(img)
    for i, rd in enumerate(rows_data):
        y0, y1 = rows_bounds[i] if i < len(rows_bounds) else (None, None)
        # Inject relic grid matches for the debug visualization
        if y0 is not None and RELIC_TMPLS:
            relic_region = _crop(img, MM_COL_RELIC[0], y0, MM_COL_RELIC[1], y1)
            rd["_relic_grid_matches"] = _match_relic_grid(
                relic_region, RELIC_TMPLS, threshold=0.55
            )
        cards += render_row_card(rd, img, y0, y1)

    section = f"""
<div class="section">
  <h2>{path.name} <span class="meta">({w}x{h}) — {screen_type}</span></h2>
  <div class="strip"><img src="data:image/png;base64,{thumb_b64}" style="height:200px"></div>
  {cards}
</div>"""
    return screen_type, section


def main():
    screenshots = sorted(SCREENSHOTS_DIR.glob("*.jpg"))
    print(f"Found {len(screenshots)} screenshots")

    sections_html = ""
    mm_count = 0

    for path in screenshots:
        stype, section = process_screenshot(path)
        if stype is None:
            continue
        mm_count += 1
        sections_html += section

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Parse Results — All Screenshots</title>
<style>
body {{ background: #1a1a2e; color: #e0e0e0; font-family: system-ui; padding: 20px; }}
h1 {{ color: #e94560; font-size: 18px; margin-bottom: 16px; }}
h2 {{ color: #e94560; font-size: 15px; margin: 24px 0 8px; border-top: 1px solid #333; padding-top: 16px; }}
.meta {{ font-size: 12px; color: #888; font-weight: normal; }}
.section {{ margin-bottom: 24px; }}
.card {{ background: #16213e; border: 1px solid #333; border-radius: 8px; margin-bottom: 16px; padding: 14px; }}
.hdr {{ display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }}
.place {{ font-size: 24px; font-weight: bold; }}
.tag {{ font-size: 12px; background: #0f3460; padding: 2px 8px; border-radius: 4px; color: #a0c4ff; }}
.lbl {{ font-size: 10px; color: #666; text-transform: uppercase; margin-bottom: 4px; margin-top: 8px; }}
.strip {{ margin: 4px 0; }}
.strip img {{ height: 80px; border: 1px solid #444; border-radius: 4px; image-rendering: pixelated; }}
.units {{ display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }}
.u {{ background: #2a2a4a; padding: 2px 6px; border-radius: 3px; font-size: 11px; }}
.u.s2 {{ border-left: 2px solid #c0c0c0; }}
.u.s3 {{ border-left: 2px solid #ffd700; }}
.syns {{ display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0; }}
.syn {{ font-size: 10px; background: #0f3460; padding: 1px 5px; border-radius: 3px; color: #a0c4ff; }}
.relics {{ display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0; }}
.rel {{ font-size: 10px; background: #1a3a1a; padding: 1px 5px; border-radius: 3px; color: #80c080; }}
.relic-grid {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }}
.relic-slot {{ display: flex; align-items: center; gap: 6px; background: #0d1b2a; border: 1px solid #333; border-radius: 6px; padding: 6px 8px; }}
.rslbl {{ font-size: 9px; color: #666; min-width: 40px; }}
</style></head><body>
<h1>Parse Results — {mm_count} my_matches screenshots</h1>
{sections_html}
</body></html>"""

    out = Path(__file__).parent.parent / "data" / "parse_results.html"
    out.write_text(html)
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
