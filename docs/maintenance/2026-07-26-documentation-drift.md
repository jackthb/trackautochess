# Documentation drift — 2026-07-26

Audit-only report. No documentation was changed in this PR; each finding below
states the correction needed.

Every file path, `npm`/`pnpm` script, `cargo run` subcommand and API route named
in `docs/*.md`, `AGENTS.md` and `CLAUDE.md` was checked against the codebase.

## 1. Removed feature still documented as live: raw nettable dump uploads to Cloudflare R2

This is the biggest one — four separate documents describe an upload path that
no longer exists in any form.

`docs/nettable.md:113` already records the removal:

> Raw decoded nettable rows are local-only; remote raw dump uploads were removed
> entirely on 2026-07-02 (previously Supabase Storage, then Cloudflare R2 via
> `nettable_dump_upload_url`).

That is correct. Confirmed against the code: `nettable_dump_upload_url` appears
**nowhere** in the repository outside documentation, there is no R2 or
`cloudflarestorage` reference in `app/`, `web/`, `scripts/` or `shared/`, and
`app/backend/src/supabase/storage.rs` — the only Storage upload path left — posts
solely to the `diagnostic-logs` bucket.

But four places still describe the removed path as current:

| Location | Stale text | Correction |
| --- | --- | --- |
| `docs/README.md:92` | "Raw nettable dump logs upload through the web app to Cloudflare R2." | Delete the sentence. Supabase Storage `diagnostic-logs` stores diagnostics only. |
| `docs/backend.md:45` | "Raw nettable dump logs post to the configured `nettable_dump_upload_url`, which stores them in Cloudflare R2 server-side." | Delete; note that raw dumps stay local under `~/.dac/nettable_dumps`. |
| `docs/nettable.md:45` | "nettable dump logs upload through the web API to Cloudflare R2." | Delete or mark historical. |
| `docs/nettable.md:16091` | "raw nettable dump logs upload to `nettable_dump_upload_url`, which authenticates the desktop's Supabase session and writes to Cloudflare R2." | Same. |
| `CLAUDE.md` (Key Technical Details) | "Supabase Storage bucket `diagnostic-logs` receives diagnostic **and raw nettable dump** uploads." | Drop "and raw nettable dump" — only diagnostics are uploaded. |

`docs/nettable.md` contradicting itself between line 45 and line 113 is the
clearest signal here: line 113 was updated at removal time, lines 45 and 16091
were not.

## 2. `docs/web.md:60` documents a deleted module — **resolved 2026-07-27**

The analytics section carried a trailing paragraph documenting a module that
had been deleted, along with the environment variables that configured it.
None of it existed in the codebase any more.

Resolved: the paragraph is gone, the section is now just "Analytics", and the
matching block in `web/.env.example` was removed at the same time. Nothing in
the repository references that removed feature now.

## 3. `docs/nettable.md:88` points at a file that was split into a module

The component table lists:

| `app/backend/src/supabase.rs` | Processed match/timeline/Queen uploads, outbox replay, diagnostic-log Storage uploads, and raw nettable dump-log uploads. |

`app/backend/src/supabase.rs` no longer exists — Phase 4 of
`docs/architecture-remediation-plan.md` (recorded as merged in
[#232](https://github.com/jackthb/dac-tools/pull/232)) split it into
`app/backend/src/supabase/`:

```
client.rs  diagnostics.rs  matches.rs  mod.rs  outbox.rs  queen_ladder.rs  storage.rs
```

**Correction:** point the row at `app/backend/src/supabase/` and drop "and raw
nettable dump-log uploads" from the description per finding 1.

## 4. `scripts/build-guides/README.md` names a renamed script

Step 3 says the build link is generated "same as `gen-build-link.mjs` did for the
Naga/Monks build". No `gen-build-link.mjs` exists; the directory contains
`encode-share-link.mjs`, which does that job.

**Correction:** rename the reference to `encode-share-link.mjs`.

## 5. Backend CLI: five subcommands are undocumented

Not stale references, but the inverse drift — `app/backend/src/main.rs` dispatches
twelve subcommands while `CLAUDE.md` and `docs/README.md` list only seven.
Undocumented:

| Subcommand | `main.rs` |
| --- | --- |
| `outbox-flush` | 93 |
| `finalize-log` | 115 |
| `finalize-dump` | 146 |
| `timeline-from-dump` | 204 |
| `timeline-from-log` | 237 |

**Correction:** add them to the backend command lists in `CLAUDE.md` and
`docs/README.md`, or state explicitly that the list covers only the commonly used
commands.

## 6. Database table lists are missing five tables

`CLAUDE.md` and `docs/README.md:92` both list the product tables as `users`,
`player_seasons`, `mmr_snapshots`, `matches`, `match_players`, `match_timelines`,
`lineup_snapshots`. All seven still exist, but migrations have since added:

`community_builds`, `community_build_votes`, `community_build_comments`
(`20260716154029`, `20260722094500`), `content_embeddings` (`20260707000000`),
and `site_status`.

**Correction:** extend both lists.

## Checked and found accurate

- Every `npm run …` / `pnpm run …` command named in the docs (28 distinct
  invocations) exists in the corresponding `package.json`.
- All seven documented `cargo run -- <cmd>` subcommands exist.
- `AGENTS.md`'s `web/generated/content-data.ts` matches the generator's real
  output path.
- The documented workflow policy — `poll-drodo.yml` and `scrape-patch-notes.yml`
  as manual-only fallbacks with Cronicle as the primary path — matches the actual
  `on:` blocks (`workflow_dispatch` only).
- File paths named in `docs/architecture-remediation-plan.md` that do not exist
  (`steam_setup.rs`, `app/main/supabase-ipc.cjs`) are **not** errors: that document
  is a forward-looking plan, and those are names for work to be done, not claims
  about the current tree. Left alone deliberately.
