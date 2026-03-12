# DAC Tools — TODO

## Parsing Accuracy
- [ ] Fix web frontend unit icons not displaying
- [ ] Investigate unit matching: some rows showing only 1 unit (e.g. single Faceless Void) — likely row matching or slot detection issue
- [ ] Fix missing level OCR on some rows

## Post-Parse Confirmation UI
- [ ] Before pushing parsed rows to DB, show a confirmation screen in the web frontend
  - Display parsed data visually: placement, level, units (with icons), synergies, relic, W-L, rank
  - Let the user review and correct any field before confirming
  - "Confirm" pushes to DB, "Edit" lets them fix mistakes
  - Could also be useful for historical re-imports (batch screenshot processing)
