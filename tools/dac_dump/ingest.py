"""Parse DAC NetTable dumps from Dota's console.log and store them in Supabase.

The companion panorama hook (``panorama/dac_dump.js``) writes lines of the form
``DAC_NETTABLE_DUMP_BEGIN <json> DAC_NETTABLE_DUMP_END`` whenever a watched
CustomNetTable entry changes during a DAC game (ranking_top_table,
match_history_table, dac_table.{player_info,end_board,user_panel_ranking},
player_id_table.player_*, plus a synthetic __synth__ / lobby_steam_ids).

Each line decodes to ``{ "t": tableName, "k": key, "v": value }``. The ingester
inserts one row per unique payload into ``dac_nettable_dumps`` — schema
deferred until we've seen what real data looks like. Same payload across runs
is deduped before write.

Usage:
    python tools/dac_dump/ingest.py
    python tools/dac_dump/ingest.py --log "C:/.../dota 2 beta/game/dota/console.log"
    python tools/dac_dump/ingest.py --dry-run
    python tools/dac_dump/ingest.py --only ranking_top_table,match_history_table

Reads Supabase credentials from ``~/.dac/config.json`` (``supabase_url`` and
``supabase_key``). Migration only opens SELECT to anon, so use the service
role key for writes.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:
    sys.stderr.write("This script needs httpx — `pip install httpx`.\n")
    sys.exit(2)


DEFAULT_CONFIG = Path.home() / ".dac" / "config.json"

DUMP_RE = re.compile(r"DAC_NETTABLE_DUMP_BEGIN (.*?) DAC_NETTABLE_DUMP_END")

CANDIDATE_LOG_PATHS = [
    Path("C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game/dota/console.log"),
    Path("C:/Program Files/Steam/steamapps/common/dota 2 beta/game/dota/console.log"),
    Path.home() / ".steam/steam/steamapps/common/dota 2 beta/game/dota/console.log",
    Path.home() / ".local/share/Steam/steamapps/common/dota 2 beta/game/dota/console.log",
    Path.home() / "Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/console.log",
]


def find_log() -> Path:
    for p in CANDIDATE_LOG_PATHS:
        if p.exists():
            return p
    sys.exit(
        "console.log not found in standard Steam locations. Pass --log <path>.\n"
        "(Make sure Dota 2 was launched with `-condebug`.)"
    )


def load_config(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"Config not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def extract_dumps(log_path: Path) -> list[dict[str, Any]]:
    """Yield every {t, k, v} payload found in the log, in file order, deduped."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            for match in DUMP_RE.finditer(line):
                blob = match.group(1)
                if blob in seen:
                    continue
                seen.add(blob)
                try:
                    obj = json.loads(blob)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                if "t" not in obj or "k" not in obj or "v" not in obj:
                    continue
                out.append(obj)
    return out


def insert_dumps(client: httpx.Client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {"table_name": str(r["t"]), "key": str(r["k"]), "raw": r["v"]}
        for r in rows
    ]
    CHUNK = 250
    written = 0
    for i in range(0, len(payload), CHUNK):
        chunk = payload[i : i + CHUNK]
        resp = client.post(
            "/rest/v1/dac_nettable_dumps",
            headers={"Content-Type": "application/json", "Prefer": "return=minimal"},
            content=json.dumps(chunk),
        )
        resp.raise_for_status()
        written += len(chunk)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG,
                        help=f"Path to DAC config (default: {DEFAULT_CONFIG})")
    parser.add_argument("--log", type=Path, default=None,
                        help="Path to Dota's console.log. Auto-detected if omitted.")
    parser.add_argument("--only", type=str, default=None,
                        help="Comma-separated table_name allowlist.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and report, but don't write to Supabase.")
    args = parser.parse_args()

    log_path = args.log or find_log()
    if not log_path.exists():
        sys.exit(f"Log not found: {log_path}")

    print(f"Reading {log_path}")
    dumps = extract_dumps(log_path)
    if not dumps:
        sys.exit("No NetTable dumps found. "
                 "Did you launch Dota with -condebug and play a DAC game with the mod loaded?")

    if args.only:
        allow = {s.strip() for s in args.only.split(",") if s.strip()}
        dumps = [d for d in dumps if str(d["t"]) in allow]

    by_table: dict[str, int] = {}
    for d in dumps:
        by_table[str(d["t"])] = by_table.get(str(d["t"]), 0) + 1
    print(f"Found {len(dumps)} unique payload(s) across {len(by_table)} table(s):")
    for t, n in sorted(by_table.items()):
        print(f"  {t}: {n}")

    if args.dry_run:
        return 0

    cfg = load_config(args.config)
    url = cfg.get("supabase_url")
    key = cfg.get("supabase_key")
    if not url or not key:
        print("supabase_url/supabase_key missing from config", file=sys.stderr)
        return 2

    with httpx.Client(
        base_url=url.rstrip("/"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
        timeout=60,
    ) as client:
        written = insert_dumps(client, dumps)

    print(f"\nDone — {written} row(s) written to dac_nettable_dumps.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
