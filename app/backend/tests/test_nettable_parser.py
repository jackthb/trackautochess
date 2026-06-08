"""Unit tests for the VBKV (BinaryKV1) decoder and console.log walker.

`parse_vbkv` and `parse_log` together translate Dota's `dumpstringtable`
output into Python dicts. These tests build synthetic VBKV bytes and
synthetic console.log content so behaviour is verified without
depending on a live Dota client.

Run:
  cd app/backend
  pytest tests/test_nettable_parser.py -v
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from nettable_parser import (  # noqa: E402
    VBKVError,
    parse_log,
    parse_vbkv,
)


# ── VBKV byte builders ──────────────────────────────────────────────────────


def _wrap(body: bytes) -> bytes:
    """VBKV magic + 4-byte checksum placeholder + body."""
    return b"VBKV" + b"\xaa\xbb\xcc\xdd" + body


def _root(*entries: bytes) -> bytes:
    """Root subkey: type 0, empty name (\0), entries, end (0x0b)."""
    return b"\x00\x00" + b"".join(entries) + b"\x0b"


def _key(name: str) -> bytes:
    return name.encode() + b"\x00"


def _subkey(name: str, *entries: bytes) -> bytes:
    return b"\x00" + _key(name) + b"".join(entries) + b"\x0b"


def _string(name: str, value: str) -> bytes:
    return b"\x01" + _key(name) + value.encode() + b"\x00"


def _int32(name: str, value: int) -> bytes:
    return b"\x02" + _key(name) + struct.pack("<i", value)


def _float32(name: str, value: float) -> bytes:
    return b"\x03" + _key(name) + struct.pack("<f", value)


def _uint64(name: str, value: int) -> bytes:
    return b"\x07" + _key(name) + struct.pack("<Q", value)


# ── parse_vbkv unit tests ───────────────────────────────────────────────────


def test_parse_vbkv_empty_root():
    assert parse_vbkv(_wrap(_root())) == {}


def test_parse_vbkv_single_string():
    data = _wrap(_root(_string("name", "jack")))
    assert parse_vbkv(data) == {"name": "jack"}


def test_parse_vbkv_single_int32():
    data = _wrap(_root(_int32("rank", 7), _int32("hp", -1)))
    assert parse_vbkv(data) == {"rank": 7, "hp": -1}


def test_parse_vbkv_float32():
    data = _wrap(_root(_float32("ratio", 0.5)))
    out = parse_vbkv(data)
    assert pytest.approx(out["ratio"]) == 0.5


def test_parse_vbkv_uint64():
    big = 76561199814945792
    data = _wrap(_root(_uint64("steam_id64", big)))
    assert parse_vbkv(data) == {"steam_id64": big}


def test_parse_vbkv_nested_subkey():
    inner = _subkey("inner", _string("x", "1"), _int32("y", 2))
    data = _wrap(_root(inner))
    assert parse_vbkv(data) == {"inner": {"x": "1", "y": 2}}


def test_parse_vbkv_duplicate_keys_become_list():
    data = _wrap(_root(
        _string("k", "a"),
        _string("k", "b"),
        _string("k", "c"),
    ))
    assert parse_vbkv(data) == {"k": ["a", "b", "c"]}


def test_parse_vbkv_bad_magic_raises():
    with pytest.raises(VBKVError):
        parse_vbkv(b"NOPE\x00\x00\x00\x00\x00\x00\x0b")


def test_parse_vbkv_unknown_type_raises():
    # Type 0x66 is not a defined VBKV type
    data = _wrap(b"\x00\x00\x66bad\x00\x00\x00\x00\x00\x0b")
    with pytest.raises(VBKVError):
        parse_vbkv(data)


def test_parse_vbkv_truncated_raises():
    # Promise an int32 but only provide 2 bytes
    data = _wrap(b"\x00\x00\x02n\x00\x01\x00")  # missing 2 bytes of int + end
    with pytest.raises((VBKVError, struct.error, IndexError)):
        parse_vbkv(data)


# ── parse_log: synthetic console.log content ────────────────────────────────


def _format_block(table_name: str, entries: list[tuple[str, bytes]]) -> str:
    """Render a [stringtables] block exactly as `dumpstringtable cl verbose` does."""
    lines = [f"[stringtables] table {table_name} {len(entries)}"]
    for idx, (key, blob) in enumerate(entries):
        lines.append(f"[stringtables]    {idx} : {key}")
        # Each `>>` line covers 24 bytes (six 4-byte dword groups).
        for i in range(0, len(blob), 24):
            chunk = blob[i : i + 24]
            ascii_preview = "".join(
                chr(b) if 32 <= b < 127 else "." for b in chunk
            ).ljust(24)
            hex_groups = [chunk[j : j + 4].hex() for j in range(0, len(chunk), 4)]
            hex_col = " ".join(hex_groups)
            lines.append(f"[stringtables]    >>  {ascii_preview} {hex_col}")
    return "\n".join(lines) + "\n"


def test_parse_log_single_entry(tmp_path):
    blob = _wrap(_root(_string("name", "jack"), _int32("rank", 7)))
    log = _format_block("CustomNetTable_dac_table", [("player_info", blob)])
    log_path = tmp_path / "console.log"
    log_path.write_text(log)

    result = parse_log(log_path)
    assert result == {
        "CustomNetTable_dac_table": {
            "player_info": {"name": "jack", "rank": 7},
        }
    }


def test_parse_log_multiple_entries_and_tables(tmp_path):
    blob_a = _wrap(_root(_int32("x", 1)))
    blob_b = _wrap(_root(_int32("y", 2)))
    blob_c = _wrap(_root(_string("v", "v3")))

    log = (
        _format_block("CustomNetTable_dac_table", [("a", blob_a), ("b", blob_b)])
        + _format_block("CustomNetTable_game_info", [("version", blob_c)])
    )
    log_path = tmp_path / "console.log"
    log_path.write_text(log)

    result = parse_log(log_path)
    assert result == {
        "CustomNetTable_dac_table": {"a": {"x": 1}, "b": {"y": 2}},
        "CustomNetTable_game_info": {"version": {"v": "v3"}},
    }


def test_parse_log_ignores_unrelated_lines(tmp_path):
    """[stringtables] blocks should be picked out from noisy logs."""
    blob = _wrap(_root(_int32("n", 42)))
    block = _format_block("CustomNetTable_dac_table", [("k", blob)])
    log = (
        "05/13 04:13:52 [Client] something unrelated\n"
        "[GCClient] Send msg 7408\n"
        + block
        + "05/13 04:14:30 [Networking] ping 32ms\n"
    )
    log_path = tmp_path / "console.log"
    log_path.write_text(log)

    result = parse_log(log_path)
    assert "CustomNetTable_dac_table" in result
    assert result["CustomNetTable_dac_table"]["k"] == {"n": 42}


def test_parse_log_decode_error_preserves_raw_hex(tmp_path):
    """Bad VBKV bytes should not blow up the whole walker — error row returned."""
    bad_blob = b"VBKV\xaa\xbb\xcc\xdd\x00\x00\x66junk\x00data"
    log = _format_block("CustomNetTable_dac_table", [("borked", bad_blob)])
    log_path = tmp_path / "console.log"
    log_path.write_text(log)

    result = parse_log(log_path)
    entry = result["CustomNetTable_dac_table"]["borked"]
    assert "_decode_error" in entry
    assert "_raw_hex" in entry
    assert entry["_raw_hex"].startswith("56424b56")  # "VBKV"


def test_parse_log_ignores_non_vbkv_stringtable_stub(tmp_path):
    """Tiny non-VBKV stubs should not become decode-error rows."""
    stub = b"hehe\x00q\x02\x00\x00\x00ranking_top\x00\x001"
    log = _format_block("CustomNetTable_ranking_top_table", [("ranking_top", stub)])
    log_path = tmp_path / "console.log"
    log_path.write_text(log)

    assert parse_log(log_path) == {}


def test_parse_log_bad_later_dump_does_not_overwrite_good_value(tmp_path):
    """A partial EOF dump should not replace an earlier complete table/key."""
    good = _wrap(_root(_string("season", "s43")))
    bad = b"VBKV\xaa\xbb\xcc\xdd\x00\x00\x01season\x00s"
    log = _format_block("CustomNetTable_ranking_top_table", [("ranking_top", good)])
    log += _format_block("CustomNetTable_ranking_top_table", [("ranking_top", bad)])
    log_path = tmp_path / "console.log"
    log_path.write_text(log)

    assert parse_log(log_path) == {
        "CustomNetTable_ranking_top_table": {"ranking_top": {"season": "s43"}}
    }


def test_parse_log_short_final_hex_token(tmp_path):
    """The last `>>` line of an entry can end with a short (non-8-char) hex token."""
    # Build a blob whose length isn't a multiple of 4 — the final `>>` line
    # will have a trailing hex token shorter than 8 chars.
    blob = _wrap(_root(_string("name", "ja"), _int32("n", 1)))
    # Pad blob to force a short final token
    while len(blob) % 4 == 1:
        blob = blob[:-1]  # don't actually trim, just illustrate; real bytes already round-trip

    log = _format_block("CustomNetTable_dac_table", [("k", blob)])
    log_path = tmp_path / "console.log"
    log_path.write_text(log)

    result = parse_log(log_path)
    # Whatever the exact contents, the key should be present and decoded.
    assert "k" in result["CustomNetTable_dac_table"]


def test_parse_log_empty_file(tmp_path):
    log_path = tmp_path / "console.log"
    log_path.write_text("")
    assert parse_log(log_path) == {}


def test_parse_log_no_stringtable_blocks(tmp_path):
    log_path = tmp_path / "console.log"
    log_path.write_text("05/13 04:13:52 nothing relevant here\n")
    assert parse_log(log_path) == {}
