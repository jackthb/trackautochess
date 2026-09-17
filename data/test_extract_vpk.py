import io
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import extract_vpk

from extract_vpk import (
    ability_localized_value,
    collect_unit_ability_ids,
    extract_lua_string_map,
    flatten_ability_numbers,
    resolve_tooltip_placeholders,
)


class LuaExtractionTests(unittest.TestCase):
    def test_ignores_retired_maps_and_entries_in_long_comments(self):
        for equals in ('', '=', '=='):
            with self.subTest(delimiter=equals):
                opener, closer = '[' + equals + '[', ']' + equals + ']'
                source = f"""
                --{opener}
                _G.chess_ability_list_base = {{ chess_old = 'retired' }}
                {closer}
                _G.chess_ability_list_base = {{
                    --{opener} chess_old = 'retired', }} {{{closer}
                    chess_lina = 'lina_laguna_blade',
                }}
                """
                self.assertEqual(
                    extract_lua_string_map(source, '_G.chess_ability_list_base'),
                    {'chess_lina': 'lina_laguna_blade'},
                )

    def test_strings_do_not_introduce_maps_comments_or_table_braces(self):
        source = r'''
        local documentation = "_G.chess_ability_list_base = { fake = 'old' }"
        local example = [==[_G.chess_ability_list_base = { fake = 'old' }]==]
        _G.chess_ability_list_base = {
            punctuation = "} --[[ still a string ]] {",
            escaped = 'it\'s -- not a comment',
            backslash = "ends in \\",
            embedded = "fake = 'not_an_entry'",
            long_value = [=[} -- a literal {]=],
            chess_lich = 'lich_chain_frost',
        }
        other = { outside = 'not_an_entry' }
        '''
        self.assertEqual(
            extract_lua_string_map(source, '_G.chess_ability_list_base'),
            {
                'punctuation': '} --[[ still a string ]] {',
                'escaped': r"it\'s -- not a comment",
                'backslash': 'ends in ' + '\\' * 2,
                'embedded': "fake = 'not_an_entry'",
                'long_value': '} -- a literal {',
                'chess_lich': 'lich_chain_frost',
            },
        )

    def test_long_comment_ends_only_at_matching_delimiter(self):
        source = '''
        --[==[ ]] ]=]
        _G.chess_ability_list_base = { fake = 'retired' }
        ]==]
        _G.chess_ability_list_base = { live = 'active' }
        '''
        self.assertEqual(
            extract_lua_string_map(source, '_G.chess_ability_list_base'),
            {'live': 'active'},
        )

    def test_rejects_unterminated_table_instead_of_returning_partial_map(self):
        self.assertEqual(
            extract_lua_string_map("abilities = { live = 'active'", 'abilities'),
            {},
        )

    def test_excludes_nested_tables_and_identifier_suffix_matches(self):
        source = '''
        unrelated_abilities = { wrong = 'old' }
        abilities = { nested = { wrong = 'old' }, live = 'active' }
        '''
        self.assertEqual(extract_lua_string_map(source, 'abilities'), {'live': 'active'})

    def test_extracts_active_ability_map_and_ignores_comments(self):
        source = """
        -- _G.chess_ability_list_base = { chess_old = 'old_ability' }
        _G.chess_ability_list_base = {
            -- chess_old = 'old_ability',
            chess_lina = 'lina_laguna_blade',
            chess_lich = "lich_chain_frost", -- live mapping
        }
        """

        self.assertEqual(
            extract_lua_string_map(source, "_G.chess_ability_list_base"),
            {
                "chess_lina": "lina_laguna_blade",
                "chess_lich": "lich_chain_frost",
            },
        )

    def test_collects_unit_kv_and_lua_abilities_without_duplicates(self):
        stars = {
            1: {"abilities": ["is_mage", "lina_laguna_blade"]},
            2: {"abilities": ["is_mage", "star_only_passive"]},
        }

        self.assertEqual(
            collect_unit_ability_ids(stars, "lina_laguna_blade"),
            ["is_mage", "lina_laguna_blade", "star_only_passive"],
        )


class RelicIconTests(unittest.TestCase):
    def test_game_id_icon_is_written_under_content_name(self):
        class ContentWritten(Exception):
            pass

        png = b'fixture icon bytes'
        pak = {
            'resource/flash3/images/items/remainder_seeker.png':
                SimpleNamespace(read=lambda: png),
        }
        data = {
            'items_full': {},
            'synergies': {},
            'relics': {'relics': {
                'item_remainder_seeker': {'name': 'Serendipity Compass'},
            }},
        }
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            vpk_path = root / 'fixture.vpk'
            vpk_path.touch()
            with (
                patch.object(extract_vpk, '__file__', str(root / 'extract_vpk.py')),
                patch.object(extract_vpk, 'extract_all', return_value=data),
                patch.object(extract_vpk, 'write_content_outputs', side_effect=ContentWritten),
                patch.dict('sys.modules', {'vpk': SimpleNamespace(open=lambda _: pak)}),
                patch('sys.argv', ['extract_vpk.py', str(vpk_path), '--out', str(root / 'content')]),
                patch('sys.stdout', new_callable=io.StringIO),
                self.assertRaises(ContentWritten),
            ):
                extract_vpk.main()

            icons = root / 'icons'
            self.assertEqual((icons / 'relics/serendipity_compass.png').read_bytes(), png)
            self.assertEqual(
                extract_vpk.content_icon_ref(
                    icons, 'relics', extract_vpk.relic_icon_stem('Serendipity Compass'),
                ),
                'relics/serendipity_compass.png',
            )
            self.assertFalse((icons / 'relics/remainder_seeker.png').exists())


class AbilityNumberTests(unittest.TestCase):
    def test_resolves_numeric_placeholders_in_ability_descriptions(self):
        self.assertEqual(
            resolve_tooltip_placeholders(
                "Launches %missile_count% missiles for %damage% damage.",
                {"missile_count": "3 3 4", "damage": "100 200 300"},
            ),
            "Launches 3 3 4 missiles for 100 200 300 damage.",
        )

    def test_uses_plain_localization_key_when_tooltip_key_is_absent(self):
        loc = {"au_portal": "Fiends Gate"}

        self.assertEqual(ability_localized_value(loc, "au_portal"), "Fiends Gate")

    def test_flattens_ability_values_and_legacy_specials(self):
        block = {
            "AbilityValues": {
                "duration": "6 7 8",
                "damage": {"value": "400 600 800", "RequiresFacet": "facet"},
                "metadata_only": {"RequiresFacet": "facet"},
            },
            "AbilitySpecial": {
                "01": {"var_type": "FIELD_INTEGER", "jumps": "3 4 6"},
            },
        }

        self.assertEqual(
            flatten_ability_numbers(block),
            {
                "duration": "6 7 8",
                "damage": "400 600 800",
                "jumps": "3 4 6",
            },
        )


if __name__ == "__main__":
    unittest.main()
