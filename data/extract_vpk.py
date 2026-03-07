#!/usr/bin/env python3
"""Extract synergy, item, relic, and unit data from DAC VPK.

Writes:
  data/synergies.json   — clean synergy data with tiers, descriptions
  data/items_full.json  — clean item data with descriptions, quality
  data/relics.json      — relics with filled-in descriptions
  data/units_full.json  — full unit data with stats at each star level
"""
import sys, re, json
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent / 'tracker/.venv/lib/python3.12/site-packages'))
import vpk

DATA_DIR = Path(__file__).parent
VPK_PATH = '/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/570/1613886175/1613886175.vpk'
pak = vpk.open(VPK_PATH)

# ── Helpers ──

def strip_html(s):
    return re.sub(r'<[^>]+>', '', s).strip()

def parse_kv_block(text, start_pos):
    depth = 0
    i = start_pos
    while i < len(text):
        if text[i] == '{': depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0: return text[start_pos:i+1]
        i += 1
    return text[start_pos:]

def get_val(key, block):
    match = re.search(r'"' + re.escape(key) + r'"\s+"([^"]*)"', block)
    return match.group(1) if match else ''

def get_notes(prefix, loc):
    notes = []
    for i in range(10):
        nk = f'{prefix}_Note{i}'
        if nk in loc and loc[nk].strip():
            notes.append(loc[nk])
    return notes

def parse_ability_special(block):
    spec_m = re.search(r'"AbilitySpecial"\s*\{', block)
    if not spec_m:
        return {}
    spec_block = parse_kv_block(block, spec_m.end() - 1)
    special = {}
    for em in re.finditer(r'"(\d+)"\s*\{([^}]*)\}', spec_block):
        kvs = dict(re.findall(r'"([^"]+)"\s+"([^"]*)"', em.group(2)))
        for ek, ev in kvs.items():
            if ek != 'var_type':
                special[ek] = ev
    return special

# ── Read VPK files ──

raw_loc = pak['resource/addon_english.txt'].read().decode('utf-8')
loc = {}
for m in re.finditer(r'"([^"]+)"\s+"((?:[^"\\]|\\.)*)"', raw_loc):
    loc[m.group(1)] = m.group(2).replace('\\n', '\n').replace('\\t', '\t')

raw_abilities = pak['scripts/npc/npc_abilities_custom.txt'].read().decode('utf-8')
raw_items = pak['scripts/npc/npc_items_custom.txt'].read().decode('utf-8')
raw_units = pak['scripts/npc/npc_units_custom.txt'].read().decode('utf-8')

# ── Load existing units.json for name/cost mapping ──

with open(DATA_DIR / 'units.json') as f:
    existing_units = json.load(f)['units']

# ════════════════════════════════════════════════════════════════════
# 1. SYNERGIES
# ════════════════════════════════════════════════════════════════════

# Base synergies only: is_X where X has no underscores after the type name
# Filter: must exist in abilities file, must not be _banned/_buff variant
BASE_SYNERGY_IDS = set()
for k in loc:
    m2 = re.match(r'DOTA_Tooltip_ability_(is_[a-z]+)$', k)
    if m2:
        sid = m2.group(1)
        if sid in ('is_banned', 'is_ward'):
            continue
        if re.search(r'"' + re.escape(sid) + r'"\s*\{', raw_abilities):
            BASE_SYNERGY_IDS.add(sid)

synergies = {}
for sid in sorted(BASE_SYNERGY_IDS):
    prefix = f'DOTA_Tooltip_ability_{sid}'
    name = loc.get(prefix, sid)
    desc_html = loc.get(f'{prefix}_Description', loc.get(f'{prefix}_description', ''))
    lore = loc.get(f'{prefix}_Lore', '')
    notes = get_notes(prefix, loc)

    # Get AbilitySpecial from abilities file
    pattern = re.compile(r'"' + re.escape(sid) + r'"\s*\{', re.IGNORECASE)
    match = pattern.search(raw_abilities)
    special = {}
    if match:
        block = parse_kv_block(raw_abilities, match.end() - 1)
        special = parse_ability_special(block)

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

with open(DATA_DIR / 'synergies.json', 'w') as f:
    json.dump(synergies, f, indent=2, ensure_ascii=False)
print(f"synergies.json: {len(synergies)} synergies")
for sid, s in synergies.items():
    print(f"  {s['name']}: tiers={s['tiers']}")

# ════════════════════════════════════════════════════════════════════
# 2. ITEMS
# ════════════════════════════════════════════════════════════════════

# Find item IDs that actually exist in the items KV file (not _Description/_Lore suffixed)
item_ids = set()
for m in re.finditer(r'"(item_\w+)"\s*\{', raw_items):
    iid = m.group(1)
    item_ids.add(iid)

items = {}
for iid in sorted(item_ids):
    prefix = f'DOTA_Tooltip_ability_{iid}'
    name_raw = loc.get(prefix, iid)
    name = strip_html(name_raw)
    if not name or name == iid:
        continue  # skip items without localised names

    desc = strip_html(loc.get(f'{prefix}_Description', ''))
    lore = loc.get(f'{prefix}_Lore', '')
    notes = get_notes(prefix, loc)

    # Get quality/texture from items file
    pattern = re.compile(r'"' + re.escape(iid) + r'"\s*\{', re.IGNORECASE)
    match = pattern.search(raw_items)
    quality = ''
    texture = ''
    if match:
        block = parse_kv_block(raw_items, match.end() - 1)
        quality = get_val('ItemQuality', block)
        texture = get_val('AbilityTextureName', block)

    items[iid] = {
        'name': name,
        'description': desc,
        'lore': lore,
        'quality': quality,
        'texture': texture,
        'notes': notes,
    }

with open(DATA_DIR / 'items_full.json', 'w') as f:
    json.dump(items, f, indent=2, ensure_ascii=False)
qc = Counter(i['quality'] for i in items.values())
print(f"\nitems_full.json: {len(items)} items")
print(f"  By quality: {dict(qc)}")

# ════════════════════════════════════════════════════════════════════
# 3. RELICS
# ════════════════════════════════════════════════════════════════════

with open(DATA_DIR / 'relics.json') as f:
    relics_data = json.load(f)

filled = 0
for rid, rdata in relics_data['relics'].items():
    prefix = f'DOTA_Tooltip_ability_{rid}'
    desc = strip_html(loc.get(f'{prefix}_Description', loc.get(f'{prefix}_description', '')))
    if desc:
        rdata['description'] = desc
        filled += 1
    lore = loc.get(f'{prefix}_Lore', '')
    if lore:
        rdata['lore'] = lore

with open(DATA_DIR / 'relics.json', 'w') as f:
    json.dump(relics_data, f, indent=2, ensure_ascii=False)
print(f"\nrelics.json: filled {filled}/{len(relics_data['relics'])} descriptions")

# ════════════════════════════════════════════════════════════════════
# 4. UNITS (full stats)
# ════════════════════════════════════════════════════════════════════

# Parse all chess_* unit blocks
unit_pattern = re.compile(r'"(chess_\w+)"\s*\{')
units_raw = {}
for m in unit_pattern.finditer(raw_units):
    uid = m.group(1)
    block = parse_kv_block(raw_units, m.end() - 1)
    abilities = [get_val(f'Ability{i}', block) for i in range(1, 17)]
    abilities = [a for a in abilities if a]

    units_raw[uid] = {
        'abilities': abilities,
        'hp': get_val('StatusHealth', block),
        'mana': get_val('StatusMana', block),
        'armor': get_val('ArmorPhysical', block),
        'magic_resist': get_val('MagicalResistance', block),
        'atk_min': get_val('AttackDamageMin', block),
        'atk_max': get_val('AttackDamageMax', block),
        'atk_rate': get_val('AttackRate', block),
        'atk_range': get_val('AttackRange', block),
        'atk_type': get_val('AttackCapabilities', block),
    }

# Build synergy_id -> display name mapping
syn_id_to_name = {}
for sid, sdata in synergies.items():
    syn_id_to_name[sid] = sdata['name']

def get_synergies(abilities):
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

# Group by base unit (chess_X -> chess_X1 -> chess_X11)
# Skip summons, illusions, SSR variants, etc.
SKIP_SUFFIXES = ('_illusion', '_dragon', '_wolf', '_ssr', '_mohua', '_copy')
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

# Match chess_id -> display name via synergy fingerprint
synergy_to_display = {}
for name, data in existing_units.items():
    key = tuple(sorted(data['synergies']))
    if key not in synergy_to_display:
        synergy_to_display[key] = []
    synergy_to_display[key].append((name, data['cost']))

output = {}
unmatched = []
for base_id, stars in sorted(base_units.items()):
    star1 = stars.get(1, {})
    if not star1:
        continue

    vpk_syns = get_synergies(star1['abilities'])
    vpk_key = tuple(vpk_syns)

    display_name = None
    cost = None
    candidates = synergy_to_display.get(vpk_key, [])
    if len(candidates) == 1:
        display_name, cost = candidates[0]
    elif len(candidates) > 1:
        lore_name = loc.get(f'real_name_{base_id}', '')
        for cname, ccost in candidates:
            if lore_name.lower() in cname.lower() or cname.lower() in lore_name.lower():
                display_name, cost = cname, ccost
                break
        if not display_name:
            for cname, ccost in candidates:
                if cname not in output:
                    display_name, cost = cname, ccost
                    break

    if not display_name:
        lore_name = loc.get(f'real_name_{base_id}', base_id)
        unmatched.append((base_id, lore_name, vpk_syns))
        display_name = lore_name

    active_abs = get_active_abilities(star1['abilities'])

    stats = {}
    for sl in [1, 2, 3]:
        if sl in stars:
            s = stars[sl]
            stats[f'{sl}_star'] = {
                'hp': int(s['hp']) if s['hp'] else 0,
                'mana': int(s['mana']) if s['mana'] else 0,
                'atk': [int(s['atk_min']) if s['atk_min'] else 0, int(s['atk_max']) if s['atk_max'] else 0],
                'armor': int(s['armor']) if s['armor'] else 0,
                'magic_resist': int(s['magic_resist']) if s['magic_resist'] else 0,
                'atk_rate': float(s['atk_rate']) if s['atk_rate'] else 0,
                'atk_range': int(s['atk_range']) if s['atk_range'] else 0,
            }

    is_melee = 'MELEE' in star1.get('atk_type', '')

    output[display_name] = {
        'id': base_id,
        'cost': cost,
        'synergies': vpk_syns,
        'attack_type': 'melee' if is_melee else 'ranged',
        'abilities': active_abs if active_abs else None,
        'stats': stats,
    }

with open(DATA_DIR / 'units_full.json', 'w') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)
print(f"\nunits_full.json: {len(output)} units ({len(unmatched)} unmatched names)")
if unmatched:
    print("  Unmatched (using lore names):")
    for bid, lname, syns in unmatched:
        print(f"    {bid} -> {lname}: {syns}")

# Stats summary
by_cost = Counter(u['cost'] for u in output.values() if u['cost'])
print(f"  By cost: {dict(sorted(by_cost.items()))}")
