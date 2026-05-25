"""One-shot backfill: reconstruct a match from a nettable dump + personal end board.

Use when the app captured nettable dumps during a match but missed the
end_board extraction (e.g. user alt-tabbed at game end).

Reads player_info_table.player_info.data from a nettable dump, constructs
match + match_player records in the same format as
nettable_capture._extract_structured_match(), saves them locally, then
uploads to Supabase via upload_local_matches.py.

Usage:
    python backfill_from_dump.py
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Force Supabase uploads.
os.environ["DAC_LOCAL_ONLY"] = "0"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-5s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# --- Configuration ---
DUMP_FILE = Path(os.path.expanduser(
    r"~\.dac\nettable_dumps\20260525_015400_920279.json"
))
PERSONAL_END_BOARD_FILE = Path(os.path.expanduser(
    r"~\.dac\personal_end_boards\20260525_014418_549063__personal_end.json"
))
MY_STEAM_ID = "76561198022169086"


def main() -> int:
    # Import transform helpers from nettable_capture.
    from nettable_capture import (
        _safe_int,
        _pipe,
        _transform_chess_lineup,
        _transform_synergies,
        _transform_relic,
        _resolve_chess_piece,
        _load_chess_id_map,
    )
    from utils import LOCAL_MATCHES_DIR, LOCAL_MATCH_PLAYERS_DIR, LOCAL_PLAYERS_DIR

    # --- 1. Read the nettable dump ---
    log.info("Reading nettable dump: %s", DUMP_FILE.name)
    dump = json.loads(DUMP_FILE.read_text(encoding="utf-8"))

    pit_data = None
    for row in dump["rows"]:
        if (row["table_name"] == "CustomNetTable_player_info_table"
                and row["key"] == "player_info"):
            pit_data = row["raw"].get("data", {})
            break

    if not pit_data:
        log.error("No player_info_table.player_info.data found in dump")
        return 1

    log.info("Found %d players in player_info_table", len(pit_data))

    # --- 2. Read personal end board for the user's authoritative placement ---
    personal = None
    if PERSONAL_END_BOARD_FILE.exists():
        personal = json.loads(PERSONAL_END_BOARD_FILE.read_text(encoding="utf-8"))
        log.info(
            "Personal end board: placement=%s round=%s",
            personal.get("rank_at_death"),
            personal.get("round_at_death"),
        )

    # --- 3. Generate deterministic match_id ---
    # Same algorithm as db.generate_live_match_id: SHA-256 of sorted
    # (steam_id, curr_rank) pairs, truncated to 16 hex chars.
    pairs: list[tuple[str, int]] = []
    for sid, p in pit_data.items():
        if not isinstance(p, dict):
            continue
        rank = p.get("curr_rank") or p.get("rank") or 0
        try:
            rank_i = int(rank)
        except (TypeError, ValueError):
            rank_i = 0
        pairs.append((str(sid), rank_i))
    pairs.sort()
    canonical = json.dumps(pairs, separators=(",", ":"), ensure_ascii=True)
    match_id = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    log.info("Generated match_id: %s", match_id)

    # Check if this match already exists locally.
    LOCAL_MATCHES_DIR.mkdir(parents=True, exist_ok=True)
    LOCAL_MATCH_PLAYERS_DIR.mkdir(parents=True, exist_ok=True)
    LOCAL_PLAYERS_DIR.mkdir(parents=True, exist_ok=True)

    existing_match = LOCAL_MATCHES_DIR / f"{match_id}.json"
    if existing_match.exists():
        log.warning("Match %s already exists locally at %s", match_id, existing_match)
        log.warning("Proceeding anyway (will overwrite local files).")

    # Use the dump's captured_at as the played_at timestamp.
    played_at = dump.get("captured_at", datetime.now().isoformat())

    # --- 4. Build match_player records ---
    def format_talents(talent_tree) -> str:
        if not isinstance(talent_tree, dict):
            return ""
        try:
            return "|".join(
                talent_tree[k]
                for k in sorted(talent_tree.keys(), key=lambda x: int(x))
            )
        except Exception:
            return "|".join(str(v) for v in talent_tree.values())

    id_map = _load_chess_id_map()
    match_players_summary: list[dict] = []
    all_player_rows: list[dict] = []
    match_duration: float | None = None
    match_final_round: int | None = None

    for steam_id, p in pit_data.items():
        if not isinstance(p, dict):
            continue
        sid = str(steam_id)

        placement = _safe_int(p.get("curr_rank") or p.get("rank"))
        mmr_level = _safe_int(p.get("mmr_level"))

        # MVP chess name transform
        mvp_raw = p.get("mvp_chess_name", "") or ""
        mvp_translated, mvp_stars = (
            _resolve_chess_piece(mvp_raw, id_map) if mvp_raw else ("", 0)
        )
        mvp_display = (
            (f"{mvp_translated}({mvp_stars})" if mvp_stars > 1 else mvp_translated)
            if mvp_translated else mvp_raw
        )

        row = {
            "match_id": match_id,
            "played_at": played_at,
            "steam_id": sid,
            "placement": placement,
            "mmr_level": mmr_level,
            "hero_level": _safe_int(p.get("hero_level")),
            "chess_lineup": _transform_chess_lineup(p.get("chess_lineup")),
            "chess_hand": _transform_chess_lineup(p.get("chess_hand")),
            "synergies": _transform_synergies(p.get("show_buff")),
            "relic": _transform_relic(p.get("relic", "") or ""),
            "relic_history": p.get("relic_history") or {},
            "talents": format_talents(p.get("talent_tree")),
            "win_round": _safe_int(p.get("win_round")) or 0,
            "lose_round": _safe_int(p.get("lose_round")) or 0,
            "draw_round": _safe_int(p.get("draw_round")) or 0,
            "kills": _safe_int(p.get("kills")) or 0,
            "deaths": _safe_int(p.get("deaths")) or 0,
            "hero_damage": _safe_int(p.get("hero_damage")) or 0,
            "hero_damaged": _safe_int(p.get("hero_damaged")) or 0,
            "mvp_chess_name": mvp_display,
            "mvp_chess_items": _pipe(p.get("mvp_chess_items")),
            "max_lineup_value": _safe_int(p.get("max_lineup_value")) or 0,
            "max_lineup_value_lineup": _transform_chess_lineup(
                p.get("max_lineup_value_lineup")
            ),
            "duration": p.get("duration") or 0,
            "final_round": _safe_int(p.get("round")) or 0,
            "zhugong": p.get("zhugong", "") or "",
            "total_money": _safe_int(p.get("total_money")) or 0,
            "candy": _safe_int(p.get("candy")) or 0,
        }

        # Write match_player file.
        mp_path = LOCAL_MATCH_PLAYERS_DIR / (
            f"{match_id}__p{placement or 'X'}__{sid}.json"
        )
        mp_path.write_text(
            json.dumps(row, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        log.info(
            "  Wrote match_player: p%s %s (round=%s, lineup=%s...)",
            placement, sid, row["final_round"],
            row["chess_lineup"][:40],
        )

        all_player_rows.append(row)
        match_players_summary.append({
            "steam_id": sid,
            "placement": placement,
            "mmr_level": mmr_level,
        })

        # Track match-wide stats.
        if match_duration is None and row["duration"]:
            match_duration = row["duration"]
        if match_final_round is None and row["final_round"]:
            match_final_round = row["final_round"]

        # Update player profile.
        try:
            ppath = LOCAL_PLAYERS_DIR / f"{sid}.json"
            existing_profile: dict = {}
            if ppath.exists():
                try:
                    existing_profile = json.loads(
                        ppath.read_text(encoding="utf-8")
                    )
                except Exception:
                    existing_profile = {}
            match_ids = existing_profile.get("match_ids") or []
            if match_id not in match_ids:
                match_ids.append(match_id)
            profile = {
                "steam_id": sid,
                "last_seen": played_at,
                "last_mmr_level": mmr_level,
                "last_match_id": match_id,
                "match_count": len(match_ids),
                "match_ids": match_ids,
            }
            ppath.write_text(
                json.dumps(profile, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception as e:
            log.warning("Failed to update player profile %s: %s", sid, e)

    # Use the winner's duration as match duration (they lasted the whole game).
    winner_row = next(
        (r for r in all_player_rows if r["placement"] == 1), None
    )
    if winner_row and winner_row["duration"]:
        match_duration = winner_row["duration"]

    # Use the winner's round as final_round.
    if winner_row and winner_row["final_round"]:
        match_final_round = winner_row["final_round"]

    # --- 5. Write match header ---
    match_record = {
        "match_id": match_id,
        "played_at": played_at,
        "duration": match_duration or 0,
        "final_round": match_final_round or 0,
        "player_count": len(match_players_summary),
        "players": sorted(
            match_players_summary, key=lambda x: (x["placement"] or 99)
        ),
    }

    match_path = LOCAL_MATCHES_DIR / f"{match_id}.json"
    match_path.write_text(
        json.dumps(match_record, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info(
        "Wrote match header: %s (players=%d duration=%.0fs final_round=%d)",
        match_id,
        len(match_players_summary),
        match_duration or 0,
        match_final_round or 0,
    )

    # --- 6. Upload to Supabase ---
    log.info("Uploading to Supabase...")
    from db import ensure_user, push_match, push_match_players, push_live_game

    # Step 1: ensure_user for all players (FK requirement).
    for r in all_player_rows:
        sid = str(r.get("steam_id") or "").strip()
        if sid:
            try:
                ensure_user(sid)
                log.info("  ensure_user(%s) OK", sid)
            except Exception as e:
                log.warning("  ensure_user(%s) failed: %s", sid, e)

    # Step 2: push match header.
    try:
        push_match(match_record)
        log.info("  push_match OK")
    except Exception as e:
        log.warning("  push_match failed: %s", e)

    # Step 3: push match_players (bulk).
    try:
        push_match_players(match_id, all_player_rows)
        log.info("  push_match_players OK (%d rows)", len(all_player_rows))
    except Exception as e:
        log.warning("  push_match_players failed: %s", e)

    # Step 4: push legacy games rows.
    for r in all_player_rows:
        try:
            push_live_game(r)
        except Exception as e:
            log.warning(
                "  push_live_game(%s) failed: %s", r.get("steam_id"), e
            )
    log.info("  push_live_game done")

    log.info("Backfill complete! match_id=%s", match_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
