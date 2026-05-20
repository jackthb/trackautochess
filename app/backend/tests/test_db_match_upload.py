"""Unit tests for the live-match Supabase upload helpers in db.py.

Covers:
  - generate_live_match_id determinism + hehe-insensitivity
  - push_match / push_match_players happy path, local_only, failure
  - push_live_game shape

Run:
  cd app/backend
  pytest tests/test_db_match_upload.py -v
"""

from __future__ import annotations

import json
import sys
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
    # `players` is NOT a column on the matches table — it must be dropped.
    assert "players" not in body

    # Local sidecar exists.
    sidecar = tmp_path / "matches" / "abc1234567890def.json"
    assert sidecar.exists()
    saved = json.loads(sidecar.read_text(encoding="utf-8"))
    assert saved["match_id"] == "abc1234567890def"


def test_push_match_local_only(tmp_path, monkeypatch):
    """DAC_LOCAL_ONLY=1 must skip the httpx call but still write the sidecar."""
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
    sidecar = tmp_path / "matches" / "deadbeefdeadbeef.json"
    assert sidecar.exists()


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
    # Sidecar still written first.
    assert (tmp_path / "matches" / "aaaaaaaaaaaaaaaa.json").exists()


def test_push_match_no_supabase_config(tmp_path, monkeypatch):
    """When config is missing url/key, _get_client returns None and we no-op."""
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: None)
    out = db.push_match({"match_id": "bbbbbbbbbbbbbbbb", "played_at": "2026-05-20T12:00:00"})
    assert out is None
    assert (tmp_path / "matches" / "bbbbbbbbbbbbbbbb.json").exists()


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

    # But sidecars still exist.
    mp_dir = tmp_path / "match_players"
    assert len(list(mp_dir.glob("eeeeeeeeeeeeeeee__*.json"))) == 2


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


# ── push_live_game ──────────────────────────────────────────────────────────


def test_push_live_game_shape(tmp_path, monkeypatch, fake_client):
    """push_live_game maps an end_board player row into the legacy `games`
    schema so the web viewer's player profile page renders it identically
    to a CV-imported match."""
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: fake_client)

    row = {
        "match_id": "ccccccccccccccc1",
        "played_at": "2026-05-20T12:00:00",
        "steam_id": "76561198000000001",
        "placement": 1,
        "hero_level": 10,
        "chess_lineup": "Broodmother(3)|Chen(3)",
        "synergies": "Aqir:4|Warlock:2",
        "talents": "talent_1a|talent_2b",
        "relic": "Repeat Relic",
        "win_round": 30,
        "lose_round": 6,
    }
    out = db.push_live_game(row)
    assert out == 1

    body = fake_client.post.call_args.kwargs["json"]
    assert body["match_id"] == "ccccccccccccccc1"
    assert body["user_id"] == 76561198000000001
    assert body["placement"] == 1
    assert body["level"] == 10  # hero_level → level
    assert body["wins"] == 30   # win_round → wins
    assert body["losses"] == 6  # lose_round → losses
    assert body["lineup"] == "Broodmother(3)|Chen(3)"


def test_push_live_game_local_only(tmp_path, monkeypatch):
    _isolated_dac_dir(tmp_path, monkeypatch)
    monkeypatch.setenv("DAC_LOCAL_ONLY", "1")
    import db

    # _get_client returns None under local_only.
    out = db.push_live_game({
        "match_id": "ccccccccccccccc2",
        "steam_id": "76561198000000001",
        "placement": 1,
    })
    assert out is None


def test_push_live_game_missing_steam_id(tmp_path, monkeypatch, fake_client):
    _isolated_dac_dir(tmp_path, monkeypatch)
    import db

    monkeypatch.setattr(db, "_get_client", lambda: fake_client)
    out = db.push_live_game({"placement": 1})
    assert out is None
    fake_client.post.assert_not_called()
