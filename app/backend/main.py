"""DAC Game Tracker — CLI entry point.

Usage:
    python main.py ingest-nettable [--dry-run] [--only NAME,NAME] [--log PATH]
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


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "ingest-nettable":
        cmd_ingest_nettable(sys.argv[2:])
    else:
        print(__doc__.strip())
        sys.exit(1)


if __name__ == "__main__":
    main()
