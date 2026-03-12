"""Batch debug: run the parse pipeline on all screenshots, emit one HTML report.

Calls the real cv_parser functions — no reimplementation.
Filters to my_matches screen type.

Usage:
    cd tracker && python debug_batch.py [--push]
"""

import argparse
import base64
import json
import logging
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from utils import ICONS_DIR, DATA_DIR, crop as _crop, ocr as _ocr, unit_stem as _unit_stem
from cv_parser import (
    detect_screen_type,
    _find_my_matches_rows,
    _parse_my_matches_row,
    _load_templates_multiscale,
    _crop_row,
    _detect_two_row,
    _match_slot_zone,
    MM_COL_PLACEMENT, MM_COL_LEVEL, MM_COL_UNITS, MM_COL_SYNERGY,
    MM_COL_RELIC, MM_COL_WL, MM_COL_RANK, MM_COL_TIME,
    UNIT_ICON_SCALES, RELIC_ICON_SCALES, MM_SYNERGY_ICON_SCALES,
    TITLE_REGION, MM_TAB_REGION,
    MM_UNIT_GRID_START_FRAC, MM_UNIT_GRID_SPACING_FRAC,
    MM_UNIT_SPLIT_Y, MM_UNIT_ONE_ROW_Y, MM_UNIT_MAX_SLOTS,
    UNIT_MATCH_THRESHOLD,
)

SCREENSHOTS_DIR = Path(__file__).parent.parent / "data" / "screenshots"
OUTPUT = Path(__file__).parent.parent / "data" / "all_screenshots_debug.html"

log = logging.getLogger("dac")
logging.basicConfig(level=logging.DEBUG, format="%(message)s")

# Capture log messages per section
log_lines: list[str] = []

class LogCapture(logging.Handler):
    def emit(self, record):
        log_lines.append(self.format(record))

log.addHandler(LogCapture())


def img_to_b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    return ("data:image/png;base64," + base64.b64encode(buf).decode()) if ok else ""


def img_tag(img: np.ndarray, label: str = "", max_h: int = 120) -> str:
    uri = img_to_b64(img)
    style = f"max-height:{max_h}px;image-rendering:pixelated;border:1px solid #444;border-radius:4px;"
    tag = f'<img src="{uri}" style="{style}" title="{label}">'
    if label:
        tag = (f'<div style="display:inline-block;text-align:center;margin:4px">'
               f'<div style="font-size:10px;color:#888;margin-bottom:2px">{label}</div>{tag}</div>')
    return tag


class Section:
    def __init__(self, title: str, open_: bool = False):
        self.title = title
        self.open = open_
        self.parts: list[str] = []

    def add(self, html: str):
        self.parts.append(html)

    def kv(self, key: str, value: str, color: str = "#eee"):
        self.parts.append(f'<div><span style="color:#888">{key}:</span> '
                          f'<span style="color:{color}">{value}</span></div>')

    def img(self, img: np.ndarray, label: str = "", max_h: int = 120):
        self.parts.append(img_tag(img, label, max_h))

    def logs(self, lines: list[str]):
        if lines:
            escaped = "\n".join(l.replace("&", "&amp;").replace("<", "&lt;") for l in lines)
            self.parts.append(
                f'<pre style="background:#0a0a0a;padding:8px;border-radius:4px;'
                f'font-size:11px;color:#888;max-height:300px;overflow:auto;'
                f'white-space:pre-wrap">{escaped}</pre>')

    def render(self) -> str:
        inner = "\n".join(self.parts)
        o = " open" if self.open else ""
        return (f'<details{o}><summary style="cursor:pointer;padding:8px 0;font-size:14px;'
                f'font-weight:bold;border-bottom:1px solid #333;color:#e94560">'
                f'{self.title}</summary><div style="padding:12px 0">{inner}</div></details>')


def process_screenshot(filepath: Path, unit_templates, relic_templates, syn_templates,
                       units_data, stem_to_name, icon_files) -> tuple[list[Section], list[dict], str]:
    """Process one screenshot. Returns (sections, parsed_rows, screen_type)."""
    img = cv2.imread(str(filepath))
    if img is None:
        return [], [], "unreadable"

    h, w = img.shape[:2]
    sections: list[Section] = []

    # Screen type detection
    log_lines.clear()
    screen_type = detect_screen_type(img)
    if screen_type != "my_matches":
        return [], [], screen_type

    # Overview
    s = Section(f"{filepath.name} — Overview", open_=False)
    s.kv("File", filepath.name)
    s.kv("Size", f"{w}×{h}")
    s.add(f'<div style="display:inline-block;text-align:center;margin:4px">'
          f'<div style="font-size:10px;color:#888;margin-bottom:2px">Full screenshot</div>'
          f'<img src="screenshots/{filepath.name}" style="max-height:300px;border:1px solid #444;border-radius:4px;"></div>')
    sections.append(s)

    # Row detection
    log_lines.clear()
    rows = _find_my_matches_rows(img)

    # Per-row parsing
    all_parsed: list[dict] = []
    for row_i, (y0, y1) in enumerate(rows):
        s = Section(f"{filepath.name} — Row {row_i}", open_=False)
        log_lines.clear()

        # Row strip
        row_strip = img[int(y0 * h):int(y1 * h), :]
        s.img(row_strip, f"Row {row_i} full strip", max_h=100)

        # Call the REAL parser
        row_data = _parse_my_matches_row(
            img, y0, y1,
            unit_templates, relic_templates, syn_templates, ICONS_DIR,
            units_data, stem_to_name,
            debug=False, row_idx=row_i,
        )
        all_parsed.append(row_data)

        # Column crops
        rh = y1 - y0
        crops = [
            ("Placement", _crop(img, MM_COL_PLACEMENT[0], y0 + rh*0.15,
                                MM_COL_PLACEMENT[1], y0 + rh*0.75)),
            ("Level", _crop(img, MM_COL_LEVEL[0], y0 + rh*0.30,
                            MM_COL_LEVEL[1], y0 + rh*0.75)),
            ("Units", _crop(img, MM_COL_UNITS[0], y0, MM_COL_UNITS[1], y1)),
            ("Synergies", _crop_row(img, MM_COL_SYNERGY, y0, y1)),
            ("Relics", _crop(img, MM_COL_RELIC[0], y0, MM_COL_RELIC[1], y1)),
            ("W-L", _crop(img, MM_COL_WL[0], y0 + rh*0.55,
                          MM_COL_WL[1], y0 + rh*0.95)),
            ("Rank", _crop(img, MM_COL_RANK[0], y0 + rh*0.20,
                           MM_COL_RANK[1], y0 + rh*0.80)),
            ("Time", _crop(img, MM_COL_TIME[0], y0 + rh*0.65, MM_COL_TIME[1], y1)),
        ]
        s.add('<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">')
        for label, crop_img in crops:
            s.add(img_tag(crop_img, label, max_h=80))
        s.add('</div>')

        # Parsed results
        s.kv("Placement", row_data["placement"] or "(empty)",
             "#0f0" if row_data["placement"] else "#f00")
        s.kv("Level", row_data["level"] or "(empty)",
             "#0f0" if row_data["level"] else "#f00")

        units = row_data.get("units", [])
        s.kv("Units", f"{len(units)}: {', '.join(units)}" if units else "(none)")

        # Per-slot unit matching detail
        unit_region = _crop(img, MM_COL_UNITS[0], y0, MM_COL_UNITS[1], y1)
        urh, urw = unit_region.shape[:2]
        region_bgr = unit_region if len(unit_region.shape) == 3 else cv2.cvtColor(unit_region, cv2.COLOR_GRAY2BGR)
        grid_start = int(urw * MM_UNIT_GRID_START_FRAC)
        grid_spacing = max(int(urw * MM_UNIT_GRID_SPACING_FRAC), 1)
        y_mid = int(urh * MM_UNIT_SPLIT_Y)
        two_row = _detect_two_row(region_bgr, grid_start, grid_spacing, y_mid, urh, unit_templates)
        s.kv("Layout", f"{'two-row' if two_row else 'one-row'}")
        if two_row:
            zones = [(0, y_mid, "top"), (max(y_mid - 8, 0), urh, "bot")]
        else:
            oy0 = int(urh * MM_UNIT_ONE_ROW_Y[0])
            oy1 = int(urh * MM_UNIT_ONE_ROW_Y[1])
            zones = [(oy0, oy1, "row")]

        s.add('<div style="margin:8px 0">')
        s.add('<table style="border-collapse:collapse;font-size:11px;width:100%">')
        s.add('<tr style="background:#0f3460"><th>Zone</th><th>Slot</th>'
              '<th>Crop</th><th>Winner</th><th>Icon</th><th>Score</th>'
              '<th>Runner-ups</th></tr>')
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
                sc_color = "#0f0" if winner_score >= 0.80 else ("#ff0" if winner_score >= UNIT_MATCH_THRESHOLD else "#f66")
                slot_b64 = img_to_b64(slot_img)
                icon_img = icon_files.get(winner_stem)
                icon_html = img_tag(icon_img, "", max_h=36) if icon_img is not None else "(no icon)"
                runners_html_parts = []
                for ru_stem, ru_score, _, _ in top_matches[1:4]:
                    ru_name = stem_to_name.get(ru_stem, ru_stem)
                    ru_icon = icon_files.get(ru_stem)
                    ru_icon_html = (f'<img src="{img_to_b64(ru_icon)}" '
                                    f'style="max-height:28px;image-rendering:pixelated;'
                                    f'border:1px solid #444;vertical-align:middle">'
                                    if ru_icon is not None else "")
                    ru_sc_color = "#0f0" if ru_score >= 0.80 else ("#ff0" if ru_score >= UNIT_MATCH_THRESHOLD else "#f66")
                    runners_html_parts.append(
                        f'<div style="display:inline-flex;align-items:center;gap:3px;'
                        f'margin-right:10px;background:#0a0a2e;padding:2px 6px;'
                        f'border-radius:4px;border:1px solid #333">'
                        f'{ru_icon_html}'
                        f'<span style="color:{ru_sc_color}">{ru_name}</span>'
                        f'<span style="color:#666;font-size:9px">{ru_score:.3f}</span>'
                        f'</div>')
                runners = "".join(runners_html_parts)
                bg = "#1a1a2e" if slot_idx % 2 == 0 else "#16213e"
                s.add(f'<tr style="background:{bg}">'
                      f'<td style="padding:4px">{zone_label}</td>'
                      f'<td style="padding:4px">{slot_idx}</td>'
                      f'<td style="padding:4px"><img src="{slot_b64}" style="max-height:40px;image-rendering:pixelated;border:1px solid #444"></td>'
                      f'<td style="padding:4px;color:{sc_color}">{winner_name}</td>'
                      f'<td style="padding:4px">{icon_html}</td>'
                      f'<td style="padding:4px;color:{sc_color}">{winner_score:.3f}</td>'
                      f'<td style="padding:4px;color:#888;font-size:10px">{runners}</td>'
                      f'</tr>')
        s.add('</table>')
        s.add('</div>')

        s.kv("Synergies", row_data.get("synergies", "") or "(none)")
        s.kv("Relics", row_data.get("relic", "") or "(none)")
        s.kv("W-L", row_data.get("wl", "") or "(empty)",
             "#0f0" if row_data.get("wl") else "#f00")
        s.kv("Rank", f"{row_data.get('rank', '')} ({row_data.get('rank_change', 'none')})")
        s.kv("Time", row_data.get("time_ago", "") or "(empty)",
             "#0f0" if row_data.get("time_ago") else "#f00")

        # Row summary bar
        s.add(
            f'<div style="margin-top:12px;padding:10px;background:#0f3460;'
            f'border-radius:6px;font-size:13px">'
            f'<strong>Row {row_i}:</strong> '
            f'Place={row_data["placement"]} Level={row_data["level"]} '
            f'W-L={row_data["wl"]} Rank={row_data["rank"]}({row_data["rank_change"]}) '
            f'Units={len(units)} Syn={row_data["synergies"] or "-"} '
            f'Relics={row_data["relic"] or "-"} '
            f'Time={row_data.get("time_ago") or "-"}'
            f'</div>')

        s.logs(log_lines[:])
        log_lines.clear()
        sections.append(s)

    return sections, all_parsed, screen_type


def screenshot_timestamp(filepath: Path) -> datetime | None:
    """Derive a timestamp from a Steam screenshot filename like 20260308030800_1.jpg."""
    m = re.match(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_", filepath.name)
    if not m:
        return None
    y, mo, d, h, mi, s = (int(x) for x in m.groups())
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)


def main():
    parser = argparse.ArgumentParser(description="Batch debug all screenshots")
    parser.add_argument("--push", action="store_true",
                        help="Push parsed rows to Supabase")
    args = parser.parse_args()

    screenshots = sorted(SCREENSHOTS_DIR.glob("*.jpg"))
    if not screenshots:
        print(f"No screenshots found in {SCREENSHOTS_DIR}")
        sys.exit(1)

    print(f"Found {len(screenshots)} screenshots in {SCREENSHOTS_DIR}")
    if args.push:
        from utils import load_config
        config = load_config()
        user_id = config.get("steam_id")
        if not user_id:
            print("ERROR: steam_id not set in config — cannot push")
            sys.exit(1)
        from db import push_game, game_exists, ensure_user
        from models import GameRow
        ensure_user(str(user_id))
        print(f"DB push enabled for user {user_id}")

    # Load templates once
    units_path = DATA_DIR / "units.json"
    units_data = json.loads(units_path.read_text())["units"] if units_path.exists() else {}
    stem_to_name = {_unit_stem(name): name for name in units_data}

    unit_templates = _load_templates_multiscale(
        ICONS_DIR / "units", UNIT_ICON_SCALES, inner_frac=0.85, color=True)
    relic_templates = _load_templates_multiscale(
        ICONS_DIR / "relics", RELIC_ICON_SCALES, inner_frac=1.0, color=True)
    syn_templates = _load_templates_multiscale(
        ICONS_DIR / "synergies", MM_SYNERGY_ICON_SCALES)

    icon_files = {}
    for p in (ICONS_DIR / "units").glob("*.png"):
        icon_files[p.stem] = cv2.imread(str(p))

    print("Templates loaded. Processing screenshots...\n")

    all_sections: list[Section] = []
    summary_rows: list[dict] = []  # per-screenshot summary
    total_mm = 0

    for i, filepath in enumerate(screenshots):
        print(f"[{i+1}/{len(screenshots)}] {filepath.name} ... ", end="", flush=True)
        sections, parsed_rows, screen_type = process_screenshot(
            filepath, unit_templates, relic_templates, syn_templates,
            units_data, stem_to_name, icon_files)

        if screen_type != "my_matches":
            print(f"skip ({screen_type})")
            summary_rows.append({
                "file": filepath.name, "screen_type": screen_type,
                "rows": 0, "parsed": [],
            })
            continue

        total_mm += 1
        print(f"my_matches, {len(parsed_rows)} rows")
        all_sections.extend(sections)
        summary_rows.append({
            "file": filepath.name, "screen_type": screen_type,
            "rows": len(parsed_rows), "parsed": parsed_rows,
        })

        # Push to DB if requested
        if args.push:
            ss_time = screenshot_timestamp(filepath)
            if not ss_time:
                print(f"  WARNING: can't derive timestamp from {filepath.name}, skipping push")
                continue
            imported = 0
            for row_i, rd in enumerate(parsed_rows):
                # Row 0 is most recent — offset each row by 1 hour
                played_at = (ss_time - timedelta(hours=row_i)).isoformat()
                placement = rd.get("placement", "")
                wl = rd.get("wl", "")
                level = rd.get("level", "")
                if game_exists(str(user_id), played_at, placement, wl, level):
                    continue
                game_row = GameRow(
                    played_at=played_at,
                    placement=placement,
                    rank=rd.get("rank", ""),
                    rank_change=rd.get("rank_change", "none"),
                    lineup="|".join(rd.get("units", [])),
                    synergies=rd.get("synergies", ""),
                    talents="",
                    relic=rd.get("relic", ""),
                    level=level,
                    wl=wl,
                    notes="",
                )
                push_game(game_row, user_id=str(user_id))
                imported += 1
            if imported:
                print(f"  pushed {imported} row(s) to DB")

    # ── Grand summary ──────────────────────────────────────────────────────────
    s = Section("Grand Summary", open_=True)
    s.kv("Total screenshots", str(len(screenshots)))
    s.kv("My Matches screens", str(total_mm), "#0f0" if total_mm else "#f00")
    s.kv("Skipped (other type)", str(len(screenshots) - total_mm))

    # Summary table
    cols = ["File", "Type", "Rows", "Placements", "Ranks"]
    t = '<table style="border-collapse:collapse;width:100%;font-size:12px;margin:8px 0">'
    t += '<tr style="background:#0f3460">'
    t += "".join(f'<th style="padding:6px 8px;text-align:left">{c}</th>' for c in cols)
    t += '</tr>'
    for i, sr in enumerate(summary_rows):
        bg = "#1a1a2e" if i % 2 == 0 else "#16213e"
        type_color = "#0f0" if sr["screen_type"] == "my_matches" else "#888"
        placements = ", ".join(r.get("placement", "?") or "?" for r in sr["parsed"]) if sr["parsed"] else "-"
        ranks = ", ".join(r.get("rank", "?") or "?" for r in sr["parsed"]) if sr["parsed"] else "-"
        t += (f'<tr style="background:{bg}">'
              f'<td style="padding:4px 8px">{sr["file"]}</td>'
              f'<td style="padding:4px 8px;color:{type_color}">{sr["screen_type"]}</td>'
              f'<td style="padding:4px 8px">{sr["rows"]}</td>'
              f'<td style="padding:4px 8px">{placements}</td>'
              f'<td style="padding:4px 8px">{ranks}</td>'
              f'</tr>')
    t += '</table>'
    s.add(t)

    # Per-my_matches screenshot: condensed results table
    s.add('<h3 style="color:#e94560;margin-top:20px">All Parsed Rows</h3>')
    cols2 = ["File", "#", "Place", "Level", "W-L", "Rank", "Change", "Units", "Synergies", "Relics", "Time"]
    t2 = '<table style="border-collapse:collapse;width:100%;font-size:11px;margin:8px 0">'
    t2 += '<tr style="background:#0f3460">'
    t2 += "".join(f'<th style="padding:4px 6px;text-align:left">{c}</th>' for c in cols2)
    t2 += '</tr>'
    row_idx = 0
    for sr in summary_rows:
        if sr["screen_type"] != "my_matches":
            continue
        for ri, rd in enumerate(sr["parsed"]):
            bg = "#1a1a2e" if row_idx % 2 == 0 else "#16213e"
            units = rd.get("units", [])
            t2 += (f'<tr style="background:{bg}">'
                   f'<td style="padding:3px 6px;color:#888;font-size:10px">{sr["file"]}</td>'
                   f'<td style="padding:3px 6px">{ri}</td>'
                   f'<td style="padding:3px 6px">{rd.get("placement","")}</td>'
                   f'<td style="padding:3px 6px">{rd.get("level","")}</td>'
                   f'<td style="padding:3px 6px">{rd.get("wl","")}</td>'
                   f'<td style="padding:3px 6px">{rd.get("rank","")}</td>'
                   f'<td style="padding:3px 6px">{rd.get("rank_change","")}</td>'
                   f'<td style="padding:3px 6px;max-width:180px;word-break:break-word">'
                   f'{", ".join(units)}</td>'
                   f'<td style="padding:3px 6px">{rd.get("synergies","")}</td>'
                   f'<td style="padding:3px 6px">{rd.get("relic","")}</td>'
                   f'<td style="padding:3px 6px">{rd.get("time_ago","")}</td>'
                   f'</tr>')
            row_idx += 1
    t2 += '</table>'
    s.add(t2)

    # Insert summary at the top
    all_sections.insert(0, s)

    # ── Assemble HTML ──────────────────────────────────────────────────────────
    body = "\n".join(sec.render() for sec in all_sections)
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>All Screenshots Debug Report</title>
<style>
body {{ background:#111; color:#eee; font-family:system-ui,monospace; padding:20px; max-width:1400px; margin:0 auto }}
h1 {{ color:#e94560; font-size:20px; border-bottom:2px solid #333; padding-bottom:10px }}
h3 {{ font-size:15px }}
details {{ margin-bottom:16px; background:#1a1a1a; padding:4px 16px; border-radius:8px; border:1px solid #222 }}
summary:hover {{ color:#fff }}
img {{ vertical-align:middle }}
</style></head><body>
<h1>All Screenshots Debug Report — {total_mm}/{len(screenshots)} my_matches</h1>
{body}
</body></html>"""

    OUTPUT.write_text(html)
    print(f"\nWrote {OUTPUT} ({len(html) / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
