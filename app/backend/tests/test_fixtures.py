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
    return list(FIXTURES_DIR.glob("*.json"))


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

    for i, (actual, expected) in enumerate(zip(actual_rows, expected_rows)):
        label = f"row {i}"

        for field in ("placement", "level", "wl"):
            if expected.get(field) and actual.get(field) != expected[field]:
                errors.append(
                    f"{label}: {field} {actual.get(field)!r} != {expected[field]!r}"
                )

        if expected.get("units"):
            actual_units = set(u.split("(")[0] for u in (actual.get("units") or []))
            expected_units = set(u.split("(")[0] for u in expected["units"])
            missing = expected_units - actual_units
            extra = actual_units - expected_units
            if missing or extra:
                errors.append(
                    f"{label}: unit mismatch — missing={sorted(missing)}, "
                    f"extra={sorted(extra)}"
                )

        if expected.get("synergies"):
            actual_syns = set(s.split(":")[0] for s in (actual.get("synergies") or "").split("|") if s)
            expected_syns = set(s.split(":")[0] for s in expected["synergies"].split("|") if s)
            missing = expected_syns - actual_syns
            if missing:
                errors.append(f"{label}: missing synergies={sorted(missing)}")

    if errors:
        pytest.fail("\n  - " + "\n  - ".join(errors), pytrace=False)
