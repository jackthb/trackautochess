# 16:9 Game Over Screenshot Import PRD

## Summary

DAC Tools needs a reliable downloaded desktop flow for accepting a single 16:9 Dota Auto Chess Game Over screenshot, parsing it locally, uploading the result, and sending the user to their web profile/history page for correction. The desktop app is not a full correction workspace in this phase. It is the local auth, image upload, parsing, upload, and pause shell.

This work intentionally parks the My Matches / Match History flow. That path already works well enough for current use on 21:9 screenshots and should not block the Game Over import path.

## Problem

The current Game Over import path is too brittle and too coupled:

- Game Over parsing can push directly into storage before the user can correct it in the web profile/history UI.
- The parser, Parser Lab, and debug tools duplicate parts of the same behavior instead of sharing one parser surface.
- Player identity is inferred mainly from OCR'd names, which is unreliable.
- The Parser Lab can appear to recalibrate a region without saving that calibration into the parser config.
- Fixtures exist as a concept, but there is no real Game Over fixture corpus keeping quality from regressing.

There was also a planning ambiguity that must not leak into implementation: the Python backend is not a deployed service. It ships with the downloaded desktop app and runs on the user's machine. The web app receives uploaded data and provides the profile/history editing surface.

The result is a parser/debugging loop that is hard to trust. A debugger that reimplements parser behavior is not a debugger; it is another parser to debug.

## Goals

- Import one 16:9 Game Over screenshot through the downloaded desktop app.
- Parse all 8 player rows locally in the bundled Python backend.
- Upload the screenshot and parsed draft/result to the existing backend/database.
- Show a success state in the desktop app with a link to the user's web profile/history.
- Let the user correct imported history on the web profile/history page, not in the desktop app for this phase.
- Store the source screenshot and link submitted rows back to that screenshot.
- Consolidate Parser Lab and debug views around the production parser output.
- Add real fixtures for Game Over screenshots and run them through the production parser.

## Non-Goals

- Port the parser to browser JavaScript in this phase.
- Rework My Matches / Match History parsing in this phase.
- Require automatic background detection before manual upload works.
- Require perfect name OCR before upload can proceed.
- Require known Steam identities for all 8 players.
- Build the full Game Over correction UI inside the desktop app in this phase.

## User Flow

1. User opens the downloaded desktop app.
2. App authenticates the user.
3. If the authenticated user is the developer/admin user, show the existing full desktop/debug tooling.
4. If the authenticated user is not the developer/admin user, show the constrained upload shell:
   - a large Game Over screenshot drag/drop box,
   - a file picker fallback,
   - minimal upload/parse status.
5. User drags in or selects a Game Over screenshot.
6. Desktop app stores the original screenshot locally.
7. Bundled Python backend parses the screenshot locally into a Game Over draft/result.
8. Desktop app uploads the screenshot and parsed data.
9. Desktop app shows "Uploaded" and a link to the user's web profile/history.
10. User opens the link and edits/corrects history in the web app.

## Parser Contract

The Game Over parser should expose one production entry point:

```python
parse_game_over_screenshot(image, *, icons_dir, user_avatar=None) -> GameOverDraft
```

The local parser output should include enough data for upload and later web correction:

- `screen_type`
- `screenshot_width`
- `screenshot_height`
- `rows`
- `warnings`
- `trace`

Each row should include:

- `row_index`
- `placement`
- `player_label`
- `player_name_raw`
- `player_name`
- `rank`
- `level`
- `wl`
- `synergies`
- `relic`
- `avatar_match_score` (reserved for the avatar-comparison leg of identity matching; currently `None` until that slice lands)
- `identity_match_score` (0.0–1.0 fuzzy name score vs. logged-in user, or `None` when no hint)
- `identity_match_source` (`"name"` when `current_user_name` was supplied, otherwise `None`)
- `is_current_user_candidate` (true on at most one row, the one above `IDENTITY_MATCH_THRESHOLD`)
- `confidence` (0.0–1.0 weighted completeness of parsed fields on the row)
- `crops`

The `trace` is the shared debug surface. Parser Lab, Debug Row, and fixtures should read from this data instead of reimplementing parser logic.

## Identity Strategy

Identity should not depend on OCR'd names. In this phase, identity hints can be computed locally and uploaded with the parsed data, but manual correction happens in the web profile/history UI.

Preferred order:

1. Compare the logged-in user's Steam avatar against avatar crops from each Game Over row. **Not yet implemented.** The 16:9 Game Over screen does include a per-row player portrait inside `COL_PLAYER` — open question #1 stays open pending a separate slice that crops the avatar, runs a perceptual hash / template comparison against the logged-in user's Steam avatar, and populates `avatar_match_score`.
2. Exact/fuzzy match against the logged-in Steam display name. **Implemented** in `parse_game_over_screenshot(current_user_name=...)`: the parser normalizes both sides (lowercase, strip clan tags like `[FC4P]`, trim edge punctuation), scores each row with `difflib.SequenceMatcher`, and flags the highest-scoring row above `IDENTITY_MATCH_THRESHOLD` as `is_current_user_candidate`. The score lives on each row as `identity_match_score` with `identity_match_source: "name"`.
3. If still ambiguous, leave the row anonymous and let the user correct it in the web profile/history UI.

The headless backend uses the parser's identity hint as a fallback in `_resolve_game_over_users`: when the exact OCR-name match against the user's `steam_name` misses (typical OCR drift, clan-tag suffix, etc.), a row flagged `is_current_user_candidate` is still linked to `my_user_id`. Once the avatar leg lands, `is_current_user_candidate` should be promoted from the higher of the two scores.

Unknown players are valid. Rows may be uploaded as "Player 1" through "Player 8" with raw OCR text attached separately.

## Parser Lab Requirements

Parser Lab must become an honest view over the production parser:

- It must call the same Game Over parser entry point as import.
- It must render the parser's trace/crops/candidates.
- It must not contain separate Game Over synergy, relic, rank, or W-L parsing implementations.
- Region edits must either be read-only experiments or explicitly saved to parser config.
- Saved fixtures must store human-corrected expected values, not blindly bless current parser output.
- "Run fixtures" must execute the production parser against fixture screenshots.

## Desktop App Requirements

- Keep the Python parser local inside the downloaded app.
- Authenticate on load.
- Gate UI by user:
  - developer/admin user: existing full app/debug tooling,
  - normal user: constrained upload shell only.
- Add a large Game Over screenshot drag/drop upload box.
- Add a file picker fallback.
- Send only the local screenshot path to the bundled Python backend; the React shell does not run parser logic.
- Provide links or hints to common Steam Dota 2 screenshot directories later; do not block the first slice on this.
- Parse locally, upload screenshot + parsed result, then show "Uploaded".
- Show a link to the user's web profile/history after upload.
- Do not build desktop correction/editing UI in this phase.
- Keep manual upload working even if background CV/sentinel is paused.

## Web App Requirements

- The web profile/history page is the correction surface.
- Imported Game Over rows should be editable in history.
- Unknown players should be displayable as "Player 1" through "Player 8" until corrected.
- The source screenshot should be accessible from the history/profile context.
- Correction can be added incrementally; the desktop app should still upload enough data to support it.

## Background CV / Sentinel Behavior

Automatic Game Over detection can be added after manual upload is reliable.

When automatic detection is active:

- Detect Game Over / Final Ranking.
- Pause sentinel matching once a Game Over candidate is found.
- Capture or ask the user to provide the screenshot.
- Keep sentinel paused while upload is pending.
- Resume sentinel only after upload completion, dismiss, or explicit resume.

## Data Model Notes

Uploaded rows should share a `match_id`.

Rows linked to known Steam users should use their real user id. Unknown rows should still be preserved as match participants when the schema supports it. If the current `games` table cannot represent anonymous participants cleanly, add a separate match participant table rather than forcing fake users.

## Implementation Plan

1. Add this PRD and open a draft PR.
2. Introduce a `GameOverDraft` parser result shape in the backend.
3. Refactor existing `parse_game_over_all` into the single production parser entry point.
4. Update Parser Lab to render the production parser trace and remove duplicate Game Over reparsers.
5. Add the constrained normal-user desktop upload shell. Done in first slice.
6. Add drag/drop + file picker screenshot ingestion. Done in first slice.
7. Upload screenshot + parsed Game Over result and return a web profile/history link. Done in first slice.
8. Add web profile/history editing for imported Game Over rows.
9. Add avatar crop extraction and Steam avatar comparison.
10. Seed Game Over fixture screenshots and expected rows.
11. Add tests that run fixtures through the production parser.
12. Add sentinel pause/resume around automatic Game Over detection.

## Open Questions

- Does the current Game Over screen always include player avatars at a useful resolution? Spot-check on the 2560×1440 fixture (`data/screenshots/20260205145859_1.jpg`) shows a square portrait inside `COL_PLAYER` for at least the first 4 rows; need to confirm consistency across 1920×1080, 3440×1440, and rows with poor lighting before relying on it for identity matching.
- Should anonymous player rows live in the existing `games` table or a new match participant table?
- Should the developer/admin gate remain `admin_mode` / Steam ID allowlist / dev build default, or should packaged beta builds expose a hidden override?
- The first slice opens `/players/{steam_id}` on the configured web base URL; confirm this remains the right correction route once the web editing UI is added.
- Should screenshot upload happen before or after parser success?
- What is the minimum acceptable parser accuracy before automatic detection is enabled?
- Which 16:9 resolutions should be fixture coverage targets first: 1920x1080, 2560x1440, or both?
- Is `IDENTITY_MATCH_THRESHOLD = 0.72` the right floor, or do we want to expose a per-user override after we've collected real fixture data?
