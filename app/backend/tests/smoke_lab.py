"""Standalone smoke test for the Parser Lab backend.

Iterates every screenshot in data/screenshots/, classifies the screen, and
exercises lab_parse.parse_full when the screen looks parseable. Prints a
one-line summary per image so regressions show up immediately.

Multi-aspect support has been dropped; non-16:9 captures are expected to
classify as "unknown" and are reported but not treated as failures.

Run:
    cd app/backend
    python tests/smoke_lab.py
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

import cv2

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent.parent
SCREENSHOTS_DIR = REPO_ROOT / "data" / "screenshots"

sys.path.insert(0, str(BACKEND_DIR))

from cv_parser import apply_calibration, detect_screen_type, load_regions_config  # noqa: E402
from lab_parse import parse_full  # noqa: E402


def is_roughly_16_9(width: int, height: int) -> bool:
    if height <= 0:
        return False
    ar = width / height
    return abs(ar - 16 / 9) < 0.05


def main() -> int:
    if not SCREENSHOTS_DIR.is_dir():
        print(f"FAIL: screenshots dir missing: {SCREENSHOTS_DIR}")
        return 1

    paths = sorted(p for p in SCREENSHOTS_DIR.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not paths:
        print(f"FAIL: no screenshots in {SCREENSHOTS_DIR}")
        return 1

    regions_config = load_regions_config()
    errors: list[str] = []
    parsed = 0
    skipped_aspect = 0
    parsed_unknown_screen = 0

    for path in paths:
        try:
            img = cv2.imread(str(path))
            if img is None:
                errors.append(f"{path.name}: cv2.imread returned None")
                print(f"  ERR  {path.name}: imread None")
                continue
            h, w = img.shape[:2]
            apply_calibration(img, regions_config=regions_config)
            screen = detect_screen_type(img)

            if not is_roughly_16_9(w, h):
                skipped_aspect += 1
                print(f"  SKIP {path.name}  {w}x{h} (non-16:9)  screen={screen}")
                continue

            if screen in ("my_matches", "game_over", "final_ranking"):
                result = parse_full(str(path))
                if not result.get("ok"):
                    errors.append(f"{path.name}: parse_full ok=False error={result.get('error')!r}")
                    print(f"  ERR  {path.name}: parse_full failed: {result.get('error')}")
                    continue
                regions = result.get("regions") or []
                first_labels = [
                    f"{r['name']}={r['label']!r}"
                    for r in regions[:3]
                ]
                print(
                    f"  OK   {path.name}  {w}x{h}  screen={result.get('screen_type')}  "
                    f"regions={len(regions)}  first3={first_labels}"
                )
                parsed += 1
            else:
                parsed_unknown_screen += 1
                print(f"  ??   {path.name}  {w}x{h}  screen={screen}")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{path.name}: {type(e).__name__}: {e}")
            print(f"  ERR  {path.name}: {type(e).__name__}: {e}")
            traceback.print_exc()

    print()
    print(f"Summary: total={len(paths)}  parsed_ok={parsed}  "
          f"skipped_non_16_9={skipped_aspect}  16_9_unknown={parsed_unknown_screen}  "
          f"errors={len(errors)}")
    if errors:
        print("Errors:")
        for e in errors:
            print(f"  - {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
