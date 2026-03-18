#!/usr/bin/env python3
"""Extract all game data from the Dota Auto Chess VPK.

Proper Valve KV1 parser, no external dependencies beyond `vpk`.
Auto-discovers VPK from local Steam installation.
Diff mode: --diff <old_dir> shows what changed.

Writes:
  data/synergies.json   — synergy traits with tiers, descriptions, lore
  data/items_full.json  — items with descriptions, quality, lore
  data/relics.json      — relics with descriptions
  data/units_full.json  — units with stats at each star level
  data/units.json       — simple unit lookup (cost + synergies)

Usage:
  python extract_vpk.py                    # auto-discover VPK, extract all
  python extract_vpk.py /path/to/file.vpk  # explicit VPK path
  python extract_vpk.py --diff old_data/   # extract + diff against old data
"""
import sys, json, re, argparse
from pathlib import Path
from collections import Counter

# ════════════════════════════════════════════════════════════════════
# Valve KeyValues 1 Parser
# ════════════════════════════════════════════════════════════════════

class KVParser:
    """Recursive descent parser for Valve KeyValues 1 format."""

    def __init__(self, text):
        self.text = text
        self.pos = 0
        self.length = len(text)

    def parse(self):
        """Parse the full text, returning an ordered dict of top-level blocks."""
        result = {}
        self._skip_whitespace()
        while self.pos < self.length:
            key = self._read_string()
            if key is None:
                break
            self._skip_whitespace()
            value = self._read_value()
            # Handle duplicate keys by merging dicts or keeping last
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key].update(value)
            else:
                result[key] = value
            self._skip_whitespace()
        return result

    def _skip_whitespace(self):
        while self.pos < self.length:
            c = self.text[self.pos]
            if c in ' \t\r\n':
                self.pos += 1
            elif c == '/' and self.pos + 1 < self.length and self.text[self.pos + 1] == '/':
                # Line comment
                while self.pos < self.length and self.text[self.pos] != '\n':
                    self.pos += 1
            else:
                break

    def _read_string(self):
        self._skip_whitespace()
        if self.pos >= self.length:
            return None
        if self.text[self.pos] == '"':
            return self._read_quoted_string()
        if self.text[self.pos] in '{}':
            return None
        return self._read_bare_string()

    def _read_quoted_string(self):
        self.pos += 1  # skip opening quote
        start = self.pos
        result = []
        while self.pos < self.length:
            c = self.text[self.pos]
            if c == '\\' and self.pos + 1 < self.length:
                nc = self.text[self.pos + 1]
                if nc == 'n':
                    result.append('\n')
                elif nc == 't':
                    result.append('\t')
                elif nc == '"':
                    result.append('"')
                elif nc == '\\':
                    result.append('\\')
                else:
                    result.append('\\')
                    result.append(nc)
                self.pos += 2
            elif c == '"':
                self.pos += 1  # skip closing quote
                return ''.join(result)
            else:
                result.append(c)
                self.pos += 1
        return ''.join(result)

    def _read_bare_string(self):
        start = self.pos
        while self.pos < self.length and self.text[self.pos] not in ' \t\r\n{}':
            self.pos += 1
        return self.text[start:self.pos]

    def _read_value(self):
        self._skip_whitespace()
        if self.pos >= self.length:
            return ''
        if self.text[self.pos] == '{':
            return self._read_block()
        return self._read_string() or ''

    def _read_block(self):
        self.pos += 1  # skip {
        result = {}
        self._skip_whitespace()
        while self.pos < self.length and self.text[self.pos] != '}':
            key = self._read_string()
            if key is None:
                break
            self._skip_whitespace()
            value = self._read_value()
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key].update(value)
            else:
                result[key] = value
            self._skip_whitespace()
        if self.pos < self.length:
            self.pos += 1  # skip }
        return result


def parse_kv(text):
    """Parse a Valve KV1 text string into a nested dict."""
    return KVParser(text).parse()


# ════════════════════════════════════════════════════════════════════
# VPK Discovery
# ════════════════════════════════════════════════════════════════════

WORKSHOP_ID = '1613886175'

STEAM_SEARCH_PATHS = [
    # WSL -> Windows
    Path(f'/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
    Path(f'/mnt/d/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
    Path(f'/mnt/c/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
    # Linux native
    Path(f'{Path.home()}/.steam/steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
    Path(f'{Path.home()}/.local/share/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
]


def find_vpk():
    for p in STEAM_SEARCH_PATHS:
        if p.exists():
            return p
    return None


# ════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════

def strip_html(s):
    return re.sub(r'<[^>]+>', '', s).strip()


def get_notes(prefix, loc):
    notes = []
    for i in range(10):
        nk = f'{prefix}_Note{i}'
        if nk in loc and loc[nk].strip():
            notes.append(loc[nk])
    return notes


# ════════════════════════════════════════════════════════════════════
# Extraction
# ════════════════════════════════════════════════════════════════════

def parse_localization(pak, filename):
    """Parse a VPK localization file into a flat dict."""
    raw = pak[filename].read().decode('utf-8')
    kv = parse_kv(raw)
    loc = {}
    for top_key, top_val in kv.items():
        if isinstance(top_val, dict):
            tokens = top_val.get('Tokens', top_val)
            if isinstance(tokens, dict):
                loc.update(tokens)
    return loc


LOC_FILES = {
    'en': 'resource/addon_english.txt',
    'ko': 'resource/addon_korean.txt',
    'ru': 'resource/addon_russian.txt',
    'zh-cn': 'resource/addon_schinese.txt',
    'zh-tw': 'resource/addon_tchinese.txt',
}


def extract_all(pak):
    """Extract all game data from an open VPK. Returns dict of all output data."""

    # ── Parse all localizations ──
    all_loc = {}
    for lang, filename in LOC_FILES.items():
        try:
            all_loc[lang] = parse_localization(pak, filename)
        except KeyError:
            pass

    loc = all_loc.get('en', {})

    # ── Parse game data files ──
    raw_abilities = pak['scripts/npc/npc_abilities_custom.txt'].read().decode('utf-8')
    raw_items = pak['scripts/npc/npc_items_custom.txt'].read().decode('utf-8')
    raw_units = pak['scripts/npc/npc_units_custom.txt'].read().decode('utf-8')

    abilities_kv = parse_kv(raw_abilities)
    items_kv = parse_kv(raw_items)
    units_kv = parse_kv(raw_units)

    # Unwrap top-level container (e.g. "DOTAAbilities" { ... })
    if len(abilities_kv) == 1:
        abilities_kv = next(iter(abilities_kv.values()))
    if len(items_kv) == 1:
        items_kv = next(iter(items_kv.values()))
    if len(units_kv) == 1:
        units_kv = next(iter(units_kv.values()))

    # ── Build synergy ID -> display name map ──
    syn_id_to_name = {}

    # ════════════════════════════════════════════════════════════════
    # 1. SYNERGIES
    # ════════════════════════════════════════════════════════════════

    # Find base synergy IDs: is_X keys that exist in abilities and have localization
    synergy_ids = set()
    for k in loc:
        m = re.match(r'DOTA_Tooltip_ability_(is_[a-z]+)$', k)
        if m:
            sid = m.group(1)
            if sid in ('is_banned', 'is_ward'):
                continue
            if sid in abilities_kv:
                synergy_ids.add(sid)

    synergies = {}
    for sid in sorted(synergy_ids):
        prefix = f'DOTA_Tooltip_ability_{sid}'
        name = loc.get(prefix, sid)
        desc_html = loc.get(f'{prefix}_Description', loc.get(f'{prefix}_description', ''))
        lore = loc.get(f'{prefix}_Lore', '')
        notes = get_notes(prefix, loc)

        # Get AbilitySpecial from parsed ability block
        ab_block = abilities_kv.get(sid, {})
        special = {}
        ab_special = ab_block.get('AbilitySpecial', {})
        if isinstance(ab_special, dict):
            for idx, fields in ab_special.items():
                if isinstance(fields, dict):
                    for fk, fv in fields.items():
                        if fk != 'var_type':
                            special[fk] = fv

        # Extract tier breakpoints from description
        tiers = []
        seen = set()
        for tm in re.finditer(r'\((\d+)\)', desc_html):
            count = int(tm.group(1))
            if count not in seen and 1 <= count <= 15:
                tiers.append(count)
                seen.add(count)

        synergies[sid] = {
            'name': name,
            'description': strip_html(desc_html),
            'description_html': desc_html,
            'lore': lore,
            'notes': notes,
            'tiers': tiers,
            'ability_special': special,
        }
        syn_id_to_name[sid] = name

    # ════════════════════════════════════════════════════════════════
    # 2. ITEMS
    # ════════════════════════════════════════════════════════════════

    items = {}
    for iid, idata in sorted(items_kv.items()):
        if not iid.startswith('item_') or not isinstance(idata, dict):
            continue

        prefix = f'DOTA_Tooltip_ability_{iid}'
        name_raw = loc.get(prefix, iid)
        name = strip_html(name_raw)
        if not name or name == iid:
            continue

        desc = strip_html(loc.get(f'{prefix}_Description', ''))
        lore = loc.get(f'{prefix}_Lore', '')
        notes = get_notes(prefix, loc)
        quality = idata.get('ItemQuality', '')
        texture = idata.get('AbilityTextureName', '')

        items[iid] = {
            'name': name,
            'description': desc,
            'lore': lore,
            'quality': quality,
            'texture': texture,
            'notes': notes,
        }

    # ════════════════════════════════════════════════════════════════
    # 3. RELICS
    # ════════════════════════════════════════════════════════════════

    # Extract relic IDs from DROP_RELIC_LIST in addon_game_mode.lua
    # Note: quest_2_relic_list has seasonal/quest relics — not included
    raw_lua = pak['scripts/vscripts/addon_game_mode.lua'].read().decode('utf-8', errors='replace')

    relic_ids = []
    for m in re.finditer(r'DROP_RELIC_LIST\s*=\s*\{([^}]*)\}', raw_lua):
        ids = re.findall(r'"(item_\w+)"', m.group(1))
        if ids:
            relic_ids = ids
    # item_stolen_vault is the "discard all" escape option, always available
    relic_ids.append('item_stolen_vault')

    relics = {}
    for iid in relic_ids:
        prefix = f'DOTA_Tooltip_ability_{iid}'
        name = strip_html(loc.get(prefix, iid))
        if not name or name == iid:
            continue
        desc = strip_html(loc.get(f'{prefix}_Description', loc.get(f'{prefix}_description', '')))
        lore = loc.get(f'{prefix}_Lore', '')

        relics[iid] = {
            'name': name,
            'description': desc,
            'lore': lore,
        }

    # ════════════════════════════════════════════════════════════════
    # 4. UNITS
    # ════════════════════════════════════════════════════════════════

    # Active unit pools from addon_game_mode.lua:
    #   chess_list_by_mana       — main recruit pool
    #   chess_list_by_mana_black — undead/dark faction pool
    #   chess_list_by_mana_special — spirits + IO
    UNIT_POOLS = {
        'chess_list_by_mana': 'standard',
        'chess_list_by_mana_black': 'undead',
        'chess_list_by_mana_special': 'special',
    }
    active_unit_ids = set()
    unit_pool_map = {}  # chess_id -> pool name
    for pool_name, pool_label in UNIT_POOLS.items():
        for m in re.finditer(re.escape(pool_name) + r'\s*=\s*\{', raw_lua):
            start = m.end()
            depth = 1
            i = start
            while i < len(raw_lua) and depth > 0:
                if raw_lua[i] == '{': depth += 1
                elif raw_lua[i] == '}': depth -= 1
                i += 1
            block = raw_lua[m.start():i]
            # Strip Lua line comments before extracting IDs
            block = re.sub(r'--.*', '', block)
            ids = re.findall(r"'(chess_\w+)'", block)
            active_unit_ids.update(ids)
            for uid in ids:
                unit_pool_map[uid] = pool_label
            break

    def get_synergies_for_unit(abilities):
        return sorted([syn_id_to_name.get(a, a) for a in abilities if a.startswith('is_') and a in syn_id_to_name])

    def get_active_abilities(abilities):
        skip = {'no_collision', 'dac_guai_base', ''}
        result = []
        for ab in abilities:
            if ab.startswith('is_') or ab in skip:
                continue
            ab_name = loc.get(f'DOTA_Tooltip_ability_{ab}', '')
            ab_desc = strip_html(loc.get(f'DOTA_Tooltip_ability_{ab}_Description', ''))
            if ab_name:
                result.append({'id': ab, 'name': strip_html(ab_name), 'description': ab_desc})
        return result

    # Parse all chess_* units
    SKIP_SUFFIXES = ('_illusion', '_dragon', '_wolf', '_ssr', '_mohua', '_copy')
    units_raw = {}
    for uid, udata in units_kv.items():
        if not uid.startswith('chess_') or not isinstance(udata, dict):
            continue

        abilities = []
        for i in range(1, 17):
            ab = udata.get(f'Ability{i}', '')
            if ab:
                abilities.append(ab)

        units_raw[uid] = {
            'abilities': abilities,
            'hp': udata.get('StatusHealth', ''),
            'mana': udata.get('StatusMana', ''),
            'armor': udata.get('ArmorPhysical', ''),
            'magic_resist': udata.get('MagicalResistance', ''),
            'atk_min': udata.get('AttackDamageMin', ''),
            'atk_max': udata.get('AttackDamageMax', ''),
            'atk_rate': udata.get('AttackRate', ''),
            'atk_range': udata.get('AttackRange', ''),
            'atk_type': udata.get('AttackCapabilities', ''),
            'level': udata.get('Level', ''),
        }

    # Group by base unit (chess_X -> chess_X1 -> chess_X11)
    base_units = {}
    for uid in sorted(units_raw.keys()):
        if any(x in uid for x in SKIP_SUFFIXES):
            continue

        if uid.endswith('11') and uid[:-2] in units_raw:
            base, star = uid[:-2], 3
        elif uid.endswith('1') and not uid.endswith('11') and uid[:-1] in units_raw:
            base, star = uid[:-1], 2
        else:
            base, star = uid, 1

        if base not in base_units:
            base_units[base] = {}
        base_units[base][star] = units_raw[uid]

    # Build full unit output — only units in the active recruit pool
    units_full = {}
    units_simple = {}
    for base_id, stars in sorted(base_units.items()):
        if active_unit_ids and base_id not in active_unit_ids:
            continue
        star1 = stars.get(1, {})
        if not star1:
            continue

        # Display name from localization: chess_<id> gives "Dragon Knight★", strip decorations
        raw_name = loc.get(base_id, '')
        display_name = re.sub(r'[★☆✪♥♦◆●]', '', raw_name).strip()
        lore_name = loc.get(f'real_name_{base_id}', '')
        if not display_name:
            display_name = lore_name or base_id.replace('chess_', '').replace('_', ' ').title()

        # Cost from Level field
        cost_str = star1.get('level', '')
        cost = int(cost_str) if cost_str.isdigit() else None

        vpk_syns = get_synergies_for_unit(star1['abilities'])
        active_abs = get_active_abilities(star1['abilities'])

        stats = {}
        for sl in [1, 2, 3]:
            if sl in stars:
                s = stars[sl]
                stats[f'{sl}_star'] = {
                    'hp': int(s['hp']) if s['hp'] else 0,
                    'mana': int(s['mana']) if s['mana'] else 0,
                    'atk': [int(s['atk_min']) if s['atk_min'] else 0,
                            int(s['atk_max']) if s['atk_max'] else 0],
                    'armor': int(s['armor']) if s['armor'] else 0,
                    'magic_resist': int(s['magic_resist']) if s['magic_resist'] else 0,
                    'atk_rate': float(s['atk_rate']) if s['atk_rate'] else 0,
                    'atk_range': int(s['atk_range']) if s['atk_range'] else 0,
                }

        is_melee = 'MELEE' in star1.get('atk_type', '')

        # Multi-language names
        names = {'en': display_name}
        if lore_name:
            names['lore'] = lore_name
        for lang, lang_loc in all_loc.items():
            if lang == 'en':
                continue
            lang_raw = lang_loc.get(base_id, '')
            lang_name = re.sub(r'[★☆✪♥♦◆●]', '', lang_raw).strip()
            if lang_name:
                names[lang] = lang_name

        pool = unit_pool_map.get(base_id, 'standard')

        units_full[display_name] = {
            'id': base_id,
            'cost': cost,
            'pool': pool,
            'synergies': vpk_syns,
            'names': names,
            'attack_type': 'melee' if is_melee else 'ranged',
            'abilities': active_abs if active_abs else None,
            'stats': stats,
        }

        units_simple[display_name] = {
            'cost': cost,
            'pool': pool,
            'synergies': vpk_syns,
            'names': names,
        }

    return {
        'synergies': synergies,
        'items_full': items,
        'relics': {'relics': relics},
        'units_full': units_full,
        'units': {'units': units_simple},
    }


# ════════════════════════════════════════════════════════════════════
# Diff
# ════════════════════════════════════════════════════════════════════

def diff_dicts(old, new, path=''):
    """Deep diff two dicts. Returns list of (path, change_type, old_val, new_val)."""
    changes = []
    all_keys = set(list(old.keys()) + list(new.keys()))
    for k in sorted(all_keys):
        p = f'{path}.{k}' if path else k
        if k not in old:
            changes.append((p, 'added', None, new[k]))
        elif k not in new:
            changes.append((p, 'removed', old[k], None))
        elif isinstance(old[k], dict) and isinstance(new[k], dict):
            changes.extend(diff_dicts(old[k], new[k], p))
        elif old[k] != new[k]:
            changes.append((p, 'changed', old[k], new[k]))
    return changes


def print_diff(category, old_data, new_data):
    """Print a human-readable diff for a data category."""
    if old_data is None:
        print(f"  {category}: no previous data to compare")
        return

    old_keys = set(old_data.keys())
    new_keys = set(new_data.keys())

    added = new_keys - old_keys
    removed = old_keys - new_keys
    common = old_keys & new_keys

    if added:
        print(f"\n  {category} — ADDED ({len(added)}):")
        for k in sorted(added):
            label = new_data[k].get('name', k) if isinstance(new_data[k], dict) else k
            print(f"    + {label}")

    if removed:
        print(f"\n  {category} — REMOVED ({len(removed)}):")
        for k in sorted(removed):
            label = old_data[k].get('name', k) if isinstance(old_data[k], dict) else k
            print(f"    - {label}")

    changed_count = 0
    for k in sorted(common):
        if old_data[k] != new_data[k]:
            if changed_count == 0:
                print(f"\n  {category} — CHANGED:")
            changed_count += 1
            label = new_data[k].get('name', k) if isinstance(new_data[k], dict) else k
            changes = diff_dicts(
                old_data[k] if isinstance(old_data[k], dict) else {'value': old_data[k]},
                new_data[k] if isinstance(new_data[k], dict) else {'value': new_data[k]},
            )
            print(f"    ~ {label}:")
            for path, ctype, oval, nval in changes:
                if ctype == 'changed':
                    # Truncate long values
                    os = str(oval)[:80]
                    ns = str(nval)[:80]
                    print(f"        {path}: {os} → {ns}")
                elif ctype == 'added':
                    print(f"        {path}: + {str(nval)[:80]}")
                elif ctype == 'removed':
                    print(f"        {path}: - {str(oval)[:80]}")

    if not added and not removed and changed_count == 0:
        print(f"\n  {category}: no changes")


# ════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Extract DAC game data from VPK')
    parser.add_argument('vpk_path', nargs='?', help='Path to VPK file (auto-discovered if omitted)')
    parser.add_argument('--diff', metavar='OLD_DIR', help='Diff against previous extraction in OLD_DIR')
    parser.add_argument('--out', metavar='DIR', default=str(Path(__file__).parent),
                        help='Output directory (default: same as script)')
    args = parser.parse_args()

    # Find VPK
    if args.vpk_path:
        vpk_path = Path(args.vpk_path)
    else:
        vpk_path = find_vpk()

    if not vpk_path or not vpk_path.exists():
        print(f"ERROR: VPK not found. Searched:")
        for p in STEAM_SEARCH_PATHS:
            print(f"  {p}")
        print("Provide path as argument: python extract_vpk.py /path/to/file.vpk")
        sys.exit(1)

    print(f"VPK: {vpk_path}")
    print(f"Size: {vpk_path.stat().st_size / 1024 / 1024:.1f} MB")

    # Import vpk — try backend venv first, then system
    try:
        import vpk as vpk_mod
    except ImportError:
        venv_path = Path(__file__).parent.parent / 'app/backend/.venv/lib/python3.12/site-packages'
        sys.path.insert(0, str(venv_path))
        import vpk as vpk_mod

    pak = vpk_mod.open(str(vpk_path))
    print(f"Files in VPK: {len(list(pak))}")
    print()

    # Extract
    data = extract_all(pak)

    # Write output
    out_dir = Path(args.out)
    file_map = {
        'synergies': 'synergies.json',
        'items_full': 'items_full.json',
        'relics': 'relics.json',
        'units_full': 'units_full.json',
        'units': 'units.json',
    }

    for key, filename in file_map.items():
        out_path = out_dir / filename
        with open(out_path, 'w') as f:
            json.dump(data[key], f, indent=2, ensure_ascii=False)

    # Summary
    print(f"synergies.json:   {len(data['synergies'])} synergies")
    for sid, s in data['synergies'].items():
        print(f"  {s['name']}: tiers={s['tiers']}")

    qc = Counter(i['quality'] for i in data['items_full'].values())
    print(f"\nitems_full.json:  {len(data['items_full'])} items")
    print(f"  By quality: {dict(qc)}")

    relics_inner = data['relics'].get('relics', {})
    print(f"\nrelics.json:      {len(relics_inner)} relics")

    by_cost = Counter(u['cost'] for u in data['units_full'].values() if u['cost'])
    print(f"\nunits_full.json:  {len(data['units_full'])} units")
    print(f"  By cost: {dict(sorted(by_cost.items()))}")

    print(f"\nunits.json:       {len(data['units']['units'])} units")

    # ── Diff ──
    if args.diff:
        old_dir = Path(args.diff)
        print(f"\n{'='*60}")
        print(f"DIFF vs {old_dir}")
        print(f"{'='*60}")

        for key, filename in file_map.items():
            old_path = old_dir / filename
            if not old_path.exists():
                print(f"\n  {filename}: no previous file")
                continue

            with open(old_path) as f:
                old_data = json.load(f)

            new_data = data[key]

            # Unwrap containers
            if key == 'relics':
                old_inner = old_data.get('relics', old_data)
                new_inner = new_data.get('relics', new_data)
            elif key == 'units':
                old_inner = old_data.get('units', old_data)
                new_inner = new_data.get('units', new_data)
            else:
                old_inner = old_data
                new_inner = new_data

            print_diff(filename, old_inner, new_inner)


if __name__ == '__main__':
    main()
