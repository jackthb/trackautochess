"""CV parser regression tests against saved fixtures.

Each fixture in tests/fixtures/*.json was created by:
  1. Loading a screenshot via "Load & Parse File" in the desktop app
  2. Correcting any wrong values in the Confirm tab
  3. Clicking "Save Fixture"

Run:
  cd app/backend
  pytest tests/test_fixtures.py -v
"""

import json
import sys
from pathlib import Path

import cv2
import pytest

BACKEND_DIR = Path(__file__).parent.parent
FIXTURES_DIR = Path(__file__).parent / "fixtures"

sys.path.insert(0, str(BACKEND_DIR))


def load_fixtures():
    """CV fixtures only — anything with a `screenshot_path` field. Skips
    nettable end_board fixtures and other non-CV JSON files that share
    this directory."""
    out = []
    for p in FIXTURES_DIR.glob("*.json"):
        try:
            if "screenshot_path" in json.loads(p.read_text(encoding="utf-8")):
                out.append(p)
        except Exception:
            continue
    return out


def fixture_id(path: Path) -> str:
    return path.stem


@pytest.mark.parametrize("fixture_path", load_fixtures(), ids=fixture_id)
def test_fixture(fixture_path: Path):
    from cv_parser import (
        apply_calibration,
        detect_screen_type,
        load_regions_config,
        parse_my_matches,
        parse_game_over_all,
    )
    from utils import DATA_DIR, ICONS_DIR

    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    screenshot_path = Path(fixture["screenshot_path"])
    if not screenshot_path.is_absolute():
        screenshot_path = BACKEND_DIR / screenshot_path

    assert screenshot_path.exists(), f"Screenshot not found: {screenshot_path}"

    img = cv2.imread(str(screenshot_path))
    assert img is not None, f"Failed to read image: {screenshot_path}"

    regions_config = load_regions_config()
    apply_calibration(img, regions_config=regions_config)

    screen_type = fixture.get("screen_type", "my_matches")
    expected_rows = fixture["rows"]

    if screen_type == "my_matches":
        actual_rows = parse_my_matches(img, player_name="", icons_dir=ICONS_DIR, debug=False)
    elif screen_type in ("game_over", "final_ranking"):
        actual_rows = parse_game_over_all(img, ICONS_DIR, debug=False) or []
    else:
        pytest.skip(f"Unknown screen_type: {screen_type}")

    errors: list[str] = []
    if len(actual_rows) != len(expected_rows):
        errors.append(
            f"Row count mismatch: got {len(actual_rows)}, expected {len(expected_rows)}"
        )

    # Scalar fields are asserted whenever the fixture has a value. Every field
    # the fixture records is verified — if it's in the fixture, it's ground
    # truth.
    SCALAR_FIELDS = (
        "placement",
        "player_name",
        "rank",
        "level",
        "wl",
        "gold",
        "damage",
        "duration",
        "synergies",
        "relic",
    )

    def _strip_stars(unit: str) -> str:
        # Parser may suffix units with "(N)" for star level; fixture stores
        # bare names. Strip so the comparison is apples-to-apples.
        return unit.split("(")[0]

    for i, (actual, expected) in enumerate(zip(actual_rows, expected_rows)):
        label = f"row {i}"

        for field in SCALAR_FIELDS:
            if field not in expected:
                continue
            expected_value = expected[field]
            actual_value = actual.get(field, "")
            if actual_value != expected_value:
                errors.append(
                    f"{label}: {field} {actual_value!r} != {expected_value!r}"
                )

        if "units" in expected:
            actual_units = [_strip_stars(u) for u in (actual.get("units") or [])]
            expected_units = [_strip_stars(u) for u in expected["units"]]
            if actual_units != expected_units:
                errors.append(
                    f"{label}: units {actual_units!r} != {expected_units!r}"
                )

    if errors:
        pytest.fail("\n  - " + "\n  - ".join(errors), pytrace=False)
