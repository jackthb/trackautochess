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

from nettable_capture import extract_rows, normalize_allow  # noqa: E402


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
