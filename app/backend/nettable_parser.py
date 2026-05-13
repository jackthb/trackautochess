"""Decode `dumpstringtable` output from Dota 2's console.log into JSON.

CustomNetTables in Source 2 are stored as stringtables. With `-condebug` in
Dota's launch options, running

    dumpstringtable CustomNetTable_<name> cl verbose

in the in-game console writes the binary VBKV payload of each entry into
<dota>/game/dota/console.log, in two columns: ASCII (left, eyeball debug)
and hex bytes (right, the actual data). `parse_log` walks the file, picks
out the hex column, reassembles each entry, and decodes the VBKV
(BinaryKV1) format. Used by both `nettable_capture` (auto-ingest) and the
`ingest-nettable` CLI in `main.py`.
"""

from __future__ import annotations

import re
import struct
from pathlib import Path
from typing import Any


# VBKV (BinaryKV1) type codes
TYPE_SUBKEY = 0
TYPE_STRING = 1
TYPE_INT32 = 2
TYPE_FLOAT32 = 3
TYPE_POINTER = 4
TYPE_WSTRING = 5
TYPE_COLOR = 6
TYPE_UINT64 = 7
END_OF_SUBKEY = 0x0B


class VBKVError(Exception):
    pass


class _Reader:
    def __init__(self, data: bytes, pos: int = 0) -> None:
        self.data = data
        self.pos = pos

    def u8(self) -> int:
        v = self.data[self.pos]
        self.pos += 1
        return v

    def i32(self) -> int:
        v = struct.unpack_from("<i", self.data, self.pos)[0]
        self.pos += 4
        return v

    def u32(self) -> int:
        v = struct.unpack_from("<I", self.data, self.pos)[0]
        self.pos += 4
        return v

    def u64(self) -> int:
        v = struct.unpack_from("<Q", self.data, self.pos)[0]
        self.pos += 8
        return v

    def f32(self) -> float:
        v = struct.unpack_from("<f", self.data, self.pos)[0]
        self.pos += 4
        return v

    def cstring(self) -> str:
        end = self.data.index(b"\x00", self.pos)
        s = self.data[self.pos : end].decode("utf-8", errors="replace")
        self.pos = end + 1
        return s


def _parse_subkey_body(r: _Reader) -> dict[str, Any]:
    """Parse children of a subkey until END_OF_SUBKEY. Duplicate keys become lists."""
    result: dict[str, Any] = {}
    while True:
        t = r.u8()
        if t == END_OF_SUBKEY:
            return result
        name = r.cstring()
        if t == TYPE_SUBKEY:
            value: Any = _parse_subkey_body(r)
        elif t == TYPE_STRING:
            value = r.cstring()
        elif t == TYPE_INT32:
            value = r.i32()
        elif t == TYPE_FLOAT32:
            value = r.f32()
        elif t in (TYPE_POINTER, TYPE_COLOR):
            value = r.u32()
        elif t == TYPE_UINT64:
            value = r.u64()
        else:
            raise VBKVError(
                f"Unknown VBKV type 0x{t:02x} for key {name!r} at pos {r.pos}"
            )
        if name in result:
            existing = result[name]
            if isinstance(existing, list):
                existing.append(value)
            else:
                result[name] = [existing, value]
        else:
            result[name] = value


def parse_vbkv(data: bytes) -> dict[str, Any]:
    """Decode VBKV bytes (4-byte magic + 4-byte checksum header) into a dict."""
    if not data.startswith(b"VBKV"):
        raise VBKVError(f"Not VBKV: starts with {data[:4]!r}")
    r = _Reader(data, pos=8)  # skip magic + checksum
    t = r.u8()
    if t != TYPE_SUBKEY:
        raise VBKVError(f"Expected root subkey (type 0), got 0x{t:02x}")
    r.cstring()  # root name, usually empty
    return _parse_subkey_body(r)


# ── console.log parsing ──────────────────────────────────────────────────

TABLE_RE = re.compile(r"\[stringtables\]\s+table\s+(\S+)\s+\d+\s*$")
ENTRY_RE = re.compile(r"\[stringtables\]\s+\d+\s*:\s*(.+?)\s*$")
# Hex tokens are normally 8 chars (4 bytes), but the final token on the last
# `>>` line of an entry can be shorter (entries don't always end on a dword
# boundary). Accept any even-length run of 2–8 hex chars.
HEX_TOKEN_RE = re.compile(r"^[0-9a-fA-F]{2,8}$")


def _extract_hex_tokens(line: str) -> str:
    """Pull the trailing hex bytes off a `[stringtables]    >>  ascii  hex hex...` line."""
    if "[stringtables]" not in line or ">>" not in line:
        return ""
    toks = line.split()
    out: list[str] = []
    for t in reversed(toks):
        if HEX_TOKEN_RE.match(t) and len(t) % 2 == 0:
            out.append(t)
        else:
            break
    return "".join(reversed(out))


def parse_log(log_path: Path) -> dict[str, dict[str, Any]]:
    """Return { table_name: { entry_key: decoded_or_error_dict } } found in the log."""
    raw: dict[str, dict[str, bytes]] = {}
    cur_table: str | None = None
    cur_key: str | None = None
    cur_hex: list[str] = []

    def commit() -> None:
        nonlocal cur_hex
        if cur_table is not None and cur_key is not None and cur_hex:
            raw[cur_table][cur_key] = bytes.fromhex("".join(cur_hex))
        cur_hex = []

    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip()
            m = TABLE_RE.search(line)
            if m:
                commit()
                cur_table = m.group(1)
                raw.setdefault(cur_table, {})
                cur_key = None
                continue
            m = ENTRY_RE.search(line)
            if m and cur_table is not None:
                commit()
                cur_key = m.group(1).strip()
                continue
            hex_chunk = _extract_hex_tokens(line)
            if hex_chunk and cur_key is not None:
                cur_hex.append(hex_chunk)
        commit()

    decoded: dict[str, dict[str, Any]] = {}
    for table, entries in raw.items():
        decoded[table] = {}
        for key, blob in entries.items():
            try:
                decoded[table][key] = parse_vbkv(blob)
            except (VBKVError, IndexError, struct.error, ValueError) as e:
                decoded[table][key] = {
                    "_decode_error": str(e),
                    "_raw_hex": blob.hex(),
                }
    return decoded
