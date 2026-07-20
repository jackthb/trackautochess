# Build guides from video transcripts

Pipeline for turning a build-guide video into a `/builds` share link, without
committing the source creator's transcript anywhere (see `.gitignore` —
`scripts/build-guides/cache/` is local-only, same rationale as
`data/vscripts/`).

## 1. Fetch

```
pnpm run guide:fetch <youtube-url-or-id> [more urls...]
```

Writes `cache/<videoId>.txt` (raw caption text) and `cache/<videoId>.meta.json`.

## 2. Match

```
pnpm run guide:match <videoId> [more ids...]
```

Fuzzy-matches the transcript against `content/game/{units,items,relics,synergies}`
so ASR-garbled names resolve to real slugs (e.g. "Lago" → Largo, "lo" →
Lucid Star). Writes `cache/<videoId>.matches.json` — an entity/mention-count
index, not the transcript itself.

This is a fuzzy pass, not ground truth — ambiguous or low-count matches
still need a human (or Claude) read of the transcript to confirm, same as
the manual cross-referencing done for the first Naga/Monks build.

## 3. Build

Read `cache/<videoId>.txt` + `cache/<videoId>.matches.json` together to
construct the actual `SavedBuild` JSON (units, items, board positions,
snapshots per round) and generate a `/builds?b=...` share link, same as
`gen-build-link.mjs` did for the Naga/Monks build. Always credit/backlink
the source video (`cache/<videoId>.meta.json` has the URL) in the build's
`description`.

Nothing under `cache/` is committed to git.
