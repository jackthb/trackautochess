"""Unit tests for the live-match Supabase upload helpers in db.py.

Covers:
  - generate_live_match_id determinism + hehe-insensitivity
  - push_match / push_match_players happy path, local_only, failure

Run:
  cd app/backend
  pytest tests/test_db_match_upload.py -v
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))


# ── helpers ──────────────────────────────────────────────────────────────────


def _isolated_dac_dir(tmp_path, monkeypatch) -> Path:
    """Point DAC_DIR + local_only off so tests don't touch the real ~/.dac
    or accidentally hit prod Supabase. Each test runs in a fresh tmpdir."""
    monkeypatch.setenv("DAC_DIR", str(tmp_path))
    monkeypatch.delenv("DAC_LOCAL_ONLY", raising=False)
    # Force re-import so utils picks up new DAC_DIR
    for mod in ("utils", "db"):
        if mod in sys.modules:
            del sys.modules[mod]
    return tmp_path


def _make_end_board(players: list[tuple[str, int]], hehe: int = 1234) -> dict:
    """Build a minimal end_board with the given (steam_id, placement) pairs."""
    return {
        "data": {
            sid: {"curr_rank": p, "hero_level": 9, "duration": 100.0}
            for sid, p in players
        },
        "hehe": hehe,
    }


# ── generate_live_match_id ──────────────────────────────────────────────────


def test_generate_live_match_id_deterministic_same_payload(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    from db import generate_live_match_id

    eb1 = _make_end_board([("76561198000000001", 1), ("76561198000000002", 2)])
    eb2 = _make_end_board([("76561198000000001", 1), ("76561198000000002", 2)])
    assert generate_live_match_id(eb1) == generate_live_match_id(eb2)


def test_generate_live_match_id_different_for_different_payloads(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    from db import generate_live_match_id

    eb1 = _make_end_board([("76561198000000001", 1)])
    eb2 = _make_end_board([("76561198000000001", 2)])  # different placement
    eb3 = _make_end_board([("76561198000000003", 1)])  # different steam_id
    assert generate_live_match_id(eb1) != generate_live_match_id(eb2)
    assert generate_live_match_id(eb1) != generate_live_match_id(eb3)


def test_generate_live_match_id_ignores_hehe(tmp_path, monkeypatch):
    """The deterministic id is over (steam_id, placement) — not `hehe`. Two
    presses of PAUSE in the same lobby produce the same match_id even though
    DAC sprinkles a fresh `hehe` random value into each dump."""
    _isolated_dac_dir(tmp_path, monkeypatch)
    from db import generate_live_match_id

    eb_a = _make_end_board([("76561198000000001", 1)], hehe=32593)
    eb_b = _make_end_board([("76561198000000001", 1)], hehe=99999)
    assert generate_live_match_id(eb_a) == generate_live_match_id(eb_b)


def test_generate_live_match_id_player_order_irrelevant(tmp_path, monkeypatch):
    """Two installs in the same lobby may receive end_board.data with players
    in a different dict-iteration order. The id must hash to the same value
    regardless of insertion order — that's what sorted() in db.py guarantees.
    """
    _isolated_dac_dir(tmp_path, monkeypatch)
    from db import generate_live_match_id

    eb_a = _make_end_board([("76561198000000001", 1), ("76561198000000002", 2)])
    eb_b = _make_end_board([("76561198000000002", 2), ("76561198000000001", 1)])
    assert generate_live_match_id(eb_a) == generate_live_match_id(eb_b)


def test_generate_live_match_id_length_is_16_hex(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    from db import generate_live_match_id

    mid = generate_live_match_id(_make_end_board([("76561198000000001", 1)]))
    assert len(mid) == 16
    assert all(c in "0123456789abcdef" for c in mid), f"non-hex in match_id: {mid}"


def test_generate_live_match_id_fallback_when_no_data(tmp_path, monkeypatch):
    """Missing/empty data still yields a 16-char string (uuid fallback)."""
    _isolated_dac_dir(tmp_path, monkeypatch)
    from db import generate_live_match_id

    assert len(generate_live_match_id({})) == 16
    assert len(generate_live_match_id({"data": {}})) == 16
    assert len(generate_live_match_id({"data": "not a dict"})) == 16


# ── push_match ───────────────────────────────────────────────────────────────


@pytest.fixture
def fake_client():
    """A mocked httpx client where .post returns a 201-like response."""
    client = MagicMock()
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    client.post = MagicMock(return_value=resp)
    return client


def test_push_match_happy_path(tmp_path, monkeypatch, fake_client):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: fake_client)

    record = {
        "match_id": "abc1234567890def",
        "played_at": "2026-05-20T12:00:00",
        "duration": 3200.5,
        "final_round": 54,
        "player_count": 8,
        "players": [{"steam_id": "1", "placement": 1, "mmr_level": 0}],
    }
    out = db.push_match(record)
    assert out == "abc1234567890def"

    # Asserts: posted to /rest/v1/matches with the expected body.
    fake_client.post.assert_called_once()
    args, kwargs = fake_client.post.call_args
    assert args[0] == "/rest/v1/matches"
    body = kwargs["json"]
    assert body["match_id"] == "abc1234567890def"
    assert body["played_at"] == "2026-05-20T12:00:00"
    assert body["duration"] == 3200.5
    assert body["final_round"] == 54
    assert body["player_count"] == 8
    assert body["capture_status"] == "complete"
    assert body["is_finished"] is True
    assert body["verification_source"] == "end_board"
    assert body["verified_at"] == "2026-05-20T12:00:00"
    # `players` is NOT a column on the matches table — it must be dropped.
    assert "players" not in body


def test_push_match_accepts_partial_capture_metadata(tmp_path, monkeypatch, fake_client):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: fake_client)

    db.push_match({
        "match_id": "feedfacefeedface",
        "played_at": "2026-05-20T12:00:00",
        "capture_status": "timeout",
        "is_finished": False,
        "verification_source": "last_dump_timeout",
        "capture_started_at": "2026-05-20T11:30:00",
        "capture_ended_at": "2026-05-20T12:00:00",
        "observer_steam_id": "76561198000000001",
    })

    body = fake_client.post.call_args.kwargs["json"]
    assert body["capture_status"] == "timeout"
    assert body["is_finished"] is False
    assert body["verification_source"] == "last_dump_timeout"
    assert body["observer_steam_id"] == 76561198000000001


def test_push_match_local_only(tmp_path, monkeypatch):
    """DAC_LOCAL_ONLY=1 must skip the httpx call."""
    _isolated_dac_dir(tmp_path, monkeypatch)
    monkeypatch.setenv("DAC_LOCAL_ONLY", "1")
    import db

    # _get_client returns None under local_only — but we still want to assert
    # zero httpx interaction would have occurred. Patch the would-be client
    # builder to fail loudly if it ever gets called.
    monkeypatch.setattr(
        db, "_get_client",
        lambda: pytest.fail("_get_client should short-circuit under local_only")
        if not db.local_only_mode() else None,
    )

    record = {"match_id": "deadbeefdeadbeef", "played_at": "2026-05-20T12:00:00"}
    out = db.push_match(record)

    assert out is None  # no Supabase, no return value


def test_push_match_missing_match_id(tmp_path, monkeypatch, fake_client):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: fake_client)
    out = db.push_match({"played_at": "2026-05-20T12:00:00"})
    assert out is None
    fake_client.post.assert_not_called()


def test_push_match_client_failure_swallows(tmp_path, monkeypatch):
    """If the Supabase POST throws, push_match returns None — never raises."""
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    boom_client = MagicMock()
    boom_client.post.side_effect = RuntimeError("connection refused")
    monkeypatch.setattr(db, "_get_client", lambda: boom_client)

    out = db.push_match({"match_id": "aaaaaaaaaaaaaaaa", "played_at": "2026-05-20T12:00:00"})
    assert out is None


def test_push_match_no_supabase_config(tmp_path, monkeypatch):
    """When config is missing url/key, _get_client returns None and we no-op."""
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: None)
    out = db.push_match({"match_id": "bbbbbbbbbbbbbbbb", "played_at": "2026-05-20T12:00:00"})
    assert out is None


# ── Queen ladder throttle ───────────────────────────────────────────────────


def _queen_ladder_response(rows):
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value=rows)
    return resp


def test_queen_ladder_recent_update_throttles(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    client = MagicMock()
    client.get.return_value = _queen_ladder_response([
        {"queen_ladder_last_seen_at": "2026-06-02T11:30:00+00:00"}
    ])

    now = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)

    assert db._queen_ladder_recently_updated(client, now) is True


def test_queen_ladder_old_update_allows_refresh(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    client = MagicMock()
    client.get.return_value = _queen_ladder_response([
        {"queen_ladder_last_seen_at": "2026-06-01T10:00:00+00:00"}
    ])

    now = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)

    assert db._queen_ladder_recently_updated(client, now) is False


def test_queen_ladder_throttle_check_failure_skips(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    client = MagicMock()
    client.get.side_effect = RuntimeError("read failed")

    now = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)

    assert db._queen_ladder_recently_updated(client, now) is True


def test_upsert_queen_ladder_clears_previous_snapshot(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    client = MagicMock()
    ok_resp = MagicMock()
    ok_resp.raise_for_status = MagicMock()
    client.patch = MagicMock(return_value=ok_resp)
    client.post = MagicMock(return_value=ok_resp)

    monkeypatch.setattr(db, "_get_client", lambda: client)
    monkeypatch.setattr(db, "_queen_ladder_recently_updated", lambda *_: False)

    out = db.upsert_queen_ladder_players([
        {
            "steam_id": "76561198000000001",
            "name": "Alpha",
            "rank": 1,
            "mmr": 4200,
            "season": "s40",
            "seen_at": "2026-06-02T12:00:00+00:00",
        },
        {
            "steam_id": "76561198000000002",
            "name": "Beta",
            "rank": 2,
            "mmr": 4100,
            "season": "s40",
            "seen_at": "2026-06-02T12:00:00+00:00",
        },
    ])

    assert out == 2
    client.patch.assert_called_once()
    patch_args, patch_kwargs = client.patch.call_args
    assert patch_args[0] == "/rest/v1/users"
    assert patch_kwargs["params"] == {"queen_ladder_last_seen_at": "not.is.null"}
    assert patch_kwargs["json"] == {
        "queen_ladder_rank": None,
        "queen_ladder_mmr": None,
        "queen_ladder_season": None,
        "queen_ladder_last_seen_at": None,
    }

    client.post.assert_called_once()
    body = client.post.call_args.kwargs["json"]
    assert [row["queen_ladder_rank"] for row in body] == [1, 2]
    assert [row["queen_ladder_last_seen_at"] for row in body] == [
        "2026-06-02T12:00:00+00:00",
        "2026-06-02T12:00:00+00:00",
    ]


def test_upsert_queen_ladder_abort_when_clear_fails(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    client = MagicMock()
    client.patch.side_effect = RuntimeError("patch denied")
    monkeypatch.setattr(db, "_get_client", lambda: client)
    monkeypatch.setattr(db, "_queen_ladder_recently_updated", lambda *_: False)

    out = db.upsert_queen_ladder_players([
        {"steam_id": "76561198000000001", "rank": 1, "mmr": 4200},
    ])

    assert out == 0
    client.post.assert_not_called()


# ── push_match_players ──────────────────────────────────────────────────────


def test_push_match_players_happy_path(tmp_path, monkeypatch, fake_client):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: fake_client)

    rows = [
        {"steam_id": "76561198000000001", "placement": 1, "mmr_level": 5},
        {"steam_id": "76561198000000002", "placement": 2, "mmr_level": 4},
    ]
    n = db.push_match_players("abc1234567890def", rows)
    assert n == 2

    # One POST with both rows in the body.
    fake_client.post.assert_called_once()
    args, kwargs = fake_client.post.call_args
    assert args[0] == "/rest/v1/match_players"
    body = kwargs["json"]
    assert len(body) == 2
    # steam_id coerced to int (bigint on server).
    assert all(isinstance(r["steam_id"], int) for r in body)
    # match_id stamped onto every row.
    assert all(r["match_id"] == "abc1234567890def" for r in body)


def test_push_match_players_drops_unknown_columns(tmp_path, monkeypatch, fake_client):
    """Future end_board fields shouldn't break the insert — db.py whitelists
    columns before POST so unknown keys are dropped silently."""
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: fake_client)
    rows = [{
        "steam_id": "76561198000000001",
        "placement": 1,
        "future_dac_field": "nope",  # not in schema
        "bogus": {"deeply": "nested"},
    }]
    db.push_match_players("ffffffffffffffff", rows)

    body = fake_client.post.call_args.kwargs["json"]
    assert "future_dac_field" not in body[0]
    assert "bogus" not in body[0]
    assert body[0]["placement"] == 1


def test_push_match_players_local_only(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    monkeypatch.setenv("DAC_LOCAL_ONLY", "1")
    import db

    rows = [
        {"steam_id": "76561198000000001", "placement": 1},
        {"steam_id": "76561198000000002", "placement": 2},
    ]
    n = db.push_match_players("eeeeeeeeeeeeeeee", rows)
    assert n == 0  # no Supabase



def test_push_match_players_empty_list(tmp_path, monkeypatch, fake_client):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: fake_client)
    assert db.push_match_players("xxx", []) == 0
    fake_client.post.assert_not_called()


def test_push_match_players_failure_swallows(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    boom_client = MagicMock()
    boom_client.post.side_effect = RuntimeError("503")
    monkeypatch.setattr(db, "_get_client", lambda: boom_client)
    out = db.push_match_players("ddddddddddddddd1", [{"steam_id": "1", "placement": 1}])
    assert out == 0
