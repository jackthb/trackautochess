#!/usr/bin/env python3
"""Unified icon extraction for DAC Tools.

Sources:
  - Unit icons:    Steam CDN hero minimap icons
  - Synergy icons: VPK custom spellicons + Liquipedia/Steam CDN ability icons
  - Item icons:    VPK custom items + Steam CDN item/ability icons
  - Relic icons:   VPK custom spellicons + Steam CDN ability icons

Usage:
    python data/extract_icons.py              # extract missing only
    python data/extract_icons.py --force      # re-extract all
    python data/extract_icons.py --dry-run    # show what's missing
    python data/extract_icons.py --audit      # compare all sources vs disk
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).parent
ICONS_DIR = DATA_DIR / "icons"

WORKSHOP_ID = "1613886175"
_VPK_CANDIDATES = [
    Path(f"C:/Program Files (x86)/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk"),
    Path(f"C:/Program Files/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk"),
    Path(f"D:/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk"),
    Path(f"/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk"),
    Path(f"{Path.home()}/.steam/steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk"),
]
VPK_PATH = next((p for p in _VPK_CANDIDATES if p.exists()), _VPK_CANDIDATES[0])

STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# ── DAC unit name → Dota 2 internal hero name (for Steam CDN URLs) ──────────
# Only entries that differ from the default lowercased stem.
DAC_TO_DOTA2_HERO: dict[str, str | None] = {
    "Abyssal Underlord": "abyssal_underlord",
    "Anti-mage": "anti_mage",
    "Doom": "doom_bringer",
    "Furion": "furion",
    "IO": "wisp",
    "Keeper Of The Light": "keeper_of_the_light",
    "Lifestealer": "life_stealer",
    "Lone Druid": "lone_druid",
    "Lycan": "lycan",
    "Nature's Prophet": "furion",
    "Necrophos": "necrolyte",
    "Outworld Destroyer": "obsidian_destroyer",
    "Queen Of Pain": "queenofpain",
    "Shadow Fiend": "nevermore",
    "Timbersaw": "shredder",
    "Treant Protector": "treant",
    "Vengeful Spirit": "vengefulspirit",
    "Windranger": "windrunner",
    "Wraith King": "skeleton_king",
    "Zeus": "zuus",
    # DAC-exclusive units with no Dota 2 hero
    "Largo": None,
    "Ringmaster": "ringmaster",
}

# ── Synergy icon overrides ──────────────────────────────────────────────────
# synergy_id (from synergies.json key, without "is_" prefix) → source info.
# Most synergy icons come from VPK custom spellicons or were manually sourced.
# This map provides fallback URLs for icons not found in the VPK.
SYNERGY_CDN_OVERRIDES: dict[str, str] = {
    "harpy": "https://liquipedia.net/commons/images/c/cf/Harpy_Scout_Take_Off_abilityicon_dota2_gameasset.png",
}


def _unit_stem(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_").replace("'", "")


def _dota2_hero_name(dac_name: str) -> str | None:
    """Get the Dota 2 internal hero name for Steam CDN URLs."""
    if dac_name in DAC_TO_DOTA2_HERO:
        return DAC_TO_DOTA2_HERO[dac_name]
    return _unit_stem(dac_name)


def _download(url: str, dest: Path) -> bool:
    """Download a file from URL. Returns True on success."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        if len(data) < 100:
            return False
        # Validate PNG/WEBP/JPEG header
        if not (data[:4] == b"\x89PNG" or
                (data[:4] == b"RIFF" and data[8:12] == b"WEBP") or
                data[:2] == b"\xff\xd8"):
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return True
    except Exception:
        return False


def _load_vpk():
    """Load the DAC VPK. Returns None if unavailable."""
    if not VPK_PATH.exists():
        return None
    try:
        vpk_dir = Path(__file__).parent.parent / "tracker/.venv/lib/python3.12/site-packages"
        sys.path.insert(0, str(vpk_dir))
        import vpk
        return vpk.open(str(VPK_PATH))
    except Exception as e:
        print(f"  Warning: Cannot open VPK: {e}")
        return None


def _extract_vpk_png(pak, vpk_path: str, dest: Path) -> bool:
    """Extract a single PNG from the VPK to dest."""
    try:
        data = pak[vpk_path].read()
        if len(data) < 100:
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return True
    except (KeyError, Exception):
        return False


# ════════════════════════════════════════════════════════════════════════════
# 1. UNIT ICONS
# ════════════════════════════════════════════════════════════════════════════

def extract_units(force: bool, dry_run: bool) -> tuple[int, int, int]:
    """Extract unit minimap icons from Steam CDN."""
    units = json.loads((DATA_DIR / "units.json").read_text(encoding="utf-8"))["units"]
    out_dir = ICONS_DIR / "units"
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = fail = skip = 0
    for name in sorted(units):
        stem = _unit_stem(name)
        dest = out_dir / f"{stem}.png"

        if dest.exists() and not force:
            skip += 1
            continue

        hero = _dota2_hero_name(name)
        if hero is None:
            if dry_run:
                print(f"  SKIP {name:<30s} (DAC-exclusive, no source)")
            skip += 1
            continue

        url = f"{STEAM_CDN}/heroes/icons/{hero}.png"

        if dry_run:
            print(f"  MISSING {name:<30s} → {dest.name}  (from {url})")
            fail += 1
            continue

        if _download(url, dest):
            print(f"  OK   {name:<30s} → {dest.name}  ({dest.stat().st_size:,} bytes)")
            ok += 1
        else:
            print(f"  FAIL {name:<30s} (url={url})")
            fail += 1

    return ok, fail, skip


# ════════════════════════════════════════════════════════════════════════════
# 2. SYNERGY ICONS
# ════════════════════════════════════════════════════════════════════════════

def extract_synergies(force: bool, dry_run: bool, pak) -> tuple[int, int, int]:
    """Extract synergy icons from VPK custom spellicons or CDN."""
    synergies = json.loads((DATA_DIR / "synergies.json").read_text(encoding="utf-8"))
    out_dir = ICONS_DIR / "synergies"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Build AbilityTextureName map from VPK if available
    texture_map: dict[str, str] = {}
    if pak:
        try:
            raw = pak["scripts/npc/npc_abilities_custom.txt"].read().decode("utf-8")
            for m in re.finditer(r'"(is_[a-z]+)"\s*\{', raw):
                sid = m.group(1)
                # Find the block
                depth = 0
                i = m.end() - 1
                end = i
                while end < len(raw):
                    if raw[end] == "{": depth += 1
                    elif raw[end] == "}":
                        depth -= 1
                        if depth == 0: break
                    end += 1
                block = raw[i:end + 1]
                tex = re.search(r'"AbilityTextureName"\s+"([^"]+)"', block)
                if tex:
                    texture_map[sid] = tex.group(1)
        except Exception:
            pass

    ok = fail = skip = 0
    for sid, sdata in sorted(synergies.items()):
        # sid is like "is_warrior", icon name is "warrior"
        icon_name = sid.removeprefix("is_")
        dest = out_dir / f"{icon_name}.png"

        if dest.exists() and not force:
            skip += 1
            continue

        if dry_run:
            print(f"  MISSING {sdata['name']:<30s} → {dest.name}")
            fail += 1
            continue

        # Strategy 1: VPK custom spellicon (e.g., is_draenei.png)
        vpk_path = f"resource/flash3/images/spellicons/custom/{sid}.png"
        if pak and _extract_vpk_png(pak, vpk_path, dest):
            print(f"  OK   {sdata['name']:<30s} → {dest.name}  (VPK)")
            ok += 1
            continue

        # Strategy 2: CDN override (manually curated URLs)
        if icon_name in SYNERGY_CDN_OVERRIDES:
            url = SYNERGY_CDN_OVERRIDES[icon_name]
            if _download(url, dest):
                print(f"  OK   {sdata['name']:<30s} → {dest.name}  (CDN override)")
                ok += 1
                continue

        # Strategy 3: AbilityTextureName → Steam CDN ability icon
        if sid in texture_map:
            tex = texture_map[sid]
            if not tex.startswith("custom/"):
                url = f"{STEAM_CDN}/abilities/{tex}_hp2.png"
                if _download(url, dest):
                    print(f"  OK   {sdata['name']:<30s} → {dest.name}  (ability CDN)")
                    ok += 1
                    continue

        print(f"  FAIL {sdata['name']:<30s} → {dest.name}  (no source found)")
        fail += 1

    return ok, fail, skip


# ════════════════════════════════════════════════════════════════════════════
# 3. ITEM ICONS
# ════════════════════════════════════════════════════════════════════════════

def extract_items(force: bool, dry_run: bool, pak) -> tuple[int, int, int]:
    """Extract item icons from VPK or Steam CDN."""
    items = json.loads((DATA_DIR / "items.json").read_text(encoding="utf-8"))["items"]
    items_full = json.loads((DATA_DIR / "items_full.json").read_text(encoding="utf-8"))
    out_dir = ICONS_DIR / "items"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Build texture map from items_full.json
    # item display name → texture name
    texture_by_name: dict[str, str] = {}
    for iid, idata in items_full.items():
        texture_by_name[idata["name"]] = idata.get("texture", "")

    ok = fail = skip = 0
    for name, idata in sorted(items.items()):
        icon_file = idata.get("icon", "")
        if not icon_file:
            continue
        dest = out_dir / icon_file

        if dest.exists() and not force:
            skip += 1
            continue

        texture = texture_by_name.get(name, "")

        if dry_run:
            print(f"  MISSING {name:<30s} → {icon_file}  (texture={texture})")
            fail += 1
            continue

        # Strategy 1: VPK custom item icon
        if texture.startswith("custom/"):
            vpk_path = f"resource/flash3/images/items/{texture}.png"
            if pak and _extract_vpk_png(pak, vpk_path, dest):
                print(f"  OK   {name:<30s} → {icon_file}  (VPK)")
                ok += 1
                continue

        # Strategy 2: Steam CDN item icon
        if texture and not texture.startswith("custom/"):
            # Strip "item_" prefix if present for the CDN path
            cdn_name = texture.removeprefix("item_")
            url = f"{STEAM_CDN}/items/{cdn_name}_lg.png"
            if _download(url, dest):
                print(f"  OK   {name:<30s} → {icon_file}  (item CDN)")
                ok += 1
                continue

            # Try as ability icon instead
            url = f"{STEAM_CDN}/abilities/{texture}_hp2.png"
            if _download(url, dest):
                print(f"  OK   {name:<30s} → {icon_file}  (ability CDN)")
                ok += 1
                continue

        print(f"  FAIL {name:<30s} → {icon_file}")
        fail += 1

    return ok, fail, skip


# ════════════════════════════════════════════════════════════════════════════
# 4. RELIC ICONS
# ════════════════════════════════════════════════════════════════════════════

def extract_relics(force: bool, dry_run: bool, pak) -> tuple[int, int, int]:
    """Extract relic icons from VPK or Steam CDN."""
    relics = json.loads((DATA_DIR / "relics.json").read_text(encoding="utf-8"))["relics"]
    items_full = json.loads((DATA_DIR / "items_full.json").read_text(encoding="utf-8"))
    out_dir = ICONS_DIR / "relics"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Build texture map from items_full for relics
    texture_by_id: dict[str, str] = {}
    for iid, idata in items_full.items():
        texture_by_id[iid] = idata.get("texture", "")

    ok = fail = skip = 0
    for rid, rdata in sorted(relics.items()):
        name = rdata["name"]
        stem = name.lower().replace(" ", "_").replace("-", "_")
        dest = out_dir / f"{stem}.png"

        if dest.exists() and not force:
            skip += 1
            continue

        texture = texture_by_id.get(rid, "")

        if dry_run:
            print(f"  MISSING {name:<30s} → {dest.name}  (texture={texture})")
            fail += 1
            continue

        # Strategy 1: VPK custom spellicon or item icon
        for vpk_prefix in [
            f"resource/flash3/images/spellicons/custom/{rid}.png",
            f"resource/flash3/images/items/custom/{rid}.png",
        ]:
            if pak and _extract_vpk_png(pak, vpk_prefix, dest):
                print(f"  OK   {name:<30s} → {dest.name}  (VPK)")
                ok += 1
                break
        else:
            # Strategy 2: texture → Steam CDN
            if texture and not texture.startswith("custom/") and not texture.startswith("item_custom/"):
                cdn_name = texture.removeprefix("item_")
                url = f"{STEAM_CDN}/items/{cdn_name}_lg.png"
                if _download(url, dest):
                    print(f"  OK   {name:<30s} → {dest.name}  (CDN)")
                    ok += 1
                    continue
                url = f"{STEAM_CDN}/abilities/{texture}_hp2.png"
                if _download(url, dest):
                    print(f"  OK   {name:<30s} → {dest.name}  (ability CDN)")
                    ok += 1
                    continue

            print(f"  FAIL {name:<30s} → {dest.name}")
            fail += 1

    return ok, fail, skip


# ════════════════════════════════════════════════════════════════════════════
# AUDIT
# ════════════════════════════════════════════════════════════════════════════

def audit():
    """Report icon coverage: what's on disk vs what's expected."""
    print("=== Icon Audit ===\n")

    # Units
    units = json.loads((DATA_DIR / "units.json").read_text(encoding="utf-8"))["units"]
    unit_dir = ICONS_DIR / "units"
    missing_units = []
    for name in sorted(units):
        stem = _unit_stem(name)
        if not (unit_dir / f"{stem}.png").exists():
            missing_units.append(name)
    print(f"Units:     {len(units) - len(missing_units)}/{len(units)} present")
    for m in missing_units:
        print(f"  MISSING: {m}")

    # Synergies
    synergies = json.loads((DATA_DIR / "synergies.json").read_text(encoding="utf-8"))
    syn_dir = ICONS_DIR / "synergies"
    missing_syns = []
    for sid, sdata in sorted(synergies.items()):
        icon_name = sid.removeprefix("is_")
        if not (syn_dir / f"{icon_name}.png").exists():
            missing_syns.append(sdata["name"])
    print(f"Synergies: {len(synergies) - len(missing_syns)}/{len(synergies)} present")
    for m in missing_syns:
        print(f"  MISSING: {m}")

    # Items
    items = json.loads((DATA_DIR / "items.json").read_text(encoding="utf-8"))["items"]
    item_dir = ICONS_DIR / "items"
    missing_items = []
    for name, idata in sorted(items.items()):
        icon_file = idata.get("icon", "")
        if icon_file and not (item_dir / icon_file).exists():
            missing_items.append(name)
    print(f"Items:     {len(items) - len(missing_items)}/{len(items)} present")
    for m in missing_items:
        print(f"  MISSING: {m}")

    # Relics
    relics = json.loads((DATA_DIR / "relics.json").read_text(encoding="utf-8"))["relics"]
    relic_dir = ICONS_DIR / "relics"
    missing_relics = []
    for rid, rdata in sorted(relics.items()):
        stem = rdata["name"].lower().replace(" ", "_").replace("-", "_")
        if not (relic_dir / f"{stem}.png").exists():
            missing_relics.append(rdata["name"])
    print(f"Relics:    {len(relics) - len(missing_relics)}/{len(relics)} present")
    for m in missing_relics:
        print(f"  MISSING: {m}")

    total_missing = len(missing_units) + len(missing_syns) + len(missing_items) + len(missing_relics)
    print(f"\nTotal missing: {total_missing}")
    return total_missing


# ════════════════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════════════════

def main():
    force = "--force" in sys.argv
    dry_run = "--dry-run" in sys.argv
    do_audit = "--audit" in sys.argv

    if do_audit:
        audit()
        return

    pak = _load_vpk()
    if pak:
        print(f"VPK: {VPK_PATH}")
    else:
        print("VPK: not available (VPK-only icons will be skipped)")

    if dry_run:
        print("Mode: dry-run (showing what's missing)\n")
    elif force:
        print("Mode: force re-extract\n")
    else:
        print("Mode: extract missing only\n")

    print("── Units ──")
    u_ok, u_fail, u_skip = extract_units(force, dry_run)
    print(f"  → {u_ok} downloaded, {u_fail} failed, {u_skip} skipped\n")

    print("── Synergies ──")
    s_ok, s_fail, s_skip = extract_synergies(force, dry_run, pak)
    print(f"  → {s_ok} downloaded, {s_fail} failed, {s_skip} skipped\n")

    print("── Items ──")
    i_ok, i_fail, i_skip = extract_items(force, dry_run, pak)
    print(f"  → {i_ok} downloaded, {i_fail} failed, {i_skip} skipped\n")

    print("── Relics ──")
    r_ok, r_fail, r_skip = extract_relics(force, dry_run, pak)
    print(f"  → {r_ok} downloaded, {r_fail} failed, {r_skip} skipped\n")

    total_ok = u_ok + s_ok + i_ok + r_ok
    total_fail = u_fail + s_fail + i_fail + r_fail
    print(f"Done: {total_ok} extracted, {total_fail} failed")


if __name__ == "__main__":
    main()
