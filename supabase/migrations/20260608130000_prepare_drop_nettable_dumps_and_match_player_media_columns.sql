-- Rust-only capture no longer writes raw nettable rows to Postgres. Final match
-- rows go to `matches` / `match_players`, timelines go to `match_timelines`,
-- and audit/debug logs go straight to the private `diagnostic-logs` Supabase
-- Storage bucket. Keep the legacy table in place for a short validation window,
-- but mark it deprecated and remove anonymous access so new clients cannot keep
-- depending on it. A later migration can drop the table after production has no
-- reads for it.

BEGIN;

DROP POLICY IF EXISTS anon_select ON dac_nettable_dumps;
DROP POLICY IF EXISTS anon_insert ON dac_nettable_dumps;
DROP POLICY IF EXISTS dac_nettable_dumps_select ON dac_nettable_dumps;
DROP POLICY IF EXISTS dac_nettable_dumps_insert ON dac_nettable_dumps;

COMMENT ON TABLE dac_nettable_dumps IS
    'DEPRECATED 2026-06-08: Rust backend no longer writes raw nettable dumps to Postgres; audit logs upload to Supabase Storage diagnostic-logs. Safe to drop after retention/read audit.';

COMMIT;
