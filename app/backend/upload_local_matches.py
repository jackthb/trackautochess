"""One-shot backfill: push locally-archived matches to Supabase.

Use when you've been running with `DAC_LOCAL_ONLY=1` (or `local_only: true`
in config.json) and now want the matches sitting in `~/.dac/matches/` +
`~/.dac/match_players/` to show up on the web profile.

Reads each `~/.dac/matches/<match_id>.json` header, gathers the matching
per-player rows from `~/.dac/match_players/<match_id>__p*__*.json`, and
calls the same `ensure_user / push_match / push_match_players /
push_live_game` pipeline the live capture uses. All four steps tolerate
duplicates (`Prefer: resolution=ignore-duplicates`), so re-running is
safe.

Usage:
    python upload_local_matches.py              # push every local match
    python upload_local_matches.py 6f52d5ac...  # push one match_id
    python upload_local_matches.py --dry-run    # show what would be pushed

Forces `DAC_LOCAL_ONLY=0` for the duration so the underlying push_* helpers
talk to Supabase regardless of your live config.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "match_ids",
        nargs="*",
        help="Specific match_id(s) to push; default = every match in ~/.dac/matches/",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be pushed without contacting Supabase",
    )
    args = parser.parse_args()

    # Override before importing db.py — that module memoises local_only_mode()
    # at first _get_client() call via the _local_only_logged flag.
    os.environ["DAC_LOCAL_ONLY"] = "0"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-5s  %(message)s",
        datefmt="%H:%M:%S",
    )

    from utils import LOCAL_MATCHES_DIR, LOCAL_MATCH_PLAYERS_DIR
    from db import ensure_user, push_match, push_match_players, push_live_game

    if not LOCAL_MATCHES_DIR.exists():
        print(f"No matches found at {LOCAL_MATCHES_DIR} — nothing to do.")
        return 0

    # Discover candidate matches.
    if args.match_ids:
        matches = []
        for mid in args.match_ids:
            p = LOCAL_MATCHES_DIR / f"{mid}.json"
            if not p.exists():
                print(f"  missing match file: {p}", file=sys.stderr)
                continue
            matches.append(p)
    else:
        matches = sorted(LOCAL_MATCHES_DIR.glob("*.json"))

    if not matches:
        print("No match files to push.")
        return 0

    print(f"Found {len(matches)} match file(s) to consider.\n")

    total_pushed = 0
    total_skipped = 0
    for match_path in matches:
        match_id = match_path.stem
        try:
            match_record = json.loads(match_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  [skip] {match_id}: failed to read header — {e}", file=sys.stderr)
            total_skipped += 1
            continue

        # Gather per-player rows. The on-disk filename pattern is
        # `<match_id>__p<placement>__<steam_id>.json`.
        player_paths = sorted(LOCAL_MATCH_PLAYERS_DIR.glob(f"{match_id}__p*__*.json"))
        if not player_paths:
            print(f"  [skip] {match_id}: no match_players files found")
            total_skipped += 1
            continue

        player_rows: list[dict] = []
        for pp in player_paths:
            try:
                player_rows.append(json.loads(pp.read_text(encoding="utf-8")))
            except Exception as e:
                print(f"    [warn] {pp.name}: parse failed — {e}", file=sys.stderr)
        if not player_rows:
            print(f"  [skip] {match_id}: every player row failed to parse")
            total_skipped += 1
            continue

        played_at = match_record.get("played_at")
        print(f"[{match_id}] {played_at}  players={len(player_rows)}")

        if args.dry_run:
            print(f"    (dry-run) would push 1 match + {len(player_rows)} players")
            total_pushed += 1
            continue

        # Order mirrors the live path in nettable_capture._upload_match_to_supabase
        # so we hit the same FK ordering (users → matches → match_players → games).
        for r in player_rows:
            sid = str(r.get("steam_id") or "").strip()
            if not sid:
                continue
            try:
                ensure_user(sid)
            except Exception as e:
                print(f"    [warn] ensure_user({sid}) failed: {e}", file=sys.stderr)

        push_match(match_record)
        push_match_players(match_id, player_rows)
        for r in player_rows:
            try:
                push_live_game(r)
            except Exception as e:
                print(
                    f"    [warn] push_live_game({r.get('steam_id')}) failed: {e}",
                    file=sys.stderr,
                )
        total_pushed += 1

    print()
    if args.dry_run:
        print(f"Dry run complete — {total_pushed} match(es) would be pushed, {total_skipped} skipped.")
    else:
        print(f"Done — {total_pushed} match(es) pushed, {total_skipped} skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
