# Rust desktop services backend

This crate is the Rust local-services backend spawned by the Electron desktop app in development and packaged builds. It communicates with Electron over JSON Lines on stdin/stdout, so daemon stdout is reserved for protocol messages and diagnostics should go to stderr.

## Service surface

- `config`: creates/loads `config.json` in the DAC data dir (`%APPDATA%\@dac\desktop` on Windows, `~/.dac` elsewhere; `DAC_DIR` overrides both) with desktop defaults, and supports `set_config` updates over IPC.
- `gsi`: starts a local HTTP listener on `127.0.0.1:4001`, detects Auto Chess payloads by workshop id `1613886175`, and triggers post-game capture.
- `nettable_parser`: decodes BinaryKV (`VBKV`) blobs and walks Dota `[stringtables]` console blocks into CustomNetTable rows.
- `nettable_tail`: polls `console.log` for stable dump blocks and feeds rows to the capture pipeline.
- `nettable_setup`: Dota/Steam environment discovery and mutation — locating the Dota dir and `console.log`, applying launch options, and installing the marked `autoexec.cfg` block (`AUTOEXEC_BLOCK`) and GSI cfg.
- `nettable_service`: fires dump hotkeys, tracks live state, orchestrates the finalization flow, persists dumps, and handles queen-ladder uploads.
- `nettable_live`: per-player live state derived from nettable rows, as consumed by the standings board.
- `match_builder`: pure payload construction for match and timeline uploads.
- `dump_commands`: dump command identifiers, console command strings, focused key delivery, and Dota foreground detection.
- `local_cache`: local-first cache of processed match data.
- `queen_ladder`: Queen ladder row extraction.
- `unit_codes`: unit/item code mapping shared by the parser and payload builders.
- `ipc_events`: typed event/command structs for the JSON-lines protocol; `npm run generate:ipc-types` exports the matching TypeScript bindings.
- `steam_auth`: performs Steam OpenID login and stores the signed-in Steam identity in config.
- `supabase`: uploads processed match rows, match timelines, Queen ladder data, diagnostic logs, raw nettable dump blobs, and queued outbox payloads.
- `outbox`: stores local-first payloads under `outbox/` in the DAC data dir so uploads can be retried later. A payload is deleted only once Supabase accepts it; nothing else in the data dir is deleted on upload.
- `main`: exposes the Electron-compatible JSON-lines daemon plus CLI helpers.

## CLI commands

```bash
cargo run --manifest-path app/backend/Cargo.toml -- daemon
cargo run --manifest-path app/backend/Cargo.toml -- parse-log <path-to-console.log>
cargo run --manifest-path app/backend/Cargo.toml -- parse-log-full <path-to-console.log>
cargo run --manifest-path app/backend/Cargo.toml -- parse-live <path-to-console.log> [local-steam-id]
cargo run --manifest-path app/backend/Cargo.toml -- queue <payload.json>
cargo run --manifest-path app/backend/Cargo.toml -- outbox-list
cargo run --manifest-path app/backend/Cargo.toml -- outbox-flush
cargo run --manifest-path app/backend/Cargo.toml -- gsi-cfg
cargo run --manifest-path app/backend/Cargo.toml -- finalize-log [path-to-console.log]
cargo run --manifest-path app/backend/Cargo.toml -- finalize-dump <path-to-dump>
cargo run --manifest-path app/backend/Cargo.toml -- timeline-from-log <path-to-console.log> <match-id>
cargo run --manifest-path app/backend/Cargo.toml -- timeline-from-dump <path-to-dump> <match-id>
cargo test --manifest-path app/backend/Cargo.toml
```

That is all twelve subcommands `main.rs` dispatches. The last five are the
recovery paths, and are the ones to reach for during an incident:

| Subcommand | Purpose |
| --- | --- |
| `outbox-flush` | One-shot replay of queued payloads, reporting uploaded/failed counts. The daemon only replays the outbox at startup, so this is the recovery path when an upload failed and the daemon has been running ever since. |
| `finalize-log [console.log]` | Re-upload a match from a `console.log` that holds its rows but whose live upload never landed. Tries the end-board path first, then the same fallback writer the daemon uses for left-early matches. Auto-detects the log when the path is omitted. |
| `finalize-dump <dump>` | Same recovery, from a saved nettable dump. |
| `timeline-from-log <console.log> <match_id>` | Rebuild and upload just the timeline for a match that already exists. |
| `timeline-from-dump <dump> <match_id>` | Same, from a saved nettable dump. |

## App build and verification

```bash
pnpm --dir app run build:backend        # cargo release build + copy for electron-builder
npm run verify:desktop:backend          # start daemon and wait for status
npm run dev:desktop                     # backend setup/check + Vite + Electron
```

`pnpm --dir app run build:backend` writes the packaged backend binary to `app/backend/dist/headless/`.

## Runtime behavior

- The daemon starts GSI and nettable capture automatically when Electron launches it.
- Dota launch/config setup is exposed through the `nettable_apply_launch_options` IPC command and writes a marked DAC Tracker block to Dota `autoexec.cfg`.
- Processed match data uploads to `matches`, `match_players`, and `match_timelines`; Queen ladder rows update user/rank-related Supabase data.
- Diagnostic uploads still go to the private Supabase Storage bucket `diagnostic-logs`. Raw nettable dump logs are local-only, under `nettable_dumps/` in the DAC data dir; remote raw dump uploads were removed on 2026-07-02.
- Replay recording is still not available in the Rust-only nettable build; `toggle_recording` returns a structured error.
- `do_update` currently acknowledges an update-apply request for the Electron layer but does not perform installer replacement inside the backend.
