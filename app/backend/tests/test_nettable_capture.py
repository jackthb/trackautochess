"""Unit tests for the pure helpers in nettable_capture.

`extract_rows`, `normalize_allow`, and the small filter behaviours are
testable without bringing up the file tailer, Windows window-handle
lookup, or the Supabase HTTP path. Those side-effecting pieces are
covered by the manual VERIFY checklist.

Run:
  cd app/backend
  pytest tests/test_nettable_capture.py -v
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from nettable_capture import (  # noqa: E402
    NetTableCapture,
    _storage_filter,
    extract_rows,
    keep_local_nettable_dumps,
    normalize_allow,
    upload_raw_nettable_dumps,
)


# ── tiny VBKV builders (duplicated from test_nettable_parser to keep the
#     two test files independent — they're trivial to maintain) ──────────────


def _wrap(body: bytes) -> bytes:
    return b"VBKV" + b"\xaa\xbb\xcc\xdd" + body


def _root(*entries: bytes) -> bytes:
    return b"\x00\x00" + b"".join(entries) + b"\x0b"


def _string(name: str, value: str) -> bytes:
    return b"\x01" + name.encode() + b"\x00" + value.encode() + b"\x00"


def _int32(name: str, value: int) -> bytes:
    return b"\x02" + name.encode() + b"\x00" + struct.pack("<i", value)


def _format_block(table_name: str, entries: list[tuple[str, bytes]]) -> str:
    lines = [f"[stringtables] table {table_name} {len(entries)}"]
    for idx, (key, blob) in enumerate(entries):
        lines.append(f"[stringtables]    {idx} : {key}")
        for i in range(0, len(blob), 24):
            chunk = blob[i : i + 24]
            ascii_preview = "".join(
                chr(b) if 32 <= b < 127 else "." for b in chunk
            ).ljust(24)
            hex_groups = [chunk[j : j + 4].hex() for j in range(0, len(chunk), 4)]
            hex_col = " ".join(hex_groups)
            lines.append(f"[stringtables]    >>  {ascii_preview} {hex_col}")
    return "\n".join(lines) + "\n"


# ── normalize_allow ─────────────────────────────────────────────────────────


def test_normalize_allow_bare_name_gets_prefix():
    assert normalize_allow("dac_table") == {"CustomNetTable_dac_table"}


def test_normalize_allow_prefixed_name_passes_through():
    assert normalize_allow("CustomNetTable_dac_table") == {"CustomNetTable_dac_table"}


def test_normalize_allow_mixed_list():
    out = normalize_allow("dac_table, CustomNetTable_ranking_top_table , game_info ")
    assert out == {
        "CustomNetTable_dac_table",
        "CustomNetTable_ranking_top_table",
        "CustomNetTable_game_info",
    }


def test_normalize_allow_empty_string():
    assert normalize_allow("") == set()


def test_normalize_allow_skips_blank_entries():
    assert normalize_allow(",dac_table,,") == {"CustomNetTable_dac_table"}


# ── extract_rows ────────────────────────────────────────────────────────────


def _write_log(tmp_path, blocks: str) -> Path:
    log_path = tmp_path / "console.log"
    log_path.write_text(blocks)
    return log_path


def test_extract_rows_default_filters_to_custom_nettable(tmp_path):
    blob_good = _wrap(_root(_int32("n", 1)))
    blob_other = _wrap(_root(_int32("n", 2)))
    log = (
        _format_block("CustomNetTable_dac_table", [("k", blob_good)])
        + _format_block("ModifierNames", [("m", blob_other)])
    )
    log_path = _write_log(tmp_path, log)

    rows = extract_rows(log_path)
    assert {r["table_name"] for r in rows} == {"CustomNetTable_dac_table"}


def test_extract_rows_all_tables_includes_non_custom(tmp_path):
    blob_good = _wrap(_root(_int32("n", 1)))
    blob_other = _wrap(_root(_int32("n", 2)))
    log = (
        _format_block("CustomNetTable_dac_table", [("k", blob_good)])
        + _format_block("ModifierNames", [("m", blob_other)])
    )
    log_path = _write_log(tmp_path, log)

    rows = extract_rows(log_path, all_tables=True)
    assert {r["table_name"] for r in rows} == {
        "CustomNetTable_dac_table",
        "ModifierNames",
    }


def test_extract_rows_allow_filter(tmp_path):
    blob = _wrap(_root(_int32("n", 1)))
    log = (
        _format_block("CustomNetTable_dac_table", [("a", blob)])
        + _format_block("CustomNetTable_game_info", [("b", blob)])
        + _format_block("CustomNetTable_ranking_top_table", [("c", blob)])
    )
    log_path = _write_log(tmp_path, log)

    allow = normalize_allow("dac_table,game_info")
    rows = extract_rows(log_path, allow=allow)
    assert {r["table_name"] for r in rows} == {
        "CustomNetTable_dac_table",
        "CustomNetTable_game_info",
    }


def test_extract_rows_dedup_identical_payloads(tmp_path):
    """Same (table, key, payload) repeated in the log should yield one row."""
    blob = _wrap(_root(_int32("n", 1)))
    # Two identical blocks back-to-back (e.g. user pressed F12 twice).
    block = _format_block("CustomNetTable_dac_table", [("k", blob)])
    log_path = _write_log(tmp_path, block + block)

    rows = extract_rows(log_path)
    assert len(rows) == 1


def test_extract_rows_skips_decode_errors_by_default(tmp_path):
    blob_ok = _wrap(_root(_int32("ok", 1)))
    blob_bad = b"VBKV\xaa\xbb\xcc\xdd\x00\x00\x66junk\x00data"
    log = _format_block(
        "CustomNetTable_dac_table",
        [("good", blob_ok), ("borked", blob_bad)],
    )
    log_path = _write_log(tmp_path, log)

    rows = extract_rows(log_path)
    keys = {r["key"] for r in rows}
    assert keys == {"good"}


def test_extract_rows_include_errors_keeps_decode_failures(tmp_path):
    blob_ok = _wrap(_root(_int32("ok", 1)))
    blob_bad = b"VBKV\xaa\xbb\xcc\xdd\x00\x00\x66junk\x00data"
    log = _format_block(
        "CustomNetTable_dac_table",
        [("good", blob_ok), ("borked", blob_bad)],
    )
    log_path = _write_log(tmp_path, log)

    rows = extract_rows(log_path, include_errors=True)
    keys = {r["key"] for r in rows}
    assert keys == {"good", "borked"}
    borked = next(r for r in rows if r["key"] == "borked")
    assert "_decode_error" in borked["raw"]


def test_extract_rows_row_shape(tmp_path):
    blob = _wrap(_root(_string("name", "jack"), _int32("rank", 5)))
    log = _format_block("CustomNetTable_dac_table", [("player_info", blob)])
    log_path = _write_log(tmp_path, log)

    rows = extract_rows(log_path)
    assert rows == [{
        "table_name": "CustomNetTable_dac_table",
        "key": "player_info",
        "raw": {"name": "jack", "rank": 5},
    }]


def test_extract_rows_empty_log(tmp_path):
    log_path = _write_log(tmp_path, "")
    assert extract_rows(log_path) == []


# ── storage filter ──────────────────────────────────────────────────────────


def test_storage_filter_keeps_player_id_board_items_and_relics():
    rows = [
        {"table_name": "CustomNetTable_player_id_table", "key": "player_0", "raw": {}},
        {"table_name": "CustomNetTable_player_id_table", "key": "vchess_0", "raw": {}},
        {"table_name": "CustomNetTable_player_id_table", "key": "relic_ttl_0", "raw": {}},
        {"table_name": "CustomNetTable_player_id_table", "key": "mmr_level_0", "raw": {}},
        {"table_name": "CustomNetTable_player_id_table", "key": "chessboard_0", "raw": {}},
        {"table_name": "CustomNetTable_player_id_table", "key": "courier_0", "raw": {}},
    ]

    kept = _storage_filter(rows)

    assert {r["key"] for r in kept} == {
        "player_0",
        "vchess_0",
        "relic_ttl_0",
        "mmr_level_0",
    }


# ── raw dump persistence policy ─────────────────────────────────────────────


def test_raw_nettable_upload_disabled_by_default(tmp_path, monkeypatch):
    monkeypatch.setenv("DAC_DIR", str(tmp_path))
    monkeypatch.delenv("DAC_LOCAL_ONLY", raising=False)
    # utils was imported when nettable_capture loaded; point its globals at the
    # isolated temp directory to avoid reading the real ~/.dac/config.json.
    import utils

    monkeypatch.setattr(utils, "DAC_DIR", tmp_path)
    monkeypatch.setattr(utils, "CONFIG_PATH", tmp_path / "config.json")

    assert upload_raw_nettable_dumps() is False
    assert keep_local_nettable_dumps() is True


def test_raw_nettable_upload_can_be_enabled_in_config(tmp_path, monkeypatch):
    monkeypatch.setenv("DAC_DIR", str(tmp_path))
    import utils

    monkeypatch.setattr(utils, "DAC_DIR", tmp_path)
    monkeypatch.setattr(utils, "CONFIG_PATH", tmp_path / "config.json")
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "config.json").write_text(
        '{"upload_raw_nettable_dumps": true, "keep_local_nettable_dumps": false}',
        encoding="utf-8",
    )

    assert upload_raw_nettable_dumps() is True
    assert keep_local_nettable_dumps() is False


# ── _last_match_dumps: segment buffered dumps into matches, keep the latest ──
#
# This is the fallback used when GAME_IN_PROGRESS was missed (app started
# mid-game). The old break-on-first-increase scan could truncate a full game
# to a single round; these lock in that it doesn't.


def _round_dump(round_n: int | None) -> dict:
    """A minimal dump carrying just a round_info row (or none)."""
    rows = []
    if round_n is not None:
        rows = [{
            "table_name": "CustomNetTable_game_info",
            "key": "round_info",
            "raw": {"round": round_n},
        }]
    return {"rows": rows}


def _dumps(rounds: list[int | None]) -> list[tuple]:
    return [(float(i), _round_dump(r)) for i, r in enumerate(rounds)]


def _rounds_of(dumps: list[tuple]) -> list[int | None]:
    return [NetTableCapture._extract_round_from_rows(d["rows"]) for _, d in dumps]


def test_last_match_dumps_single_match_kept_whole():
    dumps = _dumps([1, 1, 2, 3, 4, 5])
    assert NetTableCapture._last_match_dumps(dumps) == dumps


def test_last_match_dumps_keeps_only_latest_match():
    # Two matches buffered: 1..5 then a fresh game restarting at 1.
    dumps = _dumps([1, 2, 3, 4, 5, 1, 2, 3])
    assert _rounds_of(NetTableCapture._last_match_dumps(dumps)) == [1, 2, 3]


def test_last_match_dumps_tolerates_noise_no_collapse():
    # A single stale/out-of-order low reading mid-match must NOT split the
    # timeline — this is the exact failure that produced 1-round timelines.
    dumps = _dumps([10, 11, 12, 11, 13, 14])
    assert NetTableCapture._last_match_dumps(dumps) == dumps


def test_last_match_dumps_none_rounds_attach_to_open_segment():
    dumps = _dumps([1, None, 2, None, 3])
    assert NetTableCapture._last_match_dumps(dumps) == dumps


def test_last_match_dumps_empty():
    assert NetTableCapture._last_match_dumps([]) == []

# ── Queen ladder extraction ─────────────────────────────────────────────────


def test_extract_players_state_keeps_structured_vchess_board():
    rows = [
        {
            "table_name": "CustomNetTable_dac_table",
            "key": "player_info",
            "raw": {"info": {"76561198000000001": {"player_id": 3}}},
        },
        {
            "table_name": "CustomNetTable_player_id_table",
            "key": "vchess_3",
            "raw": {
                "2_4": {
                    "chess": "chess_cm1",
                    "x": 4,
                    "y": 2,
                    "item": {"1": "item_a"},
                    "lastitem": {"2": "item_b"},
                    "buy_price": 3,
                    "index": 123,
                    "water_id": 45,
                }
            },
        },
    ]

    players = NetTableCapture._extract_players_state_from_rows(rows)
    player = players["76561198000000001"]

    assert player["lineup"] == "Crystal Maiden(2)"
    assert player["board"] == [
        {
            "slot_key": "2_4",
            "chess": "chess_cm1",
            "name": "Crystal Maiden",
            "stars": 2,
            "x": 4,
            "y": 2,
            "items": ["item_a"],
            "last_items": ["item_b"],
            "index": 123,
            "buy_price": 3,
            "water_id": 45,
        }
    ]


def test_extract_ranking_top_players_accepts_common_aliases():
    scanned_at = "2026-06-02T12:00:00+00:00"
    raw = {
        "season": "s40",
        "ranking_top": {
            "1": {"player": "76561198000000001", "name": "Alpha", "mmr": 4200},
            "2": {"steam_id": "76561198000000002", "player_name": "Beta", "score": "4100"},
            "noise": {"player": "123", "name": "Not Steam64"},
        },
    }

    players = NetTableCapture._extract_ranking_top_players(raw, scanned_at)

    assert players == [
        {
            "steam_id": "76561198000000001",
            "name": "Alpha",
            "rank": 1,
            "mmr": 4200,
            "season": "s40",
            "seen_at": scanned_at,
        },
        {
            "steam_id": "76561198000000002",
            "name": "Beta",
            "rank": 2,
            "mmr": 4100,
            "season": "s40",
            "seen_at": scanned_at,
        },
    ]
