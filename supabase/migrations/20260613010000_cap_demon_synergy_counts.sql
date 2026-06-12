-- Demon has a single active tier. Raw nettable `buff` values can report
-- several Demon units (`Demon:6`, `demon:7`), but the UI should never display
-- multi-tier Demon counts. Normalize stored match rows to the display count.

BEGIN;

UPDATE match_players
SET synergies = regexp_replace(
    synergies,
    '(^|\|)([Dd]emon):([2-9]|[1-9][0-9]+)',
    '\1\2:1',
    'g'
)
WHERE synergies ~ '(^|\|)([Dd]emon):([2-9]|[1-9][0-9]+)';

COMMIT;
