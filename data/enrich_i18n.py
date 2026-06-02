#!/usr/bin/env python3
"""One-shot enrichment: add localized name/description/lore fields to
existing data/{synergies,items_full,relics}.json without touching any other
field (icon_url, icon_dimensions, etc).

The full extract_vpk.py rewrites these files from scratch and would drop
the legacy remote icon URLs baked into the JSON. This script is the narrow
alternative — read the VPK, build per-locale `names`/`descriptions`/
`lore_i18n` maps, merge them into the existing JSON in place.

Usage (from repo root or data/):
  python data/enrich_i18n.py
"""
import json
import re
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent
sys.path.insert(0, str(DATA_DIR))
sys.path.insert(0, str(DATA_DIR.parent / 'app/backend/.venv/lib/python3.12/site-packages'))
sys.path.insert(0, str(DATA_DIR.parent / 'app/backend/.venv/Lib/site-packages'))

from extract_vpk import (
    LOC_FILES,
    find_vpk,
    parse_kv,
    parse_localization,
    strip_html,
    unescape_kv,
)

LOCALES = ('en', 'ru', 'zh-cn')
PLACEHOLDER = re.compile(r'%([A-Za-z_][A-Za-z0-9_]*)%')

# Most relic _Lore entries are placeholder "From Relic Box" / "From: Relicbox"
# noise — drop them at the source so consumers don't filter at render time.
RELIC_BOX_LORE = re.compile(r'^\s*from:?\s*relic\s*box\s*$', re.IGNORECASE)


def _scrub_relic_lore(value):
    if value and RELIC_BOX_LORE.match(value):
        return ''
    return value


def loc_strings(all_loc, prefix, suffixes=('',), process=None, placeholders=None):
    proc = process if process is not None else strip_html
    out = {}
    for lang in LOCALES:
        lang_loc = all_loc.get(lang)
        if lang_loc is None:
            continue
        raw = ''
        for sfx in suffixes:
            v = lang_loc.get(f'{prefix}{sfx}', '')
            if v:
                raw = v
                break
        if not raw:
            continue
        if placeholders is not None:
            raw = PLACEHOLDER.sub(
                lambda m: str(placeholders.get(m.group(1), '?')), raw,
            )
        out[lang] = proc(raw)
    return out


def item_values(block):
    """Same flatten logic as extract_vpk._item_values."""
    vals = {}
    av = block.get('AbilityValues')
    if isinstance(av, dict):
        for k, v in av.items():
            if not isinstance(v, dict):
                vals[k] = v
    ab_special = block.get('AbilitySpecial')
    if isinstance(ab_special, dict):
        for _, fields in ab_special.items():
            if isinstance(fields, dict):
                for fk, fv in fields.items():
                    if fk != 'var_type' and not isinstance(fv, dict):
                        vals[fk] = fv
    return vals


def enrich_record(rec, all_loc, gid, *, placeholders=None, is_relic=False):
    """Add `names`, `descriptions`, `lore_i18n` keys to `rec` in place.

    For relics, drop placeholder lore at the source (`is_relic=True`) so
    the JSON cache only carries real flavour text.
    """
    prefix = f'DOTA_Tooltip_ability_{gid}'
    rec['names'] = loc_strings(all_loc, prefix)
    rec['descriptions'] = loc_strings(
        all_loc, prefix, ('_Description', '_description'),
        placeholders=placeholders,
    )
    lore_i18n = loc_strings(
        all_loc, prefix, ('_Lore',), process=unescape_kv,
    )
    if is_relic:
        lore_i18n = {
            lang: cleaned
            for lang, v in lore_i18n.items()
            for cleaned in (_scrub_relic_lore(v),)
            if cleaned
        }
        if 'lore' in rec:
            rec['lore'] = _scrub_relic_lore(rec['lore'])
    rec['lore_i18n'] = lore_i18n


def main():
    vpk_path = find_vpk()
    if not vpk_path or not vpk_path.exists():
        print('ERROR: VPK not found.', file=sys.stderr)
        sys.exit(1)
    print(f'VPK: {vpk_path}')

    try:
        import vpk as vpk_mod
    except ImportError:
        venv = DATA_DIR.parent / 'app/backend/.venv/Lib/site-packages'
        sys.path.insert(0, str(venv))
        import vpk as vpk_mod

    pak = vpk_mod.open(str(vpk_path))

    all_loc = {}
    for lang, fn in LOC_FILES.items():
        try:
            all_loc[lang] = parse_localization(pak, fn)
        except KeyError:
            pass
    print(f'Locales loaded: {sorted(all_loc.keys())}')

    raw_items = pak['scripts/npc/npc_items_custom.txt'].read().decode('utf-8')
    items_kv = parse_kv(raw_items)
    if len(items_kv) == 1:
        items_kv = next(iter(items_kv.values()))

    # ── synergies.json ──
    p = DATA_DIR / 'synergies.json'
    syn = json.loads(p.read_text(encoding='utf-8'))
    for sid, rec in syn.items():
        enrich_record(rec, all_loc, sid)
    p.write_text(
        json.dumps(syn, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )
    print(f'  synergies.json: enriched {len(syn)} records')

    # ── items_full.json ──
    p = DATA_DIR / 'items_full.json'
    items = json.loads(p.read_text(encoding='utf-8'))
    for iid, rec in items.items():
        block = items_kv.get(iid, {}) if isinstance(items_kv, dict) else {}
        placeholders = item_values(block) if isinstance(block, dict) else None
        enrich_record(rec, all_loc, iid, placeholders=placeholders)
    p.write_text(
        json.dumps(items, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )
    print(f'  items_full.json: enriched {len(items)} records')

    # ── relics.json ──
    p = DATA_DIR / 'relics.json'
    rdata = json.loads(p.read_text(encoding='utf-8'))
    relics = rdata.get('relics', rdata)
    for rid, rec in relics.items():
        enrich_record(rec, all_loc, rid, is_relic=True)
    p.write_text(
        json.dumps(rdata, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )
    print(f'  relics.json: enriched {len(relics)} records')


if __name__ == '__main__':
    main()
