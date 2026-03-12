# DAC Tools — TODO

## Parsing Accuracy
- [x] Fix web frontend unit icons not displaying (prebuild copy replaces symlink)
- [x] Show date + time in match history table
- [x] Fix 1-unit rows: `_detect_two_row` needed `y_mid - 8` padding to catch bottom-row icons
- [ ] Fix missing level OCR on some rows (caused by mid-scroll screenshots with uneven row heights)

## Post-Parse Confirmation UI

### Problem
OCR parsing is imperfect — row boundaries shift when the user was scrolling, causing missing levels, empty placements, or truncated unit lists. Rather than chasing every edge case in the parser, add a confirmation step where the user can review and correct parsed results before they hit the DB.

### Flow change
- **Current**: sentinel → overlay → capture → parse → push (silent)
- **New**: sentinel → overlay → capture → parse → **confirmation modal** → user confirms/edits → push

### Integration point
In `tray_app.py::_do_parse_my_matches()`, after `parse_my_matches()` + `infer_timestamps()` but before the `push_game()` loop:

```python
rows = parse_my_matches(img, ...)
timestamps = infer_timestamps(rows, screenshot_time)
screenshot_url = upload_screenshot(img, user_id) or ""

# NEW: show confirmation modal
confirmed_rows = show_confirmation(img, rows, timestamps)
if not confirmed_rows:
    return  # user cancelled

for row_data, played_at in confirmed_rows:
    # existing dedup + push logic
```

### Implementation
- [ ] Create `tracker/confirm_ui.py` — `show_confirmation(img, rows, timestamps) -> list | None`
  - tkinter Toplevel window, blocks caller via `wait_window()`
  - Screenshot preview at top (PIL → ImageTk, scaled down)
  - Scrollable table of parsed rows showing: placement, level, W-L, rank, unit count, synergies, relic
  - Editable fields: placement, level, units (the known OCR failure points)
  - Per-row checkboxes to include/exclude (all checked by default)
  - Confirm → returns list of (row_dict, timestamp) for checked rows
  - Cancel → returns None
- [ ] Wire into `tray_app.py::_do_parse_my_matches()` — after `parse_my_matches()` + `infer_timestamps()`, before `push_game()` loop
- [ ] Dark theme matching overlay: `#1a1a2e` bg, `#16213e` alternating rows, `#4a6fa5` accent, Segoe UI font
- [ ] Topmost, resizable, not fullscreen

### Style reference
Reuse dark theme constants from `tracker/overlay.py`:
- Background: `#1a1a2e`
- Alternating rows: `#16213e`
- Accent: `#4a6fa5`
- Font: Segoe UI

### Pre-step
- [ ] Run real backfill (`python backfill.py ../data/screenshots`, no --dry-run) to populate 82 games
- [ ] Verify no 1-unit rows in DB after

### Verification
- F7 test hotkey on known screenshot → modal appears with correct data
- Edit a placement, uncheck a row, confirm → only checked rows push
- Cancel → nothing pushes
- Clean screenshot (all rows correct) — confirm-all should be fast

## Backfill
- [ ] Run real backfill with y_mid-8 fix (DB cleared, dry run shows 82 games, 0 one-unit rows)
