# DAC Tools — TODO

## Critical — Broken
- [ ] **Recording stop never worked in production** — rewrote recorder from ffmpeg subprocess to PyAV (av library). No more pipes/signals. Stop is `container.close()`. Needs rebuild with `av` package installed (`uv pip install av`). Untested.
- [ ] **Round-start sentinel untested** — template bundled in PyInstaller spec, region configured. Needs a live game to verify detection.

## Next Up
- [ ] Sentinel should poll while Dota process is running, not just when focused — so recordings work when alt-tabbed.

## In Progress
- [ ] Auto-recording via sentinels: round_start (0 STARTING) begins recording, final_ranking stops + captures

## Recently Completed (2026-03-18/19)
- [x] Inline game editing — click row to expand edit panel with structured inputs
- [x] Tag pickers for lineup (with star count), synergies (with count), relics (reorderable)
- [x] Rank editor (Pawn-Queen dropdown)
- [x] Game deletion with confirmation
- [x] Screenshot lightbox (portal-based, Escape to close)
- [x] CSP fix — Supabase storage images now load
- [x] Custom frameless title bar (no native Windows bar)
- [x] Formatted synergy tooltips with line breaks, stripped trait/perk labels
- [x] Demon Hunter tooltip matching (normalized name lookup)
- [x] Relic tooltip matching (case/hyphen-insensitive)
- [x] Rank arrows only render when rank exists
- [x] Infinite scroll (20 games at a time, IntersectionObserver)
- [x] Duplicate detection tightened — dropped lineup from check
- [x] Widget + sentinel templates in electron-builder.json + PyInstaller spec
- [x] Widget always visible (not tied to focus events)
- [x] Capture button flashes green for feedback
- [x] Public releases repo (jackthb/dac-tracker) + optional publish in build.ps1
- [x] Supabase RLS policies for UPDATE and DELETE on games table
- [x] Rewrote replay recorder: PyAV replaces ffmpeg subprocess
- [x] Synergies formatted field added to all 36 entries

## Backlog
- [ ] Auto-recalculate synergies when lineup is edited
- [ ] rank_change editing (up/down/none toggle or auto-calc from previous game)
- [ ] Delete the 2 existing duplicate games (IDs 393/381 and 392/363)
- [ ] Fix missing level OCR on some rows (mid-scroll screenshots)

## Roadmap / Future
- [ ] **Listen for F3 presses and capture** — detect F3 keypress as a trigger to capture the current screen state (in addition to sentinel-based auto-capture)
- [ ] **Prioritise Game Over screen parsing** — the full 8-player table has richer data (all placements, player names). Focus CV efforts here over Final Ranking.
- [ ] **Sentinel HTML page multi-resolution support** — `data/sentinel_picker.html` currently assumes one resolution. Make it work across common resolutions (1920x1080, 2560x1440, etc.)
- [ ] **Capture more game state per match** — parse other players from the Game Over screen (who was 1st, last, etc.). Store per-match leaderboard, not just our own placement.
- [ ] **Build up player database** — as we capture other players' names/placements from Game Over screens, upsert them into a players table. Over time this builds a social graph of opponents and their stats.
