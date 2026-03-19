# DAC Tools — TODO

## Critical — Broken
- [ ] **Toggle recording doesn't work reliably** — stop command reaches Python but ffmpeg `stop()` blocks the command loop for up to 15s. Fix pushed (background thread) but untested in packaged build. Needs rebuild + verification.
- [ ] **Recording never auto-starts** — round_start sentinel template was missing from PyInstaller bundle. Fix pushed to spec file but untested.

## In Progress
- [ ] Auto-recording via sentinels: round_start (0 STARTING) begins recording, final_ranking stops + captures
- [ ] Fix missing level OCR on some rows (mid-scroll screenshots with uneven row heights)

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
- [x] Infinite scroll replaces pagination (20 games at a time)
- [x] Duplicate detection tightened — dropped lineup from check (OCR variance caused false negatives)
- [x] Widget + sentinel templates added to electron-builder.json
- [x] Widget always visible (not tied to focus events)
- [x] Capture button flashes green for feedback
- [x] Public releases repo (jackthb/dac-tracker) + optional publish in build.ps1
- [x] Supabase RLS policies for UPDATE and DELETE on games table

## Backlog
- [ ] Sentinel: poll while Dota is open (process running), not just focused — so recordings work when alt-tabbed
- [ ] Auto-recalculate synergies when lineup is edited
- [ ] rank_change editing (up/down/none toggle or auto-calc from previous game)
- [ ] Delete the 2 existing duplicate games (IDs 393/381 and 392/363)
- [ ] Backfill run with fixed parser
