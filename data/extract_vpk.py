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
    # Windows native
    Path(f'C:/Program Files (x86)/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
    Path(f'C:/Program Files/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
    Path(f'D:/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
    Path(f'E:/Steam/steamapps/workshop/content/570/{WORKSHOP_ID}/{WORKSHOP_ID}.vpk'),
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

def unescape_kv(s):
    """Undo Valve KV1 literal-percent escape: "%%" -> "%"."""
    return s.replace('%%', '%') if s else s


_BLOCK_TAGS = r'h\d|p|div|li|ul|ol'


def strip_html(s):
    """Turn a VPK tooltip string into readable plain text.

    VPK descriptions use block-level tags like <h1>Active Ability:</h1> to
    separate a heading from the rule text. A naive tag-strip fuses them
    together ("<h1>Active ability: Instant</h1>Entangle..." -> "Active
    ability: InstantEntangle..."), which is the specific formatting rot on
    the /items page. We translate block tags and <br> into newlines before
    deleting the rest, then tighten a couple of cosmetic spacing cases.
    """
    if not s:
        return s
    s = unescape_kv(s)
    # Collapse consecutive identical headings (e.g. Assault Cuirass has two
    # "<h1>Aura</h1>" blocks in a row) so the rendered text reads as one
    # section with two lines instead of a repeated heading.
    h1_dup = re.compile(r'(<h1>([^<]+)</h1>[^<]*?)\s*<h1>\2</h1>', re.IGNORECASE)
    while True:
        new_s = h1_dup.sub(r'\1\n', s)
        if new_s == s:
            break
        s = new_s
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.IGNORECASE)
    s = re.sub(r'<\s*/?(?:' + _BLOCK_TAGS + r')(?:\s[^>]*)?>', '\n', s, flags=re.IGNORECASE)
    # Colored <font> tags wrap keyword labels (e.g. "Disarm", "Silence").
    # Replace with a space rather than a newline — the tag is inline emphasis,
    # not a block break. A newline here creates mid-sentence splits like
    # "Carrier counts as \nKobold."
    s = re.sub(r'<font\s+color=[^>]*>', ' ', s, flags=re.IGNORECASE)
    # Inline <img> icons (e.g. cooldown indicator followed by a number) add
    # no textual meaning — drop the tag plus any trailing whitespace + digits.
    s = re.sub(r"<img\s+src=[^>]*>\s*\d*\s*\.?", '', s, flags=re.IGNORECASE)
    s = re.sub(r'<[^>]+>', '', s)
    # Add a space where a word butts against +/- and a digit ("speed+30%" -> "speed +30%").
    s = re.sub(r'([A-Za-z])([+\-])(\d)', r'\1 \2\3', s)
    # Tighten whitespace before punctuation ("attack , lasting" -> "attack, lasting").
    s = re.sub(r'\s+([,.;:!?])', r'\1', s)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def clean_html_keep(s):
    """Strip KV escapes but keep HTML tags (for *_html fields)."""
    return unescape_kv(s).strip() if s else s


def get_notes(prefix, loc):
    notes = []
    for i in range(10):
        nk = f'{prefix}_Note{i}'
        if nk in loc and loc[nk].strip():
            notes.append(unescape_kv(loc[nk]))
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

    # ── Localized-string helper ──
    # Locales we surface in the JSON cache. Korean / Chinese parse fine
    # but only Russian is part of the SEO target right now. Add more
    # entries here to expand language support.
    LOCALE_KEYS = ('en', 'ru')
    _placeholder = re.compile(r'%([A-Za-z_][A-Za-z0-9_]*)%')

    def loc_strings(prefix, suffixes=('',), process=None, placeholders=None):
        """Return {locale: text} for a `DOTA_Tooltip_ability_*` style key.

        `suffixes` is iterated in order; the first non-empty hit per locale
        wins (handles `_Description` vs `_description` casing drift in the
        VPK). `process` defaults to `strip_html`. `placeholders` is the
        `_item_values` map for resolving `%token%` substitutions in item
        descriptions; passed through unchanged when None.
        """
        proc = process if process is not None else strip_html
        out = {}
        for lang in LOCALE_KEYS:
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
                raw = _placeholder.sub(
                    lambda m: str(placeholders.get(m.group(1), '?')), raw,
                )
            out[lang] = proc(raw)
        return out

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

        names_i18n = loc_strings(prefix)
        descs_i18n = loc_strings(prefix, ('_Description', '_description'))
        lore_i18n = loc_strings(prefix, ('_Lore',), process=unescape_kv)

        synergies[sid] = {
            'name': name,
            'names': names_i18n,
            'description': strip_html(desc_html),
            'descriptions': descs_i18n,
            'description_html': clean_html_keep(desc_html),
            'lore': unescape_kv(lore),
            'lore_i18n': lore_i18n,
            'notes': notes,
            'tiers': tiers,
            'ability_special': special,
        }
        syn_id_to_name[sid] = name

    # ════════════════════════════════════════════════════════════════
    # 2. ITEMS
    # ════════════════════════════════════════════════════════════════

    def _item_values(block):
        """Flatten AbilityValues and AbilitySpecial into a {name: value} map.

        VPK tooltips contain tokens like "%max_blink_distance%" that the game
        engine substitutes at render time from these blocks. We do the same so
        the exported description reads "Range: 800" instead of a raw token.
        """
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

    items = {}
    for iid, idata in sorted(items_kv.items()):
        if not iid.startswith('item_') or not isinstance(idata, dict):
            continue

        prefix = f'DOTA_Tooltip_ability_{iid}'
        name_raw = loc.get(prefix, iid)
        name = strip_html(name_raw)
        if not name or name == iid:
            continue

        values = _item_values(idata)
        raw_desc = loc.get(f'{prefix}_Description', '')
        # Unresolved tokens (values not declared on the item block) render as
        # "?" — a visible gap beats silently dropping the sentence.
        raw_desc = _placeholder.sub(
            lambda m: str(values.get(m.group(1), '?')), raw_desc,
        )
        desc = strip_html(raw_desc)
        lore = loc.get(f'{prefix}_Lore', '')
        notes = get_notes(prefix, loc)
        quality = idata.get('ItemQuality', '')
        texture = idata.get('AbilityTextureName', '')

        names_i18n = loc_strings(prefix)
        descs_i18n = loc_strings(
            prefix, ('_Description',), placeholders=values,
        )
        lore_i18n = loc_strings(prefix, ('_Lore',), process=unescape_kv)

        items[iid] = {
            'name': name,
            'names': names_i18n,
            'description': desc,
            'descriptions': descs_i18n,
            'lore': unescape_kv(lore),
            'lore_i18n': lore_i18n,
            'quality': quality,
            'texture': texture,
            'notes': notes,
        }

    # ════════════════════════════════════════════════════════════════
    # 3. RELICS
    # ════════════════════════════════════════════════════════════════

    # Most relic _Lore entries are just the placeholder "From Relic Box" /
    # "From: Relicbox" — no real flavour text. Drop those at the source so
    # consumers don't have to filter empty noise at render time. The
    # localized files use the same English placeholder, so this English
    # pattern catches every locale.
    relic_box_lore = re.compile(r'^\s*from:?\s*relic\s*box\s*$', re.IGNORECASE)

    def clean_relic_lore(value):
        if value and relic_box_lore.match(value):
            return ''
        return value

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

        names_i18n = loc_strings(prefix)
        descs_i18n = loc_strings(prefix, ('_Description', '_description'))
        lore_i18n = {
            lang: cleaned
            for lang, cleaned in (
                (lang, clean_relic_lore(v))
                for lang, v in loc_strings(
                    prefix, ('_Lore',), process=unescape_kv,
                ).items()
            )
            if cleaned
        }

        relics[iid] = {
            'name': name,
            'names': names_i18n,
            'description': desc,
            'descriptions': descs_i18n,
            'lore': clean_relic_lore(unescape_kv(lore)),
            'lore_i18n': lore_i18n,
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

    # Build aliases: common/community names → canonical VPK names
    # These handle Drodo's quirky localisation vs what players actually say
    KNOWN_ALIASES = {
        'Spectre': 'Spectres',
        'Blood Seeker': 'Bloodseeker',
        'Bloodseeker': 'Blood Seeker',
        'Dark Seer': 'DarkSeer',
        'DarkSeer': 'Dark Seer',
        'IO': 'Io',
        'Io': 'IO',
        'Keeper Of The Light': 'Keeper of the Light',
        'Keeper of the Light': 'Keeper Of The Light',
        'Queen Of Pain': 'Queen of Pain',
        'Queen of Pain': 'Queen Of Pain',
    }
    # Only include aliases where the target exists and the alias doesn't
    aliases = {}
    all_names = set(units_full.keys())
    for alias, canonical in KNOWN_ALIASES.items():
        if canonical in all_names and alias not in all_names:
            aliases[alias] = canonical

    # ════════════════════════════════════════════════════════════════
    # 5. ABILITIES (non-synergy active abilities used by active units)
    # ════════════════════════════════════════════════════════════════

    def flatten_ability_special(block):
        """Flatten AbilitySpecial dict into {field: value}."""
        out = {}
        ab_special = block.get('AbilitySpecial', {})
        if isinstance(ab_special, dict):
            for _, fields in ab_special.items():
                if isinstance(fields, dict):
                    for fk, fv in fields.items():
                        if fk != 'var_type':
                            out[fk] = fv
        return out

    abilities_out = {}
    seen_abilities = set()
    for base_id, stars in base_units.items():
        if active_unit_ids and base_id not in active_unit_ids:
            continue
        for sl, sdata in stars.items():
            for ab in sdata.get('abilities', []):
                if ab.startswith('is_') or ab in ('no_collision', 'dac_guai_base', '') or ab in seen_abilities:
                    continue
                seen_abilities.add(ab)
                ab_block = abilities_kv.get(ab, {})
                if not isinstance(ab_block, dict):
                    continue
                name = strip_html(loc.get(f'DOTA_Tooltip_ability_{ab}', ''))
                if not name:
                    continue
                desc_html = loc.get(f'DOTA_Tooltip_ability_{ab}_Description', '')
                cooldown = ab_block.get('AbilityCooldown', '')
                mana = ab_block.get('AbilityManaCost', '')
                cast = ab_block.get('AbilityCastRange', '')
                abilities_out[ab] = {
                    'name': name,
                    'description': strip_html(desc_html),
                    'cooldown': cooldown,
                    'mana_cost': mana,
                    'cast_range': cast,
                    'ability_special': flatten_ability_special(ab_block),
                }

    # ════════════════════════════════════════════════════════════════
    # 6. TALENTS (from localization talent_<tier><slot>_<field>)
    # ════════════════════════════════════════════════════════════════

    talents_out = {}
    for k, v in loc.items():
        m = re.match(r'^talent_(\d+[ab])_(title|description)$', k)
        if not m:
            continue
        slot, field = m.group(1), m.group(2)
        talents_out.setdefault(slot, {})[field] = v

    # ════════════════════════════════════════════════════════════════
    # 7. GAME MODE CONSTANTS (from addon_game_mode.lua)
    # ════════════════════════════════════════════════════════════════

    def extract_lua_list(name):
        m = re.search(re.escape(name) + r'\s*=\s*\{', raw_lua)
        if not m:
            return None
        start = m.end()
        depth = 1
        i = start
        while i < len(raw_lua) and depth > 0:
            if raw_lua[i] == '{': depth += 1
            elif raw_lua[i] == '}': depth -= 1
            i += 1
        block = re.sub(r'--.*', '', raw_lua[start:i - 1])
        return re.findall(r'"(item_\w+)"|\'(item_\w+)\'', block)

    def extract_lua_number(name):
        m = re.search(re.escape(name) + r'\s*=\s*(-?\d+\.?\d*)', raw_lua)
        return float(m.group(1)) if m else None

    drop_relic_list = []
    quest_relic_list = []
    for m in re.finditer(r'DROP_RELIC_LIST\s*=\s*\{([^}]*)\}', raw_lua):
        block = re.sub(r'--.*', '', m.group(1))
        drop_relic_list = re.findall(r'"(item_\w+)"', block)
    for m in re.finditer(r'quest_2_relic_list\s*=\s*\{([^}]*)\}', raw_lua):
        block = re.sub(r'--.*', '', m.group(1))
        quest_relic_list = re.findall(r'"(item_\w+)"', block)

    game_mode_out = {
        'drop_relic_list': drop_relic_list,
        'quest_2_relic_list': quest_relic_list,
        'prepare_timer': extract_lua_number('_G.prepare_timer'),
        'battle_timer': extract_lua_number('_G.battle_timer'),
    }

    return {
        'synergies': synergies,
        'items_full': items,
        'relics': {'relics': relics},
        'units_full': units_full,
        'units': {'units': units_simple, 'aliases': aliases},
        'abilities': abilities_out,
        'talents': talents_out,
        'game_mode': game_mode_out,
    }


# ════════════════════════════════════════════════════════════════════
# Text corrections
# ════════════════════════════════════════════════════════════════════

def load_corrections(data_dir):
    """Load text_corrections.json. Returns a list of compiled corrections,
    or [] if the file is missing or malformed."""
    path = Path(data_dir) / 'text_corrections.json'
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding='utf-8'))
    out = []
    for entry in raw.get('corrections', []):
        find = entry.get('find')
        replace = entry.get('replace', '')
        if not find:
            continue
        try:
            pattern = re.compile(find)
        except re.error as exc:
            print(f"  text_corrections: skipping invalid regex {find!r}: {exc}")
            continue
        where = entry.get('where')
        out.append({
            'pattern': pattern,
            'replace': replace,
            'where': set(where) if where else None,
            'raw': find,
        })
    return out


def apply_corrections_to_value(value, corrections, kind):
    """Recursively apply corrections to every string inside `value`.

    `kind` is the top-level dataset name (e.g. 'items_full'); a correction
    with a `where` filter is only applied when its filter contains `kind`.
    """
    if isinstance(value, str):
        out = value
        for c in corrections:
            if c['where'] is not None and kind not in c['where']:
                continue
            out = c['pattern'].sub(c['replace'], out)
        return out
    if isinstance(value, dict):
        return {k: apply_corrections_to_value(v, corrections, kind) for k, v in value.items()}
    if isinstance(value, list):
        return [apply_corrections_to_value(v, corrections, kind) for v in value]
    return value


def apply_corrections(data, corrections):
    """Apply corrections in place to the data bundle from `extract_all`."""
    if not corrections:
        return data
    for kind, payload in data.items():
        data[kind] = apply_corrections_to_value(payload, corrections, kind)
    return data


# ════════════════════════════════════════════════════════════════════
# items.json reconciliation
# ════════════════════════════════════════════════════════════════════

def reconcile_items_json(out_dir, items_full):
    """Reconcile the hand-curated items.json tier list against VPK canonical
    names. items.json is the source of truth for *which* items the game
    actually uses (the VPK contains unused/test items too, so we don't
    auto-generate it). But its keys drift from the VPK localization over time
    — "Gossamar Cape" vs "Gossamer Cape", "Spider Legs" vs "Spider Leg" — and
    every drifted key silently breaks the /items page join that fetches
    descriptions.

    On each extraction, auto-rename any items.json key whose normalized form
    matches a VPK name via a fuzzy heuristic (normalized equality, trailing
    's' toggle, difflib close match). Warn loudly about anything that can't
    be reconciled so the curator can investigate.
    """
    import difflib
    items_path = Path(out_dir) / 'items.json'
    if not items_path.exists():
        return
    data = json.loads(items_path.read_text(encoding='utf-8'))
    simple = data.get('items', data)

    def norm(s):
        return s.lower().replace(' ', '').replace("'", '')

    full_by_norm = {}
    for v in items_full.values():
        if v.get('name'):
            full_by_norm[norm(v['name'])] = v['name']

    renames = {}
    orphans = []
    for name in list(simple.keys()):
        n = norm(name)
        # 1. exact normalized match
        if n in full_by_norm:
            canonical = full_by_norm[n]
            if canonical != name:
                renames[name] = canonical
            continue
        # 2. toggle trailing 's' ("Spider Legs" -> "Spider Leg")
        alt = n[:-1] if n.endswith('s') else n + 's'
        if alt in full_by_norm:
            renames[name] = full_by_norm[alt]
            continue
        # 3. fuzzy close-match as last resort
        close = difflib.get_close_matches(n, full_by_norm.keys(), n=1, cutoff=0.85)
        if close:
            renames[name] = full_by_norm[close[0]]
            continue
        orphans.append(name)

    if renames:
        print(f"\nitems.json reconcile: renaming {len(renames)} drifted key(s)")
        new_items = {}
        for k, v in simple.items():
            new_items[renames.get(k, k)] = v
        if 'items' in data:
            data['items'] = new_items
        else:
            data = new_items
        items_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + '\n',
            encoding='utf-8',
        )
        for old, new in renames.items():
            print(f"  {old!r:<30s} -> {new!r}")

    if orphans:
        print(f"\nitems.json orphans ({len(orphans)}) — no VPK match, check manually:")
        for o in orphans:
            print(f"  {o!r}")


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
                    print(f"        {path}: {os} -> {ns}")
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
    parser.add_argument('--push-cms', action='store_true',
                        help='After extraction, push the JSON files to the Sanity CMS '
                             '(requires SANITY_PROJECT_ID and SANITY_TOKEN; see cms/README.md).')
    parser.add_argument('--cms-only', nargs='+',
                        choices=['synergies', 'units', 'items', 'relics', 'talents',
                                 'abilities', 'gameMode'],
                        help='When pushing to CMS, only push these kinds.')
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

    # Apply text corrections (typo fixes baked into source-of-truth JSON)
    corrections = load_corrections(Path(args.out))
    if corrections:
        print(f"text_corrections: applying {len(corrections)} rule(s)")
        apply_corrections(data, corrections)

    # Write output
    out_dir = Path(args.out)
    file_map = {
        'synergies': 'synergies.json',
        'items_full': 'items_full.json',
        'relics': 'relics.json',
        'units_full': 'units_full.json',
        'abilities': 'abilities.json',
        'talents': 'talents.json',
        'game_mode': 'game_mode.json',
        'units': 'units.json',
    }

    for key, filename in file_map.items():
        out_path = out_dir / filename
        # Preserve existing icon_url / icon_dimensions (from Sanity CDN)
        # that the VPK doesn't carry.
        if out_path.exists():
            try:
                with open(out_path, encoding='utf-8') as f:
                    existing = json.load(f)
                # Unwrap containers like {"units": {...}} or {"relics": {...}}
                inner_key = None
                for ik in ('units', 'relics', 'items'):
                    if isinstance(existing, dict) and ik in existing and isinstance(existing[ik], dict):
                        inner_key = ik
                        break
                existing_records = existing[inner_key] if inner_key else existing
                new_data = data[key]
                new_records = new_data[inner_key] if inner_key and isinstance(new_data, dict) and inner_key in new_data else new_data
                if isinstance(existing_records, dict) and isinstance(new_records, dict):
                    for rec_key, rec in new_records.items():
                        if isinstance(rec, dict) and rec_key in existing_records:
                            old = existing_records[rec_key]
                            if isinstance(old, dict):
                                if old.get('icon_url') and not rec.get('icon_url'):
                                    rec['icon_url'] = old['icon_url']
                                if old.get('icon_dimensions') and not rec.get('icon_dimensions'):
                                    rec['icon_dimensions'] = old['icon_dimensions']
            except Exception:
                pass
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(data[key], f, indent=2, ensure_ascii=False)

    # ── Extract item/synergy/relic icons from VPK ──
    icons_dir = out_dir / 'icons'
    icon_count = 0
    icon_sources = {
        'items': {it.get('texture', ''): it['name'] for it in data['items_full'].values() if it.get('texture')},
        'synergies': {},
        'relics': {},
    }
    for sid, syn in data['synergies'].items():
        game_id = sid.replace('is_', '')
        icon_sources['synergies'][game_id] = syn['name']
    for rid, rel in data['relics'].get('relics', {}).items():
        game_id = rid.replace('item_', '')
        icon_sources['relics'][game_id] = rel.get('name', rid)

    vpk_icon_prefixes = [
        'resource/flash3/images/spellicons/custom/',
        'resource/flash3/images/spellicons/',
        'resource/flash3/images/items/',
    ]
    vpk_files = {f.lower(): f for f in pak}

    for category, textures in icon_sources.items():
        cat_dir = icons_dir / category
        cat_dir.mkdir(parents=True, exist_ok=True)
        for texture, name in textures.items():
            stem = texture.replace('item_custom/', '').replace('custom/', '').replace('item_', '')
            out_path = cat_dir / f'{stem}.png'
            if out_path.exists():
                continue
            found = False
            for prefix in vpk_icon_prefixes:
                vpk_key = f'{prefix}{texture}.png'.lower()
                if vpk_key in vpk_files:
                    entry = pak[vpk_files[vpk_key]]
                    out_path.write_bytes(entry.read())
                    icon_count += 1
                    found = True
                    break
                vpk_key2 = f'{prefix}{stem}.png'.lower()
                if vpk_key2 in vpk_files:
                    entry = pak[vpk_files[vpk_key2]]
                    out_path.write_bytes(entry.read())
                    icon_count += 1
                    found = True
                    break

    if icon_count:
        print(f"\nIcons: extracted {icon_count} new icon(s) from VPK")

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
    print(f"\nabilities.json:   {len(data['abilities'])} active abilities")
    print(f"talents.json:     {len(data['talents'])} talent slots")
    gm = data['game_mode']
    print(f"game_mode.json:   {len(gm['drop_relic_list'])} drop relics, prepare_timer={gm['prepare_timer']}, battle_timer={gm['battle_timer']}")

    # ── Audit hand-curated items.json against VPK canonical names ──
    reconcile_items_json(out_dir, data['items_full'])

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

            with open(old_path, encoding='utf-8') as f:
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

    # ── Push to CMS ──
    if args.push_cms:
        print(f"\n{'=' * 60}")
        print('PUSH → SANITY CMS')
        print(f"{'=' * 60}")
        # Local import so the rest of the script works without a populated env.
        from cms_push import push_all  # noqa: WPS433 (intentional local import)
        push_all(
            data_dir=out_dir,
            only=set(args.cms_only) if args.cms_only else None,
        )


if __name__ == '__main__':
    main()
