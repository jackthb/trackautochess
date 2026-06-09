-- Superseded migration kept only to satisfy Supabase migration history.
-- This version was briefly pushed as a table-insert restore, but raw nettable
-- dumps are logging/debug blobs and must not be stored in Postgres.
-- See 20260609004500_drop_legacy_nettable_dump_table.sql for the enforced
-- end state: legacy dac_nettable_dumps is dropped, and Rust uploads dumps to
-- Supabase Storage diagnostic-logs instead.

BEGIN;

-- Intentionally no-op.

COMMIT;
