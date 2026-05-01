# Parser Test Fixtures

Each `.json` file here is a ground-truth fixture created from the desktop app
("Save Fixture" button in the Confirm tab).

Structure:
```json
{
  "screenshot_path": "absolute or relative path to the source image",
  "screen_type": "my_matches" | "game_over",
  "rows": [ { "placement": "1", "level": "10", "wl": "24-9", "units": [...], "synergies": "...", "relic": "..." } ]
}
```

Run tests:
  cd app/backend
  pytest tests/test_fixtures.py -v
