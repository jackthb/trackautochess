-- Restore raw nettable dump ingestion for Rust parity/debugging.
-- Reads stay private; the desktop app only needs anonymous INSERT through the
-- publishable Supabase key.

BEGIN;

ALTER TABLE dac_nettable_dumps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_insert ON dac_nettable_dumps;
DROP POLICY IF EXISTS dac_nettable_dumps_insert ON dac_nettable_dumps;

CREATE POLICY anon_insert ON dac_nettable_dumps
    FOR INSERT TO anon
    WITH CHECK (true);

COMMENT ON TABLE dac_nettable_dumps IS
    'Raw Dota Auto Chess CustomNetTable dumps uploaded by the desktop app for debug/reprocessing. Public anon may insert; reads remain restricted.';

COMMIT;
