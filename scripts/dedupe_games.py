"""Delete duplicate game rows created by repeated screenshot imports.

The import path infers ``played_at`` from "X days ago" text on the MY MATCHES
screen, so re-importing the same row from different screenshots produces rows
with the same placement / level / W-L / lineup but timestamps that drift by
days. This script finds those duplicates and keeps a single canonical row per
match.

Usage:
    python scripts/dedupe_games.py              # dry run, print what would be deleted
    python scripts/dedupe_games.py --apply      # actually delete duplicates
    python scripts/dedupe_games.py --user 76561... --apply

Reads Supabase credentials from ``~/.dac/config.json`` (``supabase_url`` and
``supabase_key``). The anon key works as long as the project's RLS policies
allow row deletion from the anon role; otherwise use the service role key.
"""

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:
    sys.stderr.write("This script needs httpx — `pip install httpx`.\n")
    sys.exit(2)


DEFAULT_WINDOW_DAYS = 3
DEFAULT_CONFIG = Path.home() / ".dac" / "config.json"


def load_config(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"Config not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_all_games(client: httpx.Client, user_id: str | None) -> list[dict]:
    params: dict[str, str] = {
        "select": "id,user_id,played_at,placement,level,wins,losses,lineup,relic,rank,screenshot,replay,match_id,created_at",
        "order": "played_at.asc",
        "limit": "10000",
    }
    if user_id:
        params["user_id"] = f"eq.{user_id}"
    resp = client.get("/rest/v1/games", params=params)
    resp.raise_for_status()
    return resp.json()


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _completeness_score(game: dict) -> int:
    """Higher score = more complete record; we keep the highest-scoring row."""
    score = 0
    if game.get("screenshot"):
        score += 4
    if game.get("replay"):
        score += 4
    if game.get("match_id"):
        score += 3
    if game.get("lineup"):
        score += 2
    if game.get("relic"):
        score += 1
    if game.get("rank"):
        score += 1
    if game.get("wins") is not None and game.get("losses") is not None:
        score += 1
    return score


def group_duplicates(
    games: list[dict], window_days: int
) -> list[list[dict]]:
    """Return groups of duplicate rows (length ≥ 2), each group is time-ordered."""
    by_user: dict[Any, list[dict]] = defaultdict(list)
    for g in games:
        by_user[g.get("user_id")].append(g)

    groups: list[list[dict]] = []
    window = timedelta(days=window_days)

    for rows in by_user.values():
        rows.sort(key=lambda r: r.get("played_at") or "")
        visited: set[int] = set()
        for i, row in enumerate(rows):
            if row["id"] in visited:
                continue
            placement = row.get("placement")
            level = row.get("level")
            wins = row.get("wins")
            losses = row.get("losses")
            lineup = (row.get("lineup") or "").strip()
            base_dt = _parse_dt(row.get("played_at"))
            if base_dt is None:
                continue

            cluster = [row]
            for j in range(i + 1, len(rows)):
                other = rows[j]
                if other["id"] in visited:
                    continue
                other_dt = _parse_dt(other.get("played_at"))
                if other_dt is None:
                    continue
                if other_dt - base_dt > window:
                    break
                if other.get("placement") != placement:
                    continue

                match_fields = 0
                if level is not None and other.get("level") == level:
                    match_fields += 1
                if (
                    wins is not None
                    and losses is not None
                    and other.get("wins") == wins
                    and other.get("losses") == losses
                ):
                    match_fields += 1
                if lineup and (other.get("lineup") or "").strip() == lineup:
                    match_fields += 1
                if match_fields >= 1:
                    cluster.append(other)

            if len(cluster) > 1:
                for c in cluster:
                    visited.add(c["id"])
                groups.append(cluster)
    return groups


def pick_keeper(cluster: list[dict]) -> dict:
    """Pick the row we keep: highest completeness, earliest played_at as tiebreak."""
    return max(
        cluster,
        key=lambda g: (
            _completeness_score(g),
            -(_parse_dt(g.get("played_at")) or datetime.max).timestamp(),
            -g["id"],
        ),
    )


def delete_ids(client: httpx.Client, ids: list[int]) -> int:
    if not ids:
        return 0
    deleted = 0
    # PostgREST `in.(1,2,3)` filter — chunk to keep URLs short.
    CHUNK = 50
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i : i + CHUNK]
        joined = ",".join(str(n) for n in chunk)
        resp = client.delete(
            "/rest/v1/games",
            params={"id": f"in.({joined})"},
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()
        deleted += len(chunk)
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config", type=Path, default=DEFAULT_CONFIG,
        help=f"Path to DAC config (default: {DEFAULT_CONFIG})",
    )
    parser.add_argument(
        "--window-days", type=int, default=DEFAULT_WINDOW_DAYS,
        help="Group rows whose timestamps differ by at most this many days "
             f"(default {DEFAULT_WINDOW_DAYS}).",
    )
    parser.add_argument(
        "--user", type=str, default=None,
        help="Only look at rows for this user_id (Steam ID64). "
             "Default: dedupe across all users.",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually delete the duplicate rows. Without this flag the script "
             "runs in dry-run mode and only prints what would be deleted.",
    )
    args = parser.parse_args()

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
        timeout=30,
    ) as client:
        print(f"Fetching games{' for ' + args.user if args.user else ''}…")
        games = fetch_all_games(client, args.user)
        print(f"  {len(games)} rows")

        groups = group_duplicates(games, args.window_days)
        total_dupes = sum(len(g) - 1 for g in groups)
        print(f"Found {len(groups)} duplicate cluster(s), {total_dupes} row(s) to delete.")

        to_delete: list[int] = []
        for cluster in groups:
            keeper = pick_keeper(cluster)
            losers = [r for r in cluster if r["id"] != keeper["id"]]
            to_delete.extend(r["id"] for r in losers)

            placement = keeper.get("placement")
            level = keeper.get("level")
            wl = (
                f"{keeper.get('wins')}-{keeper.get('losses')}"
                if keeper.get("wins") is not None
                else "?"
            )
            print(
                f"\n  user={keeper.get('user_id')} place={placement} level={level} wl={wl}"
            )
            for row in cluster:
                tag = "KEEP  " if row["id"] == keeper["id"] else "delete"
                print(
                    f"    {tag} id={row['id']}  {row.get('played_at')}  "
                    f"lineup={(row.get('lineup') or '')[:60]!r}  "
                    f"score={_completeness_score(row)}"
                )

        if not args.apply:
            print("\nDry run — pass --apply to delete.")
            return 0

        if not to_delete:
            print("\nNothing to delete.")
            return 0

        deleted = delete_ids(client, to_delete)
        print(f"\nDeleted {deleted} duplicate row(s).")
        return 0


if __name__ == "__main__":
    sys.exit(main())
