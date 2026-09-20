# Parser fixtures

These fixtures exercise binary nettable decoding, repeated tracking events,
colon-containing ASCII previews, and live-board reconciliation.

Captured player identifiers have been replaced consistently in JSON and VBKV
payloads with synthetic values `76561198000000101` through
`76561198000000108`. Other generated scenarios use synthetic Alpha/Beta players.
These values are test inputs, not player profiles: never look them up or upload
these fixtures to a live service. A valid-looking identifier does not establish
that a corresponding account is fictitious or belongs to the project.

When modifying captures, update the encoded bytes and expected decoded output
together, and run `cargo test --test nettable_golden` from `app/backend/`.
