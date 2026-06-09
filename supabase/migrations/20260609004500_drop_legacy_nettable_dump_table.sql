-- Raw nettable dumps are diagnostic blob logs, not relational product data.
-- The Rust backend uploads them to Supabase Storage (`diagnostic-logs`) and
-- local disk for debugging/reprocessing. Do not keep or restore the old
-- Postgres landing table.

BEGIN;

DROP POLICY IF EXISTS anon_select ON dac_nettable_dumps;
DROP POLICY IF EXISTS anon_insert ON dac_nettable_dumps;
DROP POLICY IF EXISTS dac_nettable_dumps_select ON dac_nettable_dumps;
DROP POLICY IF EXISTS dac_nettable_dumps_insert ON dac_nettable_dumps;

DROP TABLE IF EXISTS dac_nettable_dumps;

COMMIT;
