# Dependency security advisories — 2026-08-09

Source: `pnpm audit` against the committed `pnpm-lock.yaml` (969 resolved
dependencies). **4 advisories: 3 high, 1 moderate.** All four are transitive —
no direct dependency in `package.json`, `app/package.json`, `web/package.json`,
or `shared/package.json` is itself flagged.

This file is a record of the audit only. No dependency, lockfile, or override
was changed in this branch.

> **2026-08-16 addendum:** re-ran this audit as part of the scheduled
> maintenance run. Same 4 advisories, same paths, same resolved versions,
> except [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
> (finding 3, `nanoid@3`) was revised on 2026-08-13: its patched floor moved
> from `>=3.3.17` to `>=3.3.18`. Finding 3 and the remediation block below are
> updated in place to `^3.3.18` so the suggested fix doesn't leave a still-
> vulnerable version installed. Findings 1, 2, and 4 are unchanged.

## Summary

| Package | Installed | Advisory | Severity | Patched in | Reached via |
| --- | --- | --- | --- | --- | --- |
| `js-yaml` | 4.3.0 | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | High | `>=4.3.1` | `app > electron-builder > app-builder-lib > js-yaml` |
| `nanoid` | 5.1.11 | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) (CVE-2026-67214) | High | `>=5.1.16` | `web > @keystatic/core > @toeverything/y-indexeddb > nanoid` |
| `nanoid` | 3.3.16 | [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) (CVE-2026-67213) | High | `>=3.3.18`\* | `app > vite > postcss > nanoid` |
| `dompurify` | 3.4.12 | [GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7) | Moderate | `>=3.4.13` | `app > posthog-js > dompurify` |

\* Originally recorded as `>=3.3.17`; the advisory was revised on 2026-08-13
to raise the floor to `3.3.18`. See the addendum above.

## Detail

### 1. `js-yaml` 4.3.0 — quadratic CPU consumption in `!!omap` resolution (High)

`resolveYamlOmap()` enforces key uniqueness with a linear `indexOf` scan inside
the per-element loop, making `yaml.load()` O(n²) in entry count. `!!omap` is in
the default schema, so a plain `yaml.load(untrusted)` is affected. Same weakness
as CVE-2026-59870 (fixed in the 5.x line in 5.2.1); the fix was never backported
to 3.x/4.x until 4.3.1.

Advisory published 2026-08-06.

**Note — this one is an already-stale override.** `pnpm-workspace.yaml` pins
`js-yaml: "^4.3.0"` under the "via app > electron-builder > app-builder-lib"
group. That floor was correct when written and is now below the patched
version. Bumping the existing entry to `^4.3.1` resolves it.

**Exploitability here is low.** The only consumer is `app-builder-lib`, a build-
time devDependency that parses `electron-builder.json` and its own generated
YAML — none of which is attacker-controlled. Nothing in the shipped app or the
web runtime loads YAML from an untrusted source. Treat this as hygiene, not an
incident.

### 2. `nanoid` 5.1.11 — non-secure generators loop indefinitely with negative size (High)

CVE-2026-67214. Published 2026-07-29. Passing a negative `size` to a non-secure
generator causes an unbounded loop.

Reached through Keystatic's IndexedDB adapter. There is **no override entry for
`nanoid` at all** in `pnpm-workspace.yaml` — this needs a new one.

### 3. `nanoid` 3.3.16 — custom generators loop indefinitely when size is zero (High)

CVE-2026-67213. Published 2026-07-29. Same shape as the above, on the 3.x line.

Reached through `vite > postcss`. Note that `postcss` itself is already
overridden to `^8.5.18` and resolves to 8.5.23 — the current postcss still
depends on `nanoid@3`, so bumping postcss does not clear this. It needs its own
`nanoid@3` entry.

Two nanoid majors are installed (3.3.16 and 5.1.11), so per the caret-bounding
convention already documented in `pnpm-workspace.yaml`, each major needs its own
key rather than a single open-ended range.

**Patched floor revised 2026-08-13.** The advisory's `patched_versions` moved
from `>=3.3.17` to `>=3.3.18` four days after this audit was first written —
pinning to `^3.3.17` as originally suggested would install a version the
advisory now considers vulnerable. Use `^3.3.18`. This is the same failure
mode `pnpm-workspace.yaml`'s own comment block warns about for the
`brace-expansion` overrides: a floor pinned from an advisory snapshot goes
stale silently, because `pnpm audit` stays quiet as long as the *resolved*
version is patched, and only complains again after the next lockfile refresh
drags the install back down to the floor.

### 4. `dompurify` 3.4.12 — IN_PLACE hook removal leaves a detached subtree executable (Moderate)

[GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7),
published 2026-08-07. Sanitization in `IN_PLACE` mode can leave a removed
subtree still executable, giving XSS.

**Also an already-stale override.** `pnpm-workspace.yaml` pins
`dompurify: "^3.4.12"` under "via posthog-js". Bumping to `^3.4.13` resolves it.

## Suggested remediation

All four are fixable by editing the existing `overrides` block in
`pnpm-workspace.yaml` — no direct-dependency upgrades are required. Following
the caret-bounded, per-major convention already documented in that file:

```yaml
  # via app > electron-builder > app-builder-lib
  js-yaml: "^4.3.1"          # was ^4.3.0 — GHSA-5p4m-2wfm-xmqj
  # via posthog-js
  dompurify: "^3.4.13"       # was ^3.4.12 — GHSA-55q2-fjhq-7xh7
  # nanoid: two majors installed, each needs its own patched floor.
  # 3.x via app > vite > postcss (CVE-2026-67213, fixed in 3.3.17);
  # 5.x via web > @keystatic/core > @toeverything/y-indexeddb (CVE-2026-67214,
  # fixed in 5.1.16).
  nanoid@3: "^3.3.18"        # patched floor revised 2026-08-13 (was ^3.3.17)
  nanoid@5: "^5.1.16"
```

Then re-run `pnpm install` to refresh `pnpm-lock.yaml` and `pnpm audit` to
confirm a clean result.

## Not covered by this audit

- **Rust dependencies (`app/backend/`) were not audited.** `cargo-audit` is not
  installed in this environment, so the RustSec advisory database was not
  checked against `Cargo.lock`. The crate has 7 direct dependencies (`chrono`,
  `serde`, `serde_json`, `sha2`, `ts-rs`, `ureq`, `windows-sys`). Running
  `cargo audit` locally or adding it to CI would close this gap.
- **Override redundancy was not assessed.** `pnpm-workspace.yaml` asks that
  entries be dropped once the parent ships a fix. Determining which of the
  current entries are now unnecessary requires resolving each parent's own
  requested range with the overrides removed, which was out of scope here.
