#!/usr/bin/env python3
"""Extract all game data from the Dota Auto Chess VPK.

Proper Valve KV1 parser, no external dependencies beyond `vpk`.
Auto-discovers VPK from local Steam installation.
Diff mode: --diff <old_dir> shows what changed.

Writes:
  content/game/*        — CMS-format game data records
  data/icons/*          — extracted icon assets

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


def lua_tokens(source):
    """Tokenize enough Lua to distinguish table syntax from comments/strings.

    String contents retain their source escapes; this is not a Lua evaluator.
    """
    long_pattern = re.compile(r'\[(=*)\[')
    identifier_pattern = re.compile(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*')
    newline_pattern = re.compile(r'[\r\n]')
    pos = 0
    while pos < len(source):
        if source[pos].isspace():
            pos += 1
            continue
        comment = source.startswith('--', pos)
        start = pos + 2 if comment else pos
        long_open = long_pattern.match(source, start)
        if long_open:
            content_start = long_open.end()
            close = ']' + long_open.group(1) + ']'
            end = source.find(close, content_start)
            if end == -1:
                return
            if not comment:
                yield ('string', source[content_start:end])
            pos = end + len(close)
        elif comment:
            end = newline_pattern.search(source, start)
            pos = end.start() if end else len(source)
        elif source[pos] in "\"'":
            quote = source[pos]
            start = pos + 1
            pos = start
            while pos < len(source) and source[pos] != quote:
                pos += 2 if source[pos] == '\\' else 1
            if pos >= len(source):
                return
            yield ('string', source[start:pos])
            pos += 1
        else:
            identifier = identifier_pattern.match(source, pos)
            if identifier:
                yield ('identifier', identifier.group())
                pos = identifier.end()
            else:
                yield ('symbol', source[pos])
                pos += 1


def extract_lua_string_map(raw_lua, name):
    """Extract a flat literal string table, ignoring commented/quoted Lua."""
    tokens = list(lua_tokens(raw_lua))
    for start in range(len(tokens) - 2):
        if tokens[start:start + 3] == [
            ('identifier', name), ('symbol', '='), ('symbol', '{'),
        ]:
            break
    else:
        return {}

    result = {}
    depth = 1
    for pos in range(start + 3, len(tokens)):
        kind, value = tokens[pos]
        if (kind, value) == ('symbol', '{'):
            depth += 1
        elif (kind, value) == ('symbol', '}'):
            depth -= 1
            if depth == 0:
                return result
        elif depth == 1 and kind == 'identifier' and pos + 2 < len(tokens):
            if tokens[pos + 1] == ('symbol', '=') and tokens[pos + 2][0] == 'string':
                result[value] = tokens[pos + 2][1]
    return {}


def collect_unit_ability_ids(stars, mapped_ability=None):
    """Collect unique unit-KV abilities plus the live Lua gameplay ability."""
    abilities = []
    for star in sorted(stars):
        for ability in stars[star].get('abilities', []):
            if ability not in abilities:
                abilities.append(ability)
    if mapped_ability and mapped_ability not in abilities:
        abilities.append(mapped_ability)
    return abilities


def ability_localized_value(loc, ability, suffix=''):
    """Read standard tooltip localization, falling back to a plain Lua key."""
    return loc.get(
        f'DOTA_Tooltip_ability_{ability}{suffix}',
        loc.get(f'{ability}{suffix}', ''),
    )


def resolve_tooltip_placeholders(value, numbers):
    """Substitute VPK ``%field%`` tokens with extracted ability numbers."""
    return re.sub(
        r'%([A-Za-z_][A-Za-z0-9_]*)%',
        lambda match: str(numbers.get(match.group(1), '?')),
        value,
    )


def flatten_ability_numbers(block):
    """Flatten modern AbilityValues and legacy AbilitySpecial numeric fields."""
    out = {}
    ability_values = block.get('AbilityValues', {})
    if isinstance(ability_values, dict):
        for field, value in ability_values.items():
            if isinstance(value, dict):
                value = value.get('value')
            if value is not None and not isinstance(value, dict):
                out[field] = value

    ability_special = block.get('AbilitySpecial', {})
    if isinstance(ability_special, dict):
        for fields in ability_special.values():
            if not isinstance(fields, dict):
                continue
            for field, value in fields.items():
                if field != 'var_type' and not isinstance(value, dict):
                    out[field] = value
    return out


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
    # Locales we surface in the JSON cache. Korean parses fine too, but the
    # public item switcher currently exposes English, Russian, and Chinese.
    LOCALE_KEYS = ('en', 'ru', 'zh-cn', 'zh-tw')
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
    raw_lua = pak['scripts/vscripts/addon_game_mode.lua'].read().decode('utf-8', errors='replace')

    abilities_kv = parse_kv(raw_abilities)
    items_kv = parse_kv(raw_items)
    units_kv = parse_kv(raw_units)
    lua_ability_by_unit = extract_lua_string_map(
        raw_lua, '_G.chess_ability_list_base',
    )
    if not lua_ability_by_unit:
        raise RuntimeError(
            'Could not parse _G.chess_ability_list_base from addon_game_mode.lua',
        )

    # Unwrap top-level container (e.g. "DOTAAbilities" { ... })
    if len(abilities_kv) == 1:
        abilities_kv = next(iter(abilities_kv.values()))
    if len(items_kv) == 1:
        items_kv = next(iter(items_kv.values()))
    if len(units_kv) == 1:
        units_kv = next(iter(units_kv.values()))

    def extract_lua_item_ids(name):
        m = re.search(re.escape(name) + r'\s*=\s*\{', raw_lua)
        if not m:
            return []
        start = m.end()
        depth = 1
        i = start
        while i < len(raw_lua) and depth > 0:
            if raw_lua[i] == '{':
                depth += 1
            elif raw_lua[i] == '}':
                depth -= 1
            i += 1
        block = re.sub(r'--.*', '', raw_lua[start:i - 1])
        return re.findall(r'"(item_\w+)"|\'(item_\w+)\'', block)

    def flatten_lua_ids(matches):
        return [a or b for a, b in matches]

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

    # npc_items_custom contains every item definition, including old, commented,
    # test, generated, and helper records. The live normal item pool is the Lua
    # tier table.
    active_item_ids = set(flatten_lua_ids(extract_lua_item_ids('_G.ITEM_LIST_BY_LEVEL')))
    if not active_item_ids:
        raise RuntimeError('Could not parse _G.ITEM_LIST_BY_LEVEL from addon_game_mode.lua')

    items = {}
    for iid, idata in sorted(items_kv.items()):
        if not iid.startswith('item_') or not isinstance(idata, dict):
            continue
        if iid not in active_item_ids:
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

    # Extract active relic IDs from DROP_RELIC_LIST in addon_game_mode.lua.
    # Note: quest_2_relic_list has seasonal/quest relics — not included
    relic_ids = flatten_lua_ids(extract_lua_item_ids('_G.DROP_RELIC_LIST'))
    if not relic_ids:
        raise RuntimeError('Could not parse _G.DROP_RELIC_LIST from addon_game_mode.lua')
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
            ab_name = ability_localized_value(loc, ab)
            numbers = flatten_ability_numbers(abilities_kv.get(ab, {}))
            ab_desc = strip_html(resolve_tooltip_placeholders(
                ability_localized_value(loc, ab, '_Description'),
                numbers,
            ))
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

        unit_ability_ids = collect_unit_ability_ids(
            stars, lua_ability_by_unit.get(base_id),
        )
        vpk_syns = get_synergies_for_unit(star1['abilities'])
        active_abs = get_active_abilities(unit_ability_ids)

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

    abilities_out = {}
    seen_abilities = set()
    for base_id, stars in base_units.items():
        if active_unit_ids and base_id not in active_unit_ids:
            continue
        ability_ids = collect_unit_ability_ids(
            stars, lua_ability_by_unit.get(base_id),
        )
        for ab in ability_ids:
            if ab.startswith('is_') or ab in ('no_collision', 'dac_guai_base', '') or ab in seen_abilities:
                continue
            seen_abilities.add(ab)
            ab_block = abilities_kv.get(ab, {})
            if not isinstance(ab_block, dict):
                continue
            name = strip_html(ability_localized_value(loc, ab))
            if not name:
                continue
            numbers = flatten_ability_numbers(ab_block)
            desc_html = resolve_tooltip_placeholders(
                ability_localized_value(loc, ab, '_Description'),
                numbers,
            )
            cooldown = ab_block.get('AbilityCooldown', '')
            mana = ab_block.get('AbilityManaCost', '')
            cast = ab_block.get('AbilityCastRange', '')
            abilities_out[ab] = {
                'name': name,
                'description': strip_html(desc_html),
                'cooldown': cooldown,
                'mana_cost': mana,
                'cast_range': cast,
                'ability_special': numbers,
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

    def extract_lua_number(name):
        m = re.search(re.escape(name) + r'\s*=\s*(-?\d+\.?\d*)', raw_lua)
        return float(m.group(1)) if m else None

    game_mode_out = {
        'item_list_by_level': sorted(active_item_ids),
        'drop_relic_list': relic_ids,
        'quest_2_relic_list': flatten_lua_ids(extract_lua_item_ids('quest_2_relic_list')),
        'prepare_timer': extract_lua_number('_G.prepare_timer'),
        'battle_timer': extract_lua_number('_G.battle_timer'),
    }

    return {
        'synergies': synergies,
        'items_full': items,
        'relics': {'relics': relics},
        'units_full': units_full,
        'aliases': aliases,
        'abilities': abilities_out,
        'talents': talents_out,
        'game_mode': game_mode_out,
    }


# ════════════════════════════════════════════════════════════════════
# Text corrections
# ════════════════════════════════════════════════════════════════════

def load_corrections(game_dir):
    """Load text-corrections.json. Returns a list of compiled corrections,
    or [] if the file is missing or malformed."""
    path = Path(game_dir) / 'text-corrections.json'
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
            print(f"  text-corrections: skipping invalid regex {find!r}: {exc}")
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
# Content output
# ════════════════════════════════════════════════════════════════════

def slugify(value):
    return re.sub(r'[^a-z0-9]+', '-', str(value).lower().replace('&', ' and ')).strip('-')[:80]


UNIT_STEM_MAP = {
    'Blood Seeker': 'bloodseeker',
    'Spectres': 'spectre',
    'DarkSeer': 'dark_seer',
}


SYN_ICON_MAP = {
    'Demon Hunter': 'demonhunter',
    'Elemental': 'element',
    'Faceless': 'nraqi',
    'Pandaren': 'pandaman',
}


def read_json_if_exists(path):
    if not path.exists():
        return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write('\n')


def content_icon_ref(icons_dir, category, stem):
    file = f'{category}/{stem}.png'
    return file if (icons_dir / file).exists() else None


def unit_icon_stem(name):
    return UNIT_STEM_MAP.get(name) or name.lower().replace(' ', '_').replace('-', '_').replace("'", '')


def item_icon_stem(game_id, item):
    stem = item.get('texture') or game_id
    return (
        stem.replace('item_custom/', '')
        .replace('custom/', '')
        .replace('item_', '')
        .lower()
        .replace(' ', '_')
        .replace('-', '_')
    )


def synergy_icon_stem(name):
    return SYN_ICON_MAP.get(name) or name.lower().replace(' ', '')


def relic_icon_stem(name):
    return name.lower().replace(' ', '_').replace('-', '_')


def content_entity(game_id, name, source, icon, existing):
    existing = existing or {}
    source_without_legacy_icons = dict(source)
    source_without_legacy_icons.pop('icon', None)
    source_without_legacy_icons.pop('icon_url', None)
    source_without_legacy_icons.pop('icon_dimensions', None)
    entity = {
        'gameId': game_id,
        'name': name,
        'slug': slugify(name or game_id),
        'source': source_without_legacy_icons,
        'overrides': existing.get('overrides', {}),
    }
    if existing.get('commentary'):
        entity['commentary'] = existing['commentary']
    if 'relatedEntities' in existing:
        entity['relatedEntities'] = existing['relatedEntities']
    if icon:
        entity['icon'] = icon
    return entity


def write_content_outputs(content_dir, icons_dir, data, aliases):
    game_dir = content_dir / 'game'

    write_json(game_dir / 'aliases.json', aliases)
    write_json(game_dir / 'game-mode.json', data['game_mode'])

    for name, unit in sorted(data['units_full'].items()):
        game_id = unit.get('id') or slugify(name)
        path = game_dir / 'units' / f'{slugify(name)}.json'
        write_json(
            path,
            content_entity(
                game_id,
                name,
                unit,
                content_icon_ref(icons_dir, 'units', unit_icon_stem(name)),
                read_json_if_exists(path),
            ),
        )

    for game_id, item in sorted(data['items_full'].items()):
        name = item.get('name') or game_id
        path = game_dir / 'items' / f'{game_id}.json'
        write_json(
            path,
            content_entity(
                game_id,
                name,
                item,
                content_icon_ref(icons_dir, 'items', item_icon_stem(game_id, item)),
                read_json_if_exists(path),
            ),
        )

    for game_id, synergy in sorted(data['synergies'].items()):
        name = synergy.get('name') or game_id
        path = game_dir / 'synergies' / f'{game_id}.json'
        write_json(
            path,
            content_entity(
                game_id,
                name,
                synergy,
                content_icon_ref(icons_dir, 'synergies', synergy_icon_stem(name)),
                read_json_if_exists(path),
            ),
        )

    for game_id, relic in sorted(data['relics'].get('relics', {}).items()):
        name = relic.get('name') or game_id
        path = game_dir / 'relics' / f'{game_id}.json'
        write_json(
            path,
            content_entity(
                game_id,
                name,
                relic,
                content_icon_ref(icons_dir, 'relics', relic_icon_stem(name)),
                read_json_if_exists(path),
            ),
        )

    for slot, talent in sorted(data['talents'].items()):
        path = game_dir / 'talents' / f'{slugify(slot)}.json'
        write_json(path, {'slot': slot, **talent})

    for game_id, ability in sorted(data['abilities'].items()):
        path = game_dir / 'abilities' / f'{game_id}.json'
        write_json(path, {'gameId': game_id, **ability})


def _content_source(entry):
    return entry.get('source') if isinstance(entry.get('source'), dict) else entry


def _read_content_collection(game_dir, relative_dir, key_by):
    collection_dir = game_dir / relative_dir
    if not collection_dir.exists():
        return {}
    records = {}
    for path in sorted(collection_dir.glob('*.json')):
        entry = read_json_if_exists(path)
        if not isinstance(entry, dict):
            continue
        key = key_by(entry)
        if key:
            records[key] = _content_source(entry)
    return records


def read_content_snapshot(content_dir):
    base_dir = Path(content_dir)
    game_dir = base_dir / 'game' if (base_dir / 'game').exists() else base_dir
    game_mode = read_json_if_exists(game_dir / 'game-mode.json') or {}
    return {
        'synergies': _read_content_collection(game_dir, 'synergies', lambda e: e.get('gameId') or e.get('slug')),
        'items_full': _read_content_collection(game_dir, 'items', lambda e: e.get('gameId') or e.get('slug')),
        'relics': {'relics': _read_content_collection(game_dir, 'relics', lambda e: e.get('gameId') or e.get('slug'))},
        'units_full': _read_content_collection(game_dir, 'units', lambda e: e.get('name') or e.get('slug')),
        'abilities': _read_content_collection(game_dir, 'abilities', lambda e: e.get('gameId') or e.get('slug')),
        'talents': _read_content_collection(game_dir, 'talents', lambda e: e.get('slot') or e.get('slug')),
        'game_mode': game_mode,
    }


# ════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Extract DAC game data from VPK')
    parser.add_argument('vpk_path', nargs='?', help='Path to VPK file (auto-discovered if omitted)')
    parser.add_argument('--diff', metavar='OLD_CONTENT_DIR', help='Diff against a previous content/ snapshot')
    parser.add_argument('--out', metavar='DIR', default=str(Path(__file__).parent.parent / 'content'),
                        help='Content output directory (default: repo content/)')
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
        backend_venv = Path(__file__).parent.parent / 'app/backend/.venv'
        for venv_path in (
            backend_venv / 'Lib/site-packages',
            backend_venv / 'lib/python3.12/site-packages',
        ):
            sys.path.insert(0, str(venv_path))
        import vpk as vpk_mod

    pak = vpk_mod.open(str(vpk_path))
    print(f"Files in VPK: {len(list(pak))}")
    print()

    # Extract
    data = extract_all(pak)

    # Aliases (alt name spellings → canonical) are written verbatim. Pull them
    # out before text corrections run: a `where`-less rule could rewrite a
    # canonical target and silently break the alias → unit mapping.
    aliases = data.pop('aliases', {})

    # Apply text corrections (typo fixes baked into source-of-truth JSON)
    out_dir = Path(args.out)
    game_dir = out_dir / 'game'
    icons_dir = Path(__file__).parent / 'icons'

    corrections = load_corrections(game_dir)
    if corrections:
        print(f"text-corrections: applying {len(corrections)} rule(s)")
        apply_corrections(data, corrections)

    # ── Extract item/synergy/relic icons from VPK ──
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
            output_stem = relic_icon_stem(name) if category == 'relics' else stem
            out_path = cat_dir / f'{output_stem}.png'
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

    write_content_outputs(out_dir, icons_dir, data, aliases)
    print(f"content: wrote game entities to {game_dir}")

    # Summary
    print(f"synergies:        {len(data['synergies'])} synergies")
    for sid, s in data['synergies'].items():
        print(f"  {s['name']}: tiers={s['tiers']}")

    qc = Counter(i['quality'] for i in data['items_full'].values())
    print(f"\nitems:            {len(data['items_full'])} items")
    print(f"  By quality: {dict(qc)}")

    relics_inner = data['relics'].get('relics', {})
    print(f"\nrelics:           {len(relics_inner)} relics")

    by_cost = Counter(u['cost'] for u in data['units_full'].values() if u['cost'])
    print(f"\nunits:            {len(data['units_full'])} units")
    print(f"  By cost: {dict(sorted(by_cost.items()))}")

    print(f"\naliases:          {len(aliases)} alt-name aliases")
    print(f"\nabilities:        {len(data['abilities'])} active abilities")
    print(f"talents:          {len(data['talents'])} talent slots")
    gm = data['game_mode']
    print(f"game mode:        {len(gm['drop_relic_list'])} drop relics, prepare_timer={gm['prepare_timer']}, battle_timer={gm['battle_timer']}")

    # ── Diff ──
    if args.diff:
        old_dir = Path(args.diff)
        print(f"\n{'='*60}")
        print(f"DIFF vs {old_dir}")
        print(f"{'='*60}")

        old_snapshot = read_content_snapshot(old_dir)
        for key, new_data in data.items():
            old_data = old_snapshot.get(key)

            # Unwrap containers
            if old_data is None:
                old_inner = None
                new_inner = new_data
            elif key == 'relics':
                old_inner = old_data.get('relics', old_data)
                new_inner = new_data.get('relics', new_data)
            else:
                old_inner = old_data
                new_inner = new_data

            print_diff(key, old_inner, new_inner)

if __name__ == '__main__':
    main()
