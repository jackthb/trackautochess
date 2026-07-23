#!/usr/bin/env python3
"""
Extract DAC VScripts from the Steam workshop VPK and diff against the last extraction.

The mod's Lua is third-party game logic, so none of it is tracked in git (see
.gitignore). Each run rotates the prior extraction to data/vscripts_prev/ and
diffs the fresh pull against it locally — purely for inspecting what a patch
changed. Both dirs stay on your disk only.

Usage:
    python scripts/extract_vscripts.py           # extract + print local diff
    python scripts/extract_vscripts.py --save    # extract + save diff to data/vscript_diffs/
"""

import argparse
import os
import shutil
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
PREV_DIR = REPO_ROOT / "data" / "vscripts_prev"  # last extraction, kept aside for local diffing
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

    # Rotate the previous extraction aside so we can diff new-vs-old locally
    # without tracking any of it in git (the mod's Lua isn't ours to host).
    if OUT_DIR.exists():
        if PREV_DIR.exists():
            shutil.rmtree(PREV_DIR)
        OUT_DIR.rename(PREV_DIR)

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


def local_diff() -> str:
    """Diff the fresh extraction against the previous one (both gitignored).

    Uses `git diff --no-index`, which compares two arbitrary paths regardless
    of whether they're tracked — so nothing about the mod's Lua ever needs to
    live in the repo. Returns "" on the first run (no previous extraction).
    """
    if not PREV_DIR.exists():
        return ""
    result = subprocess.run(
        ["git", "diff", "--no-index", "--", str(PREV_DIR), str(OUT_DIR)],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    # `git diff --no-index` exits 1 when files differ — that's the normal case,
    # not an error; the diff text we want is on stdout either way.
    #
    # Decode as UTF-8 explicitly: the mod's Lua contains non-ASCII bytes, and
    # subprocess's default text-mode decoding uses the console's locale
    # encoding (cp1252 on Windows), which raises UnicodeDecodeError and
    # silently drops the diff output instead of surfacing it.
    return result.stdout.decode("utf-8", errors="replace")


def main():
    parser = argparse.ArgumentParser(description="Extract DAC VScripts and diff against previous version.")
    parser.add_argument("--save", action="store_true", help="Save diff to data/vscript_diffs/")
    args = parser.parse_args()

    vpk_path = find_vpk()
    print(f"Found VPK: {vpk_path}")

    count = extract(vpk_path)
    print(f"Extracted {count} files to {OUT_DIR}")

    diff = local_diff()
    if not diff:
        if not PREV_DIR.exists():
            print("First extraction — nothing to diff against yet. "
                  "Re-run after the next patch to see changes.")
        else:
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
