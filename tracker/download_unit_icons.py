"""One-time script to download Dota 2 minimap icons for all units in units.json.

Saves to: data/icons/units/{stem}.png
Uses the Dota 2 wiki Special:FilePath redirect API.

Usage:
    python download_unit_icons.py          # skip already-downloaded
    python download_unit_icons.py --force  # re-download everything
"""

import json
import subprocess
import sys
from pathlib import Path

from utils import unit_stem as _unit_stem


# ── Name mapping: DAC unit name → Dota 2 wiki hero name ─────────────────────
# Only entries that differ from the default transform (spaces→underscores).
# Set to None to skip (DAC-exclusive units not on the Dota2 wiki).

NAME_MAP: dict[str, str | None] = {
    # Different name in Dota 2
    "Furion":              "Nature%27s_Prophet",
    "Abyssal Underlord":   "Underlord",
    # Capitalisation fixes
    "Anti-mage":           "Anti-Mage",
    "Keeper Of The Light": "Keeper_of_the_Light",
    "Queen Of Pain":       "Queen_of_Pain",
    # DAC-exclusive — no Dota 2 wiki page
    "Largo":               None,
}

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _wiki_name(dac_name: str) -> str | None:
    """Return the Dota 2 wiki hero name for the minimap icon URL, or None to skip."""
    if dac_name in NAME_MAP:
        return NAME_MAP[dac_name]
    # Default: spaces → underscores (wiki uses underscores)
    return dac_name.replace(" ", "_")


def download_minimap_icon(unit_name: str, out_path: Path) -> bool:
    """Download minimap icon for a unit using curl (handles Cloudflare). Returns True on success."""
    wiki_name = _wiki_name(unit_name)
    if wiki_name is None:
        print(f"  SKIP {unit_name:<30s} (no wiki mapping)")
        return False

    url = f"https://dota2.fandom.com/wiki/Special:FilePath/{wiki_name}_minimap_icon.png"
    try:
        result = subprocess.run(
            ["curl", "-sL", "-A", BROWSER_UA, url, "-o", str(out_path)],
            capture_output=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"  FAIL {unit_name:<30s}: curl exit {result.returncode}")
            return False
        # Validate we got an image (wiki may serve WEBP or PNG; OpenCV handles both)
        if out_path.exists() and out_path.stat().st_size > 200:
            header = out_path.read_bytes()[:12]
            is_png  = header[:4] == b"\x89PNG"
            is_webp = header[:4] == b"RIFF" and header[8:12] == b"WEBP"
            is_gif  = header[:6] in (b"GIF87a", b"GIF89a")
            is_jpeg = header[:2] == b"\xff\xd8"
            if is_png or is_webp or is_gif or is_jpeg:
                size = out_path.stat().st_size
                fmt = "png" if is_png else "webp" if is_webp else "gif" if is_gif else "jpeg"
                print(f"  OK   {unit_name:<30s} → {out_path.name}  ({size:,} bytes, {fmt})")
                return True
        # Got something that's not a recognised image — delete and report failure
        out_path.unlink(missing_ok=True)
        print(f"  FAIL {unit_name:<30s}: not a recognised image (url={url})")
        return False
    except Exception as e:
        print(f"  ERR  {unit_name:<30s}: {e}")
        return False


def main() -> None:
    data_dir = Path(__file__).parent.parent / "data"
    units_path = data_dir / "units.json"
    out_dir = data_dir / "icons" / "units"
    out_dir.mkdir(parents=True, exist_ok=True)

    units_data: dict = json.loads(units_path.read_text())["units"]
    force = "--force" in sys.argv

    print(f"Units:  {len(units_data)}")
    print(f"Output: {out_dir}")
    if force:
        print("Mode:   force re-download")
    print()

    ok = fail = skip = 0
    for unit_name in units_data:
        stem = _unit_stem(unit_name)
        out_path = out_dir / f"{stem}.png"
        if out_path.exists() and not force:
            skip += 1
            continue
        result = download_minimap_icon(unit_name, out_path)
        if result:
            ok += 1
        else:
            fail += 1

    print(f"\nDone: {ok} downloaded, {fail} failed, {skip} already present")
    if fail:
        print("Re-run with --force to retry failed downloads.")


if __name__ == "__main__":
    main()
