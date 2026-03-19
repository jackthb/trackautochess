# DAC Tools — TODO

## Critical — Broken
- [ ] **Recording stop never worked in production** — rewrote recorder from ffmpeg subprocess to PyAV (av library). No more pipes/signals. Stop is `container.close()`. Needs rebuild with `av` package installed (`uv pip install av`). Untested.
- [ ] **Round-start sentinel untested** — template bundled in PyInstaller spec, region configured. Needs a live game to verify detection.

## Next Up
- [ ] Link replays to game rows — add `replay` text column to `games` table in Supabase, store filename on game end. UI shows play button if local file exists.
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
