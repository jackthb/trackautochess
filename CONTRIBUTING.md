# Contributing

Start with the [README](README.md) and [developer guide](docs/README.md). Keep changes focused and describe the user-visible problem, solution and validation in your pull request.

## Checks

Run the checks relevant to your changes from the repository root:

```sh
pnpm --dir web exec tsc --noEmit
pnpm --dir web run build
cargo test --manifest-path app/backend/Cargo.toml
pnpm run test:synergies
pnpm run test:patch-notes
```

The web build generates runtime data from `content/`. Desktop capture changes also need a Windows test with Dota running; a web build cannot validate live capture.

## Profile and authentication tests

The database policy regression suite runs against a disposable local PostgreSQL-compatible engine. Install its isolated dependency once, then run these commands from the repository root:

```sh
npm install --prefix .local/db-security-test --ignore-scripts --no-audit --no-fund --save-exact @electric-sql/pglite@0.5.8
node scripts/test-profile-access.mjs
node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/lib/register-ts.mjs scripts/test-verified-steam-identity.mjs
```

The `.local/` dependency directory is ignored by Git. These tests require no live service credentials; the database suite creates its own test schema and rolls back its regression transaction.

## Test data and credentials

Use synthetic player identities in fixtures. Do not submit personal game captures, authentication tokens, environment files, diagnostic logs or private keys. Preserve binary format coverage when anonymizing parser fixtures and verify the expected decoded output still matches.

Use your own service credentials for database development. Do not run migrations, upload test matches or execute production automation against the official service as part of a contribution. `DAC_LOCAL_ONLY=1` disables desktop cloud sync for local work.

## Licensing

Contribute only material you have permission to share. Original code contributions are made under the project's MIT licence. Identify third-party sources and their licences separately; do not assume the project licence covers game artwork or extracted content.
