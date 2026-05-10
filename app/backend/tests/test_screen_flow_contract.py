"""High-level parser flow contract tests.

These tests intentionally check shape and routing, not final parser accuracy.
They are the guardrails for the import flow:

1. classify the screenshot,
2. route Game Over screenshots to the draft parser,
3. expose row-based data for all 8 players,
4. keep Match History / My Matches detection covered while that flow is parked.

When the correction UI and fixture corpus land, these should be expanded with
human-corrected expected values.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import pytest

BACKEND_DIR = Path(__file__).parent.parent
REPO_ROOT = BACKEND_DIR.parent.parent
SCREENSHOTS_DIR = REPO_ROOT / "data" / "screenshots"

sys.path.insert(0, str(BACKEND_DIR))


def _load_sample(filename: str):
    path = SCREENSHOTS_DIR / filename
    if not path.exists():
        pytest.skip(f"sample screenshot missing: {path}")
    img = cv2.imread(str(path))
    if img is None:
        pytest.fail(f"cv2 could not read sample screenshot: {path}")
    return img


@pytest.mark.parametrize(
    ("filename", "expected_screen"),
    [
        ("20260205145859_1.jpg", "game_over"),
        ("ref_my_matches_21x9.png", "my_matches"),
    ],
)
def test_known_screens_are_classified(filename: str, expected_screen: str):
    from cv_parser import detect_screen_type

    img = _load_sample(filename)

    assert detect_screen_type(img) == expected_screen


def test_game_over_parser_returns_eight_row_draft_slots():
    from cv_parser import parse_game_over_screenshot
    from utils import ICONS_DIR

    img = _load_sample("20260205145859_1.jpg")

    draft = parse_game_over_screenshot(img, icons_dir=ICONS_DIR, debug=False)

    assert draft["screen_type"] == "game_over"
    assert draft["screenshot_width"] > 0
    assert draft["screenshot_height"] > 0
    assert len(draft["rows"]) == 8

    for row_index, row in enumerate(draft["rows"]):
        assert row["row_index"] == row_index
        assert row["placement"] == str(row_index + 1)
        assert row["player_label"] == f"Player {row_index + 1}"


def test_game_over_trace_contains_regions_for_each_row():
    from cv_parser import parse_game_over_screenshot
    from utils import ICONS_DIR

    img = _load_sample("20260205145859_1.jpg")

    draft = parse_game_over_screenshot(img, icons_dir=ICONS_DIR, debug=False)
    trace = draft["trace"]

    row_indices = {
        entry["row_index"]
        for entry in trace
        if entry.get("row_index") is not None
    }
    categories_by_row = {
        row_index: {
            entry["category"]
            for entry in trace
            if entry.get("row_index") == row_index
        }
        for row_index in row_indices
    }

    assert row_indices == set(range(8))
    for row_index in range(8):
        assert {
            "go_row",
            "go_player_name",
            "go_player_rank",
            "go_level",
            "go_synergies",
            "go_relics",
            "go_wl",
        }.issubset(categories_by_row[row_index])


def test_match_history_parser_flow_is_parked_but_detectable():
    """My Matches is not the current implementation target, but routing matters."""
    from cv_parser import detect_screen_type

    img = _load_sample("ref_my_matches_21x9.png")

    assert detect_screen_type(img) == "my_matches"


def test_game_over_rows_carry_per_row_confidence():
    """Confidence is a 0..1 float on every row, regardless of identity hint."""
    from cv_parser import parse_game_over_screenshot
    from utils import ICONS_DIR

    img = _load_sample("20260205145859_1.jpg")
    draft = parse_game_over_screenshot(img, icons_dir=ICONS_DIR, debug=False)

    for row in draft["rows"]:
        c = row.get("confidence")
        assert isinstance(c, float), f"row {row['row_index']}: confidence not a float"
        assert 0.0 <= c <= 1.0, f"row {row['row_index']}: confidence out of range: {c}"


def test_identity_hint_is_inert_when_no_current_user_provided():
    """Without a hint, no row should be flagged and identity scores stay None."""
    from cv_parser import parse_game_over_screenshot
    from utils import ICONS_DIR

    img = _load_sample("20260205145859_1.jpg")
    draft = parse_game_over_screenshot(img, icons_dir=ICONS_DIR, debug=False)

    for row in draft["rows"]:
        assert row["identity_match_score"] is None
        assert row["identity_match_source"] is None
        assert row["is_current_user_candidate"] is False


def test_identity_hint_promotes_at_most_one_row():
    """When current_user_name is supplied, scores populate and at most one row
    is flagged is_current_user_candidate (the highest-scoring row above
    threshold)."""
    from cv_parser import parse_game_over_screenshot
    from utils import ICONS_DIR

    img = _load_sample("20260205145859_1.jpg")
    draft = parse_game_over_screenshot(
        img,
        icons_dir=ICONS_DIR,
        current_user_name="jack",
        debug=False,
    )

    candidates = [r for r in draft["rows"] if r["is_current_user_candidate"]]
    assert len(candidates) <= 1, "more than one row was flagged as current user"

    for row in draft["rows"]:
        assert row["identity_match_source"] == "name"
        score = row["identity_match_score"]
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0


def test_identity_hint_links_jack_row_on_known_screenshot():
    """The 'jack' row in the bundled fixture (placement 2, OCR'd as
    'jack [FC4P]') is the canonical identity-hint case. After clan-tag
    stripping we expect an exact match, so this row must be flagged."""
    from cv_parser import parse_game_over_screenshot
    from utils import ICONS_DIR

    img = _load_sample("20260205145859_1.jpg")
    draft = parse_game_over_screenshot(
        img,
        icons_dir=ICONS_DIR,
        current_user_name="jack",
        debug=False,
    )

    candidates = [r for r in draft["rows"] if r["is_current_user_candidate"]]
    assert len(candidates) == 1, (
        "expected exactly one current-user candidate on this screenshot"
    )
    flagged = candidates[0]
    assert flagged["placement"] == "2"
    assert flagged["identity_match_score"] >= 0.9
