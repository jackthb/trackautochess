# Stale TODO/FIXME audit — 2026-08-09

Swept the whole repo for `TODO`, `FIXME`, `XXX`, `HACK`, and `WORKAROUND`
markers across TypeScript, JavaScript, Rust, Python, SQL, CSS, YAML, and TOML
sources, excluding `node_modules/`, `target/`, `dist/`, `.next/`, and `release/`.

**The repo has exactly 2 markers in total. One is older than 90 days.**

Age is measured by `git blame` on the marker line against the full (unshallowed)
history. Cutoff for "older than 90 days" as of 2026-08-09 is **2026-05-11**.

This file is a record only — no code was changed in this branch.

## Older than 90 days — 1 finding

### `web/components/player/PlayerView/index.tsx:416`

- **Introduced:** 2026-04-29 in `b005fd21` ("Add April 29 rebalance patch data")
- **Age:** 102 days
- **Marker:** `TODO`
- **Note:** the line was authored in `web/pages/players/[steamId].tsx` and
  carried into its current location by the App Router migration, so it predates
  the file it now lives in.

```tsx
  // TODO: ingest total matches / avg rank / wins / preferred lineup / max damage from history pages for server-side season snapshots.
  useEffect(() => {
    setAvatarFailed(false);
  }, [steamProfile.avatarUrl]);
```

**What it is asking for:** the player view currently derives total matches,
average rank, wins, preferred lineup, and max damage on the client from the
loaded history pages. The TODO wants those five figures ingested into the
server-side season snapshot instead, so they are available without the client
walking history.

**Why it is worth a decision now:** this touches `player_seasons`, which has
gained columns since April (`queen_rank` was added on 2026-07-03). Either the
ingest is still wanted and should get a real issue, or the client-side
derivation is the accepted answer and the comment should go. Three months of
silence suggests the latter, but that is the maintainer's call — this audit does
not remove it.

## Newer than 90 days — 1 marker, not flagged

### `app/preload.js:3`

- **Introduced:** 2026-06-10 in `825c9647` ("[codex] fix sandboxed preload channel constants (#237)")
- **Age:** 60 days — inside the window, listed here only for completeness

```js
// TODO: Generate this and ipc-channels.cjs from one source. Sandboxed Electron
// preload scripts cannot require sibling project modules directly.
```

This one is self-documenting about its own constraint and is still recent. No
action suggested.

## Method note

The repository clone starts shallow (50 commits, grafted at 2026-07-23). Blaming
against that graft reports **both** markers as dated 2026-07-23, which would
have shown zero findings. `git fetch --unshallow` (1003 commits, back to
2026-02-23) was required before the dates above were meaningful. Any future
run of this audit needs the same step.
