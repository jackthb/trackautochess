"""DAC Game Tracker — CLI entry point.

Usage:
    python main.py ingest-nettable [--dry-run] [--only NAME,NAME] [--log PATH]
    python main.py backfill-timeline-boards MATCH_ID [--dry-run] [--log PATH] [--max-gap-sec N]
"""

import argparse
import json
import os
import sys
from pathlib import Path

from utils import load_config


def cmd_ingest_nettable(args: list[str]) -> None:
    """Handle: python main.py ingest-nettable [--dry-run] [--only ...] [--log PATH]

    Decode CustomNetTable dumps from Dota's console.log and POST them to
    Supabase. Manual fallback for when the auto-ingest path inside
    headless.py isn't running.
    """
    from nettable_capture import (
        CUSTOM_NETTABLE_PREFIX,
        extract_rows,
        find_console_log,
        find_dota_dir,
        insert_dumps,
        normalize_allow,
    )

    ap = argparse.ArgumentParser(prog="main.py ingest-nettable")
    ap.add_argument("--log", type=Path, default=None,
                    help="Path to console.log (auto-detected if omitted)")
    ap.add_argument("--only", default=None,
                    help="Comma-separated tables; bare names get CustomNetTable_ prefix")
    ap.add_argument("--all-tables", action="store_true",
                    help="Don't filter to CustomNetTable_*")
    ap.add_argument("--include-errors", action="store_true",
                    help="Write rows even when VBKV decoding failed")
    ap.add_argument("--dry-run", action="store_true",
                    help="Parse and report, don't write to Supabase")
    parsed = ap.parse_args(args)

    log_path = parsed.log
    if not log_path:
        dota_dir = find_dota_dir()
        if not dota_dir:
            sys.exit("Could not find Dota install. Pass --log <path>.")
        log_path = find_console_log(dota_dir)
    if not log_path.exists():
        sys.exit(f"Log not found: {log_path}")

    print(f"Reading {log_path}")
    allow = normalize_allow(parsed.only) if parsed.only else None
    rows = extract_rows(
        log_path,
        allow=allow,
        include_errors=parsed.include_errors,
        all_tables=parsed.all_tables,
    )
    if not rows:
        sys.exit(
            "No CustomNetTable dumps found. Did you press F12 during a DAC game "
            "with `-condebug` in launch options?"
        )

    by_table: dict[str, int] = {}
    for r in rows:
        by_table[r["table_name"]] = by_table.get(r["table_name"], 0) + 1
    print(f"Found {len(rows)} unique payload(s) across {len(by_table)} table(s):")
    for t, n in sorted(by_table.items()):
        print(f"  {t}: {n}")

    if parsed.dry_run:
        return

    try:
        import httpx
    except ImportError:
        sys.exit("httpx required: pip install httpx")

    cfg = load_config()
    url = cfg.get("supabase_url")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or cfg.get("supabase_key")
    if not url or not key:
        sys.exit("supabase_url missing from config, or no SUPABASE_SERVICE_ROLE_KEY / supabase_key")

    with httpx.Client(
        base_url=url.rstrip("/"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
        timeout=60,
    ) as client:
        written = insert_dumps(client, rows)

    print(f"\nDone — {written} row(s) written to dac_nettable_dumps.")


def cmd_backfill_timeline_boards(args: list[str]) -> None:
    """Handle: python main.py backfill-timeline-boards MATCH_ID [--dry-run] [--log PATH] [--max-gap-sec N]

    Reconstruct positioned `board` arrays for an existing match timeline from
    repeated `player_id_table.vchess_*` dumps in Dota's full console.log.
    """
    import bisect
    import re
    from datetime import datetime

    from nettable_capture import (
        _extract_vchess_board,
        find_console_log,
        find_dota_dir,
        make_service_role_client,
        upsert_match_timeline,
    )
    from nettable_parser import ENTRY_RE, TABLE_RE, _extract_hex_tokens, parse_vbkv

    ap = argparse.ArgumentParser(prog="main.py backfill-timeline-boards")
    ap.add_argument("match_id")
    ap.add_argument("--log", type=Path, default=None,
                    help="Path to console.log (auto-detected if omitted)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Parse and report, don't write to Supabase")
    ap.add_argument("--max-gap-sec", type=float, default=120.0,
                    help="Only attach a vchess dump within this many seconds of the timeline snapshot")
    parsed = ap.parse_args(args)

    client = make_service_role_client()
    if client is None:
        sys.exit("No Supabase client. Check supabase_url/supabase_key config.")

    with client:
        resp = client.get(
            "/rest/v1/match_timelines",
            params={
                "select": "timeline",
                "match_id": f"eq.{parsed.match_id}",
                "limit": "1",
            },
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            sys.exit(f"No match_timelines row for {parsed.match_id}")
        timeline = rows[0].get("timeline")

    if not isinstance(timeline, dict) or not isinstance(timeline.get("rounds"), list):
        sys.exit(f"Timeline row for {parsed.match_id} has no rounds array")

    log_path = parsed.log
    if not log_path:
        dota_dir = find_dota_dir()
        if not dota_dir:
            sys.exit("Could not find Dota install. Pass --log <path>.")
        log_path = find_console_log(dota_dir)
    if not log_path.exists():
        sys.exit(f"Log not found: {log_path}")

    def parse_dt(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None

    first_round_at = None
    for r in timeline["rounds"]:
        if isinstance(r, dict):
            first_round_at = parse_dt(r.get("captured_at"))
            if first_round_at:
                break
    year = first_round_at.year if first_round_at else datetime.now().year

    line_ts_re = re.compile(r"^(\d{2})/(\d{2})\s+(\d{2}:\d{2}:\d{2})\s+")

    def line_time(line: str) -> datetime | None:
        m = line_ts_re.match(line)
        if not m:
            return None
        month, day, clock = m.groups()
        return datetime.fromisoformat(f"{year}-{month}-{day}T{clock}")

    dumps: list[dict] = []
    cur_table: str | None = None
    cur_table_at: datetime | None = None
    cur_entries: dict[str, bytes] = {}
    cur_key: str | None = None
    cur_hex: list[str] = []

    def commit_entry() -> None:
        nonlocal cur_hex
        if cur_table == "CustomNetTable_player_id_table" and cur_key and cur_hex:
            cur_entries[cur_key] = bytes.fromhex("".join(cur_hex))
        cur_hex = []

    def commit_table() -> None:
        nonlocal cur_entries
        if cur_table != "CustomNetTable_player_id_table" or not cur_entries or not cur_table_at:
            cur_entries = {}
            return
        slot_boards: dict[int, list[dict]] = {}
        for key, blob in cur_entries.items():
            if not key.startswith("vchess_"):
                continue
            try:
                slot = int(key.removeprefix("vchess_"))
                decoded = parse_vbkv(blob)
            except Exception:
                continue
            board = _extract_vchess_board(decoded)
            if board:
                slot_boards[slot] = board
        if slot_boards:
            dumps.append({"at": cur_table_at, "slots": slot_boards})
        cur_entries = {}

    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for raw_line in f:
            line = raw_line.rstrip("\r\n")
            m = TABLE_RE.search(line)
            if m:
                commit_entry()
                commit_table()
                cur_table = m.group(1)
                cur_table_at = line_time(line)
                cur_key = None
                cur_entries = {}
                continue
            m = ENTRY_RE.search(line)
            if m and cur_table is not None:
                commit_entry()
                cur_key = m.group(1).strip()
                continue
            hex_chunk = _extract_hex_tokens(line)
            if hex_chunk and cur_key is not None:
                cur_hex.append(hex_chunk)
        commit_entry()
        commit_table()

    if not dumps:
        sys.exit(f"No vchess board dumps found in {log_path}")

    dump_times = [d["at"] for d in dumps]

    def nearest_dump(at: datetime) -> tuple[dict, float] | None:
        if not dumps:
            return None
        idx = bisect.bisect_left(dump_times, at)
        candidates = []
        if idx > 0:
            candidates.append(dumps[idx - 1])
        if idx < len(dumps):
            candidates.append(dumps[idx])
        if not candidates:
            return None
        best = min(candidates, key=lambda d: abs((d["at"] - at).total_seconds()))
        gap = abs((best["at"] - at).total_seconds())
        if gap > parsed.max_gap_sec:
            return None
        return best, gap

    rounds_with_boards = 0
    player_boards = 0
    skipped_no_close_dump = 0
    matched_gaps: list[float] = []
    missing_slots: dict[int, int] = {}
    for round_snap in timeline["rounds"]:
        if not isinstance(round_snap, dict):
            continue
        captured_at = parse_dt(round_snap.get("captured_at"))
        players = round_snap.get("players")
        if not captured_at or not isinstance(players, dict):
            continue
        nearest = nearest_dump(captured_at)
        if not nearest:
            skipped_no_close_dump += 1
            continue
        dump, gap = nearest
        matched_gaps.append(gap)
        round_attached = 0
        for player in players.values():
            if not isinstance(player, dict):
                continue
            try:
                slot = int(player.get("player_id"))
            except (TypeError, ValueError):
                continue
            board = dump["slots"].get(slot)
            if not board:
                missing_slots[slot] = missing_slots.get(slot, 0) + 1
                continue
            player["board"] = board
            round_attached += 1
            player_boards += 1
        if round_attached:
            round_snap["board_dumped_at"] = dump["at"].isoformat()
            rounds_with_boards += 1

    print(f"Read {len(dumps)} vchess dump(s) from {log_path}")
    print(f"Max dump gap: {parsed.max_gap_sec:g}s; skipped {skipped_no_close_dump} round(s) with no close dump")
    if matched_gaps:
        print(f"Matched dump gaps: avg {sum(matched_gaps) / len(matched_gaps):.1f}s, max {max(matched_gaps):.1f}s")
    print(f"Attached board data to {player_boards} player snapshot(s) across {rounds_with_boards} round(s)")
    if missing_slots:
        print(f"Missing slot boards: {missing_slots}")

    if player_boards == 0:
        sys.exit("No boards attached; not updating Supabase.")

    if parsed.dry_run:
        return

    with make_service_role_client() as write_client:
        upsert_match_timeline(write_client, timeline)
    print(f"Updated match_timelines for {parsed.match_id}")


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "ingest-nettable":
        cmd_ingest_nettable(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "backfill-timeline-boards":
        cmd_backfill_timeline_boards(sys.argv[2:])
    else:
        print(__doc__.strip())
        sys.exit(1)


if __name__ == "__main__":
    main()
