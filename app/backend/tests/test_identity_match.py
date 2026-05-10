"""Unit tests for the Game Over identity-hint helpers in cv_parser.

These guard the OCR-name → current-user fuzzy match: normalization (clan
tags, casing, edge punctuation) and the SequenceMatcher score crossing
the IDENTITY_MATCH_THRESHOLD documented in the parser.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from cv_parser import (  # noqa: E402
    IDENTITY_MATCH_THRESHOLD,
    _normalize_player_name,
    _row_confidence,
    name_match_score,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("jack", "jack"),
        ("JACK", "jack"),
        ("  jack  ", "jack"),
        ("jack [FC4P]", "jack"),
        ("jack (NA)", "jack"),
        ("|jack|", "jack"),
        ("...jack...", "jack"),
        ("Jack [FC4P] (NA)", "jack"),
        ("", ""),
        (None, ""),
    ],
)
def test_normalize_player_name(raw, expected):
    assert _normalize_player_name(raw) == expected


def test_name_match_score_exact_normalized_returns_one():
    assert name_match_score("Jack [FC4P]", "jack") == 1.0


def test_name_match_score_empty_inputs_return_zero():
    assert name_match_score("", "jack") == 0.0
    assert name_match_score("jack", "") == 0.0
    assert name_match_score("", "") == 0.0


def test_name_match_score_close_ocr_passes_threshold():
    """A typical OCR slip ('jack' → 'jeck' / 'iack') should still clear the
    threshold; gibberish should not."""
    assert name_match_score("iack", "jack") >= IDENTITY_MATCH_THRESHOLD
    assert name_match_score("jeck", "jack") >= IDENTITY_MATCH_THRESHOLD
    assert name_match_score("medvagon", "jack") < IDENTITY_MATCH_THRESHOLD


def test_name_match_score_is_symmetric():
    a = name_match_score("MartelI", "Martell")
    b = name_match_score("Martell", "MartelI")
    assert a == b


def test_row_confidence_full_row_is_one():
    row = {
        "level": "10",
        "wl": "25-12",
        "synergies": "Knight:6|Mage:3",
        "relic": "Some Relic",
        "player_name": "jack",
        "rank": "Bishop-7",
    }
    assert _row_confidence(row) == 1.0


def test_row_confidence_empty_row_is_zero():
    assert _row_confidence({}) == 0.0


def test_row_confidence_in_unit_interval():
    partial = {"level": "10", "wl": "", "synergies": "Knight:6"}
    score = _row_confidence(partial)
    assert 0.0 < score < 1.0
