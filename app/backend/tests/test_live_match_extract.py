"""Integration tests for _extract_structured_match + _maybe_save_end_board.

Drives the real `nettable_capture.NetTableCapture` against the committed
end_board fixture, with the db.py upload helpers mocked. Asserts:
  - the deterministic match_id is propagated from generate_live_match_id
    into the match_record and the per-player rows
  - push_match / push_match_players / ensure_user are invoked the expected
    number of times
  - in-session dedup: the same end_board ingested twice only uploads once
  - local_only_mode short-circuits the Supabase calls

Run:
  cd app/backend
  pytest tests/test_live_match_extract.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

BACKEND_DIR = Path(__file__).parent.parent
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "end_board_20260518.json"
sys.path.insert(0, str(BACKEND_DIR))


def _isolated(tmp_path, monkeypatch):
    """Point DAC_DIR at a fresh tmp, drop cached utils/db so the new env wins."""
    monkeypatch.setenv("DAC_DIR", str(tmp_path))
    monkeypatch.delenv("DAC_LOCAL_ONLY", raising=False)
    for mod in (
        "utils", "db", "nettable_capture", "nettable_parser",
    ):
        sys.modules.pop(mod, None)


def _load_fixture() -> tuple[dict, str, int]:
    """Returns (end_board, expected_match_id, n_players)."""
    raw = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    end_board = raw["end_board"]
    n = len(end_board["data"])

    # Compute expected match_id the same way db.py does — duplicated here
    # so the test catches drift in the algorithm itself.
    import hashlib
    pairs = sorted(
        (str(sid), int(p.get("curr_rank") or p.get("rank") or 0))
        for sid, p in end_board["data"].items()
    )
    canonical = json.dumps(pairs, separators=(",", ":"), ensure_ascii=True)
    expected_id = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    return end_board, expected_id, n


def _patch_db_uploaders(monkeypatch):
    """Mock the Supabase entry points. Returns a dict of MagicMocks
    keyed by function name, so tests can assert call counts / args."""
    import db
    mocks = {
        "ensure_user": MagicMock(return_value=True),
        "push_match": MagicMock(side_effect=lambda r: r.get("match_id")),
        "push_match_players": MagicMock(return_value=1),
    }
    for name, m in mocks.items():
        monkeypatch.setattr(db, name, m)
    return mocks


# ── _extract_structured_match → tuple shape ─────────────────────────────────


def test_extract_structured_match_returns_record_and_rows(tmp_path, monkeypatch):
    _isolated(tmp_path, monkeypatch)
    end_board, expected_match_id, n_players = _load_fixture()

    from nettable_capture import NetTableCapture
    cap = NetTableCapture(emit=lambda _: None)

    extracted = cap._extract_structured_match(
        end_board, played_at="2026-05-20T12:00:00", match_id=expected_match_id,
    )
    assert extracted is not None
    match_record, player_rows = extracted

    assert match_record["match_id"] == expected_match_id
    assert match_record["player_count"] == n_players
    assert len(player_rows) == n_players
    # Every player row has the match_id stamped.
    assert all(r["match_id"] == expected_match_id for r in player_rows)
    # played_at propagates.
    assert match_record["played_at"] == "2026-05-20T12:00:00"
    assert all(r["played_at"] == "2026-05-20T12:00:00" for r in player_rows)


def test_extract_structured_match_synergies_prefer_filtered_buff(tmp_path, monkeypatch):
    _isolated(tmp_path, monkeypatch)
    end_board, expected_match_id, _ = _load_fixture()

    # `show_buff` has been observed stale/repeated across players in live
    # end-board data. `buff` has the correct per-player counts, plus inactive
    # one-offs that should be filtered by synergy tier metadata.
    first_player = next(iter(end_board["data"].values()))
    first_player["show_buff"] = "is_knight:6,is_troll:6,is_demon:1"

    from nettable_capture import NetTableCapture
    cap = NetTableCapture(emit=lambda _: None)

    extracted = cap._extract_structured_match(
        end_board, played_at="2026-05-20T12:00:00", match_id=expected_match_id,
    )
    assert extracted is not None
    _, player_rows = extracted

    row = next(r for r in player_rows if r["steam_id"] == "76561198085976065")
    assert row["synergies"] == "Aqir:4|Warlock:2|Orc:2|Beast:2"


def test_extract_structured_match_no_local_files(tmp_path, monkeypatch):
    """_extract_structured_match must NOT write any local sidecar files."""
    _isolated(tmp_path, monkeypatch)
    end_board, expected_match_id, n_players = _load_fixture()

    from nettable_capture import NetTableCapture
    cap = NetTableCapture(emit=lambda _: None)
    cap._extract_structured_match(
        end_board, played_at="2026-05-20T12:00:00", match_id=expected_match_id,
    )

    # No local directories should be created.
    assert not (tmp_path / "matches").exists()
    assert not (tmp_path / "match_players").exists()
    assert not (tmp_path / "players").exists()


def test_extract_structured_match_empty_data_returns_none(tmp_path, monkeypatch):
    _isolated(tmp_path, monkeypatch)
    from nettable_capture import NetTableCapture
    cap = NetTableCapture(emit=lambda _: None)
    assert cap._extract_structured_match({"data": {}}, "2026-05-20T12:00:00", "x") is None
    assert cap._extract_structured_match({}, "2026-05-20T12:00:00", "x") is None


# ── _upload_match_to_supabase → fan-out ─────────────────────────────────────


def test_upload_match_to_supabase_calls_each_db_helper(tmp_path, monkeypatch):
    """One call to push_match, one to push_match_players (bulk),
    one ensure_user per player."""
    _isolated(tmp_path, monkeypatch)
    end_board, expected_match_id, n_players = _load_fixture()

    mocks = _patch_db_uploaders(monkeypatch)

    from nettable_capture import NetTableCapture
    cap = NetTableCapture(emit=lambda _: None)
    extracted = cap._extract_structured_match(
        end_board, played_at="2026-05-20T12:00:00", match_id=expected_match_id,
    )
    assert extracted is not None
    cap._upload_match_to_supabase(*extracted)

    assert mocks["ensure_user"].call_count == n_players
    assert mocks["push_match"].call_count == 1
    assert mocks["push_match_players"].call_count == 1

    # push_match got the same match_id we passed in.
    pm_record = mocks["push_match"].call_args.args[0]
    assert pm_record["match_id"] == expected_match_id

    # push_match_players got the same match_id + n_players rows.
    pmp_id, pmp_rows = mocks["push_match_players"].call_args.args
    assert pmp_id == expected_match_id
    assert len(pmp_rows) == n_players


def test_upload_match_to_supabase_partial_failure_continues(tmp_path, monkeypatch):
    """If push_match raises, push_match_players should still run —
    partial success is preferred to total loss (the comment in
    _upload_match_to_supabase makes this explicit)."""
    _isolated(tmp_path, monkeypatch)
    end_board, expected_match_id, n_players = _load_fixture()

    import db
    monkeypatch.setattr(db, "ensure_user", MagicMock(return_value=True))
    monkeypatch.setattr(db, "push_match", MagicMock(side_effect=RuntimeError("503")))
    pmp = MagicMock(return_value=1)
    monkeypatch.setattr(db, "push_match_players", pmp)

    from nettable_capture import NetTableCapture
    cap = NetTableCapture(emit=lambda _: None)
    extracted = cap._extract_structured_match(
        end_board, played_at="2026-05-20T12:00:00", match_id=expected_match_id,
    )
    assert extracted is not None
    cap._upload_match_to_supabase(*extracted)

    # Downstream calls still happened despite push_match failure.
    assert pmp.call_count == 1


# ── _maybe_save_end_board → end-to-end orchestration ────────────────────────


def _wrap_for_save(end_board: dict) -> list[dict]:
    """_maybe_save_end_board expects a `rows` list with the dac_table.end_board
    entry. Build the minimal shape that satisfies the dispatch."""
    return [{
        "table_name": "CustomNetTable_dac_table",
        "key": "end_board",
        "raw": end_board,
    }]


def test_maybe_save_end_board_drives_full_pipeline(tmp_path, monkeypatch):
    """End-to-end: feed a fake `rows` containing a dac_table.end_board entry
    and assert (1) deterministic id is computed via generate_live_match_id
    and propagated, (2) all upload helpers are called, (3) no local files
    are written."""
    _isolated(tmp_path, monkeypatch)
    end_board, expected_match_id, n_players = _load_fixture()

    mocks = _patch_db_uploaders(monkeypatch)

    from nettable_capture import NetTableCapture

    cap = NetTableCapture(emit=lambda _: None)
    cap._maybe_save_end_board(_wrap_for_save(end_board))

    # All upload helpers fired.
    assert mocks["push_match"].call_count == 1
    assert mocks["push_match_players"].call_count == 1
    assert mocks["ensure_user"].call_count == n_players

    # No local files written.
    assert not (tmp_path / "end_boards").exists()
    assert not (tmp_path / "matches").exists()


def test_maybe_save_end_board_dedups_in_session(tmp_path, monkeypatch):
    """Two ingests of the same end_board in one process → second is a no-op.

    `_saved_end_board_hashes` is checked before any upload happens. Asserts
    the upload helpers fire ONCE total even after two save calls."""
    _isolated(tmp_path, monkeypatch)
    end_board, _expected_match_id, _ = _load_fixture()

    mocks = _patch_db_uploaders(monkeypatch)

    from nettable_capture import NetTableCapture

    cap = NetTableCapture(emit=lambda _: None)
    rows = _wrap_for_save(end_board)
    cap._maybe_save_end_board(rows)
    cap._maybe_save_end_board(rows)

    assert mocks["push_match"].call_count == 1
    assert mocks["push_match_players"].call_count == 1


def test_maybe_save_end_board_dedups_across_hehe_values(tmp_path, monkeypatch):
    """A second ingest where ONLY the `hehe` random field differs must still
    be deduped — that's the whole point of `_stable_end_board_payload`
    stripping it before hashing."""
    _isolated(tmp_path, monkeypatch)
    end_board, _, _ = _load_fixture()

    mocks = _patch_db_uploaders(monkeypatch)

    from nettable_capture import NetTableCapture

    cap = NetTableCapture(emit=lambda _: None)
    cap._maybe_save_end_board(_wrap_for_save(end_board))

    # Mutate hehe, ingest again.
    eb2 = json.loads(json.dumps(end_board))  # deep copy
    eb2["hehe"] = (end_board.get("hehe") or 0) + 1
    cap._maybe_save_end_board(_wrap_for_save(eb2))

    assert mocks["push_match"].call_count == 1


# ── local_only_mode regression ──────────────────────────────────────────────


def test_local_only_mode_skips_supabase(tmp_path, monkeypatch):
    """With DAC_LOCAL_ONLY=1, the upload helpers must NOT hit httpx.
    _extract_structured_match still produces data but no Supabase calls."""
    _isolated(tmp_path, monkeypatch)
    monkeypatch.setenv("DAC_LOCAL_ONLY", "1")
    end_board, expected_match_id, n_players = _load_fixture()

    # Patch _get_client to fail loudly if anyone tries to use it.
    import db
    monkeypatch.setattr(
        db, "_get_client",
        lambda: (_ for _ in ()).throw(
            AssertionError("Supabase client built under local_only — bug!"))
        if not db.local_only_mode() else None,
    )

    from nettable_capture import NetTableCapture

    cap = NetTableCapture(emit=lambda _: None)
    cap._maybe_save_end_board(_wrap_for_save(end_board))

    # No local files written.
    assert not (tmp_path / "matches").exists()
    assert not (tmp_path / "match_players").exists()
    assert not (tmp_path / "end_boards").exists()


def test_partial_match_saved_from_latest_dump_after_personal_elimination(tmp_path, monkeypatch):
    """If the local player is eliminated and no final end_board arrives, the
    latest live dump can still become an unfinished, provenance-marked match."""
    _isolated(tmp_path, monkeypatch)
    mocks = _patch_db_uploaders(monkeypatch)

    from nettable_capture import NetTableCapture

    steam_id = "76561198000000001"
    rows = [
        {
            "table_name": "CustomNetTable_player_info_table",
            "key": "player_info",
            "raw": {
                "data": {
                    steam_id: {
                        "steam_id": steam_id,
                        "team_id": 1,
                        "rank": 4,
                        "round": 28,
                        "hero_level": 9,
                    },
                    "76561198000000002": {
                        "steam_id": "76561198000000002",
                        "team_id": 2,
                        "rank": 1,
                        "round": 28,
                        "hero_level": 10,
                    },
                }
            },
        },
        {
            "table_name": "CustomNetTable_dac_table",
            "key": "player_info",
            "raw": {
                "info": {
                    steam_id: {"curr_rank": 4, "hp": 0},
                    "76561198000000002": {"curr_rank": 1, "hp": 42},
                }
            },
        },
    ]

    cap = NetTableCapture(emit=lambda _: None, steam_id=steam_id)
    cap._match_session_start = 123.0
    cap._session_dumps.append((124.0, {"captured_at": "2026-05-20T12:00:00", "rows": rows}))
    cap._personal_end_recorded = True
    cap._personal_end_snapshot = {"round": 28, "rank": 4}

    cap._maybe_save_partial_match_from_latest_dump(
        capture_status="player_eliminated",
        verification_source="death_team",
        close_session=True,
    )

    assert mocks["push_match"].call_count == 1
    match_record = mocks["push_match"].call_args.args[0]
    assert match_record["capture_status"] == "player_eliminated"
    assert match_record["is_finished"] is False
    assert match_record["verification_source"] == "death_team"
    assert match_record["personal_end_snapshot"] == {"round": 28, "rank": 4}
    assert mocks["push_match_players"].call_count == 1
    assert cap._partial_match_saved is True
