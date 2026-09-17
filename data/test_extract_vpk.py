import unittest

from extract_vpk import (
    ability_localized_value,
    collect_unit_ability_ids,
    extract_lua_string_map,
    flatten_ability_numbers,
    resolve_tooltip_placeholders,
)


class LuaExtractionTests(unittest.TestCase):
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
