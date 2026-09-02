---
name: verify-track-auto-chess
description: Verify Track Auto Chess through its real Next.js web viewer when a change needs user-path proof across public game content, player lookup, navigation, and rendered results.
---

# Verify Track Auto Chess

Use this skill for behavior visible in the Track Auto Chess web product. The Electron capture workflow requires Windows and a running Dota 2 client, so it is not a truthful GUI target on a headless Linux agent. The public web viewer is the real runnable product here; committed content powers its static routes even when Supabase is not configured.

## Launch

From the repository root, create a unique state directory and launch the checked-out source in an isolated tmux session:

```bash
export VERIFY_TRACK_AUTO_CHESS_STATE_DIR="/tmp/verify-track-auto-chess-${USER}-$(date +%s)"
export VERIFY_TRACK_AUTO_CHESS_PORT=3000
./.cursor/skills/verify-track-auto-chess/helpers/launch.sh
```

The helper runs the repository's real command, `PORT=3000 pnpm --dir web run dev`. Its `predev` hook regenerates `web/generated/content-data.ts`, and Next serves the current checkout. Readiness requires both Next's running session and a successful `/` response containing `Track Dota Auto Chess`; success prints `Track Auto Chess ready at http://127.0.0.1:3000`. The raw Next log is at `$VERIFY_TRACK_AUTO_CHESS_STATE_DIR/server.log`.

If launch fails, inspect that log, then run the cleanup helper before retrying with a fresh state directory and, if needed, a different unused port. Teardown is always:

```bash
./.cursor/skills/verify-track-auto-chess/helpers/cleanup.sh
```

## Doctor

Before opening a browser, run the shipped read-only doctor against the exact state created by Launch:

```bash
./.cursor/skills/verify-track-auto-chess/helpers/doctor.sh
```

`doctor=ok` means the recorded tmux session and pane PID still match, the requested port is listening, its listener descends from that pane, the listener runs inside this checkout, and `/` serves the Track Auto Chess title. It reports `surface=public-web auth=not-required`; this is sufficient for the mapped public content features.

Player data and Steam authentication depend on `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. For a flow that needs them, the browser must additionally show a real signed-in user or a real player result before the instance is worth driving. Do not treat the public doctor as proof that external credentials are valid.

## Drive

Use Cursor computer-use in a real browser at the URL printed by Launch. Start at `/` and navigate through visible controls so the recording proves the same path a user takes. Give the computer-use agent accessible names instead of screen coordinates. The repository exposes these stable handles:

- Home: `getByRole("link", { name: "Track Auto Chess home" })`.
- Main groups: `getByRole("button", { name: "Entities" })` and `getByRole("button", { name: "Synergies" })`.
- Public links: `getByRole("link", { name: "Units" })`, `Items`, `Classes`, `Species`, `Talents`, `Queens`, `Creators`, and `Patch Notes`.
- Player lookup: `getByPlaceholder("Steam profile URL or SteamID64")` and `getByRole("button", { name: "Search" })`.
- Entity filtering: `getByPlaceholder("Search units...")`, `Search items...`, `Search classes...`, or `Search species...`.
- Result assertions: page headings such as `getByRole("heading", { name: "Units" })`; entity cards are links named by their visible entity name.

Read the matching guide in `features/` before driving a feature. Prefer the direct accessible selector there if browser layout changes hide a desktop menu behind the `Open menu` button. A route path is an assertion after navigation, not a substitute for clicking the user-facing control.

Use the existing Playwright locators above when writing a repeatable browser script. Playwright's configuration lives in `web/playwright.config.ts`; do not invoke its `webServer` against this dev instance because that configuration expects a prior production build and starts `pnpm run start`.

## Evidence

Create only evidence that demonstrates a successful user story:

1. Run the doctor and save its output under `/opt/cursor/artifacts/track_auto_chess_doctor.log`.
2. Navigate the browser to the start of the mapped path.
3. Start screen recording immediately before the user action.
4. Drive the real UI with Cursor computer-use.
5. Capture the action and resulting state in one concise video under `/opt/cursor/artifacts/`, plus one final-state screenshot only when it adds information.
6. Stop and save the recording immediately after checking the visible result and URL.

Proof must use a real user path, never React setters, browser-storage injection, direct database edits, or test-only endpoints. Show the initiating click or entry and the resulting heading, filtered count, detail page, or validation message. Verify side effects as well as pixels: assert the resulting route for navigation, inspect the actual API response for player lookup, and check persisted data by reloading when a feature claims persistence.

Mocks are allowed only at a production boundary, such as intercepting `/api/players/search` while keeping the real page and client behavior. Label mocked evidence prominently and prefer live configured services. If a dry-run or test mode is introduced, inspect its implementation and state exactly which writes, calls, or subprocesses it skips; a visible success message alone is not proof.

Never save recordings of failed attempts. Discard them, clean up the instance, fix the issue, and repeat.

## Cleanup

Stop only the tmux session recorded by this run:

```bash
./.cursor/skills/verify-track-auto-chess/helpers/cleanup.sh
```

The helper compares the current pane PID with the PID captured at launch before killing the session. It never kills by process name and never touches another dev server. It removes only its `/tmp` state and server log; evidence in `/opt/cursor/artifacts/` remains.

Confirm cleanup and evidence independently:

```bash
test ! -e "$VERIFY_TRACK_AUTO_CHESS_STATE_DIR"
test -s /opt/cursor/artifacts/track_auto_chess_doctor.log
```

Also confirm the verification port no longer listens if it was unused before Launch. Do not stop pre-existing services, and do not delete evidence during cleanup.

## Helpers

- `helpers/launch.sh` starts the current checkout, records ownership, waits for the real home page, and is invoked in Launch.
- `helpers/doctor.sh` performs the ownership/build/response check and is invoked in Doctor.
- `helpers/cleanup.sh` tears down only the recorded session and is invoked in Launch failure handling and Cleanup.

All helpers are executable repository files. Run them from the repository root with the same exported `VERIFY_TRACK_AUTO_CHESS_STATE_DIR`.
