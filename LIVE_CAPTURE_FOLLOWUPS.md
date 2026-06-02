# Live Capture Follow-Ups

Notes from the June 2, 2026 live game test. These are product and engineering
follow-ups discovered while validating nettable capture, diagnostics, and match
timeline persistence.

## 1. Diagnostic Log Lifecycle

Problem:
- Dota `console.log` and tracker diagnostics can become very large during
  repeated games.
- Full diagnostic uploads are useful for recovery and debugging, especially for
  reconstructing raw `vchess_*` board snapshots.
- Keeping the same local logs forever risks unbounded disk growth for users.

Current state:
- Diagnostic uploads now send full gzipped raw log bytes to Supabase storage.
- The small PostHog event tails remain capped for dashboard readability.
- Local logs are not automatically cleared after a successful upload.

Proposed direction:
- After a successful Supabase diagnostic upload, rotate or truncate local
  diagnostics that have been safely uploaded.
- Prefer a bounded local retention policy over silent unbounded growth.
- Avoid deleting data before upload success is confirmed.
- Preserve enough local state to debug the current run if upload fails.

Open questions:
- Should `console.log` be truncated in place after upload, or should the app
  rotate it to an archived file and then clear the active file?
- Should tracker logs and Dota console logs follow the same retention policy?
- What local retention target is reasonable: last successful upload only, last
  N sessions, or a size cap?

## 2. Home And History Consolidation

Problem:
- The desktop home page and history page are drifting into overlapping concepts.
- Home currently shows live capture and live standings.
- History shows prior matches.
- Closing and reopening the app loses useful live/debug context, which makes
  validation and later review annoying.

Desired behavior:
- The match history view should also surface the latest live capture state,
  current standings, and capture/debug status.
- The user should be able to reopen the app and still inspect the latest known
  capture state for the last game/session.
- The app should make the live/last-captured state visible without requiring an
  active game.

Proposed direction:
- Treat "current or latest match" as a first-class persisted view model.
- Persist the latest live standings, latest player board state, and capture
  diagnostics locally and/or in Supabase.
- Rework home/history into one coherent match review surface rather than two
  separate pages with overlapping responsibilities.

Open questions:
- Should the home page become the history page, or should history absorb the
  live capture modules?
- Which debug panels should be user-facing by default versus tucked behind a
  developer/debug toggle?
- Should latest capture state come from local storage, Supabase, or both?

## 3. Structured Chess Board Timeline

Problem:
- The uploaded `match_timelines` row currently stores per-player `lineup` for
  each round, but not a structured board.
- The raw `player_id_table.vchess_*` dump contains richer data:
  - piece id/name via `chess`
  - board coordinates via `x` and `y`
  - per-piece item state via `item` and `lastitem`
  - additional piece metadata such as `buy_price`, `index`, and counters
- The timeline extractor currently flattens `vchess_*` into a pipe-delimited
  lineup string and discards positions/items.

Desired behavior:
- Show each player's chess board at a chosen round/time.
- Preserve board positions and per-piece items from `vchess_*`.
- Start with board display only; future work can add matchup visualization
  such as who is fighting whom.

Proposed data direction:
- Extend timeline player snapshots with a structured `board` array, for example:

```json
{
  "round": 53,
  "players": {
    "76561198022169086": {
      "placement": 2,
      "level": 13,
      "lineup": "Keeper of the Light(3)|...",
      "board": [
        {
          "slot_key": "2_4",
          "chess": "chess_aa1",
          "name": "Ancient Apparition",
          "x": 4,
          "y": 2,
          "items": ["item_jurenzhijie"],
          "last_items": []
        }
      ]
    }
  }
}
```

Implementation notes:
- The existing `parse_log()` collapses repeated table/key dumps and only keeps
  the latest value, so recovery from full logs needs a time-aware parser that
  preserves every dump block.
- Live capture should also persist structured board snapshots directly, so
  future games do not require log reconstruction.
- `chessboard_*` is a cosmetic board skin and should stay filtered out.
- `vchess_*` is the useful board-state source and should be retained in the
  timeline extraction path.

Shared UI direction:
- Board rendering should be shared between the Electron app and the web app.
- Prefer a shared data model and rendering component contract under `shared/`
  rather than duplicating parsing and styles in both apps.
- Define common TypeScript types for match timeline, player snapshot, board
  piece, item ids, and board coordinates.
- Consider a shared React board component if both web and Electron can consume
  the same styling stack cleanly; otherwise share the model/parser first and
  keep host-specific presentation thin.

Open questions:
- What exact coordinate system does `vchess_*` use, and how should it map to
  the displayed board grid?
- Are `item` and `lastitem` both needed for current board display, or should one
  be treated as historical/debug state?
- Should the board timeline be stored inline in `match_timelines.timeline`, or
  split into a separate heavier table/object for large matches?
