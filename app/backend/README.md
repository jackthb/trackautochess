# Rust desktop services backend

This crate is the Rust-only local services backend used by the Electron app in
development and packaged builds.

## Migrated service surface

- `config`: creates/loads `~/.dac/config.json` with the desktop defaults and
  supports `set_config` updates over IPC.
- `gsi`: starts a local HTTP listener on `127.0.0.1:4001`, detects Auto Chess
  payloads by workshop id `1613886175`, and emits the same post-game transition
  semantics as `gsi.py`.
- `nettable_parser`: decodes BinaryKV (`VBKV`) blobs and walks Dota
  `[stringtables]` console blocks into CustomNetTable rows.
- `nettable_tail`: polls `console.log` for changes and reparses rows for the
  capture pipeline.
- `main`: exposes an Electron-compatible JSON-lines daemon with `status`,
  `set_config`, `parse_log`, `tail_log_once`, `queue_payload`, and `quit`
  commands, plus explicit error responses for unavailable Rust-only features.

## Build and run

```bash
pnpm --dir app run build:backend              # cargo release build + copy for electron-builder
node scripts/verify-desktop-backend.mjs       # start daemon and wait for status
cargo run --manifest-path app/backend/Cargo.toml -- daemon
cargo run --manifest-path app/backend/Cargo.toml -- parse-log ~/.steam/.../console.log
cargo run --manifest-path app/backend/Cargo.toml -- gsi-cfg
```

The daemon keeps stdout reserved for JSON protocol messages. Diagnostics should
be written to stderr when future services add logging.

## Unavailable Rust-only features

These commands intentionally return structured errors in Rust today instead of
silently pretending to work: replay recording and diagnostic log upload. Steam
OAuth login, launch-option setup, nettable capture, Supabase raw/end-board
upload, Queen ladder upload, and auto-update apply are handled by the Rust app
path.
