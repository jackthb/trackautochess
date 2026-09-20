# Database access hardening — 20 September 2026

Status: **applied to the linked database on 20 September 2026**, after explicit user approval. Migration `20260920100154` is recorded in `supabase_migrations.schema_migrations`. The companion web identity fix remains local and is not deployed.

The linked project `ismxtcfkuwpvfyuojnaa` was inspected read-only. It has broad anonymous/authenticated writes on `public.users`, including unnecessary TRUNCATE privileges. Unlike the old migrations, the live project currently has no storage buckets or storage-object policies. Do not describe historical diagnostic exposure as confirmed live exposure.

## Changes

Migration `20260920100154_harden_user_profiles_and_diagnostics.sql`:

- Anonymous users retain profile reads but lose all profile writes and administrative table privileges.
- Authenticated writes require a confirmed server-created `SteamID@steam.local` account. The helper reads `auth.users` for the authenticated UUID; editable user metadata is never used for ownership.
- Client grants are limited to Steam ID, display name, and existing capture/ladder/Drodo fields. Avatars, custom URLs, stream links, creation dates, profile-refresh dates and sign-in timestamps stay server-owned. Column grants are explicitly revoked before the allowlist is granted.
- A trigger prevents changing an existing row's Steam ID. A user's name updates remain supported; other players' names in existing ladder upload payloads are ignored, preserving their current name while accepting the shared capture data. New roster-only records have no name until a trusted refresh fills it.
- Service-role profile refresh and Steam callback upserts continue to work.
- Community build draft visibility uses verified ownership, preserving public approved builds and each author's drafts.
- Existing diagnostic buckets become private, and only the verified Steam owner's folder can be inserted, read or updated. No bucket is created and no additional diagnostic collection is enabled. Storage upsert retains the required INSERT, SELECT and UPDATE policies.

`web/lib/sessionUser.ts` uses the same confirmed synthetic-email identity after `auth.getUser()` validates the token. This prevents editable `user_metadata.steam_id` impersonation in service-role-backed API handlers. Existing confirmed Steam accounts work without refreshing their JWTs. The Steam callback already creates/updates these confirmed synthetic accounts, so no metadata backfill is needed.

The trust boundary remains intentional: authenticated desktop clients can report shared game/ladder telemetry for other players. This patch does not certify the accuracy of client-reported rankings or implement a server-verified match ingestion protocol. Do not describe this as making all player data owner-only or as completing a whole-database security audit.

## Validation

An isolated PGlite PostgreSQL instance models the inspected users schema, RLS roles, legacy policies, column grants, auth identities and storage path helper. It includes the existing queen-rank trigger and community-build schema. It does not run the complete Supabase/PostgREST/Storage service stack.

Install the test-only engine outside the project dependency tree:

```powershell
rtk proxy npm.cmd --cache .local/npm-cache install --prefix .local/db-security-test --ignore-scripts --no-audit --no-fund --save-exact @electric-sql/pglite@0.5.8
rtk proxy node scripts/test-profile-access.mjs
rtk proxy node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/lib/register-ts.mjs scripts/test-verified-steam-identity.mjs
```

Both local suites pass. SQL regressions cover anonymous read/write boundaries, protected-column updates/upserts, identity reassignment, own name updates, cross-player ladder upsert compatibility, roster insertion, spoofed metadata, draft isolation, unverified account denial, per-owner diagnostic reads/writes/moves, and service-role profile refresh. The same SQL regressions also passed against the linked database both before application (migration plus tests in a rolled-back transaction) and after application (tests in a rolled-back transaction). No test fixtures were retained. This verifies database behavior, not a full end-to-end Steam sign-in or desktop upload through the HTTP APIs.

Full web type-check and the web identity regression suite pass in an isolated checkout based on current main (`73de91a541a07d8b901bfc4269ab8cdb3fa387b1`) with dependencies installed from the frozen lockfile. The earlier missing-dependency failure belonged to the old checkout. Deployment build/status must be verified through Vercel.

## Linked database rollout

Automatic approval review initially rejected the live test. The user subsequently explicitly approved proceeding, clarifying that this is not anyone's production deployment. The approved rollout then completed successfully:

1. Rechecked live policies and confirmed this migration was not already recorded.
2. Ran the migration and `supabase/tests/profile_access.sql` together inside BEGIN/ROLLBACK with a five-second lock timeout and sixty-second statement timeout; all assertions passed.
3. Applied only this migration and recorded its version and exact SQL atomically in one transaction. Requested a PostgREST schema-cache reload. No unrelated migrations were pushed.
4. Ran the SQL regression suite again against the applied policies and rolled back all test records.
5. Re-ran the Supabase security advisor at ERROR level: no issues found. This does not mean warning-level findings or every possible application vulnerability are resolved.

The web identity fix is prepared on current main for deployment through the existing GitHub-to-Vercel integration. The database changes do not substitute for that application-layer identity fix; check the deployed commit and its Vercel build status when verifying release completion.

The pre-rollout advisor also reported mutable function search paths, pg_trgm in public, privileged RPC grants and disabled leaked-password protection. Those warning-level findings are outside this focused patch and remain to be triaged. The editable-metadata error on community-build draft visibility is resolved by the applied migration.
