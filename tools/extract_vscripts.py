#!/usr/bin/env python3
"""
Extract DAC VScripts from the Steam workshop VPK and diff against the last known version.

Usage:
    python tools/extract_vscripts.py           # extract + print diff
    python tools/extract_vscripts.py --save    # extract + save diff to data/vscript_diffs/
"""

import argparse
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

WORKSHOP_ID = "1613886175"
STEAM_PATHS = [
    Path("C:/Program Files (x86)/Steam/steamapps/workshop/content/570"),
    Path("C:/Program Files/Steam/steamapps/workshop/content/570"),
    Path(os.path.expanduser("~")) / ".steam/steam/steamapps/workshop/content/570",
]

REPO_ROOT = Path(__file__).parent.parent
OUT_DIR = REPO_ROOT / "data" / "vscripts"
DIFF_DIR = REPO_ROOT / "data" / "vscript_diffs"


def find_vpk() -> Path:
    for base in STEAM_PATHS:
        vpk = base / WORKSHOP_ID / f"{WORKSHOP_ID}.vpk"
        if vpk.exists():
            return vpk
    sys.exit(f"DAC VPK not found. Expected at one of:\n" +
             "\n".join(str(p / WORKSHOP_ID / f"{WORKSHOP_ID}.vpk") for p in STEAM_PATHS))


def extract(vpk_path: Path) -> int:
    try:
        import vpk as vpklib
    except ImportError:
        sys.exit("Missing dependency: pip install vpk")

    pak = vpklib.open(str(vpk_path))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in pak:
        if not (path.endswith(".lua") or "vscript" in path.lower()):
            continue
        data = pak[path].read()
        dest = OUT_DIR / Path(path.replace("\\", "/"))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        count += 1
    return count


def git_diff() -> str:
    result = subprocess.run(
        ["git", "diff", "--", str(OUT_DIR.relative_to(REPO_ROOT))],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description="Extract DAC VScripts and diff against previous version.")
    parser.add_argument("--save", action="store_true", help="Save diff to data/vscript_diffs/")
    args = parser.parse_args()

    vpk_path = find_vpk()
    print(f"Found VPK: {vpk_path}")

    count = extract(vpk_path)
    print(f"Extracted {count} files to {OUT_DIR}")

    diff = git_diff()
    if not diff:
        print("No changes since last extraction.")
        return

    if args.save:
        DIFF_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        diff_file = DIFF_DIR / f"vscripts_{timestamp}.diff"
        diff_file.write_text(diff, encoding="utf-8")
        print(f"Diff saved to {diff_file}")
    else:
        print(diff)


if __name__ == "__main__":
    main()
