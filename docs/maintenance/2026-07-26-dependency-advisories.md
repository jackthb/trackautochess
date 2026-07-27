# Dependency security advisories — 2026-07-26

Audit-only report. No dependency versions were changed in this PR.

## How this was produced

```bash
pnpm audit --json                                        # npm workspaces (app, web, shared)
cargo audit --file app/backend/Cargo.lock                # Rust backend
```

## Summary

| Ecosystem | Result |
| --- | --- |
| npm (pnpm workspace) | **70 advisories** across 969 resolved dependencies — 1 critical, 32 high, 29 moderate, 11 low |
| Rust (`app/backend`) | **Clean** — 0 vulnerabilities, 0 warnings across 115 crates (RustSec DB, 1169 advisories) |

Two direct dependencies account for most of the exposure:

- **`web` → `next` 16.1.6** — 28 advisories (8 of them affecting the deployed
  site's request path: middleware/proxy bypass, SSRF, cache poisoning, CSP-nonce
  XSS). A single bump to **>= 16.2.11** clears all 28.
- **`app` → `electron` 33.4.11** — 17 advisories including a high-severity
  use-after-free. Clearing all of them needs **>= 39.8.5**, i.e. a major-version
  jump from `33.4.11`. (This report originally noted a second pin in
  `app/electron-builder.json`; that `electronVersion` key was removed on
  2026-07-27 and `app/package.json` now carries an exact pin, so it is the only
  place to change.)

The remaining advisories are transitive. By blast radius:

- **Ships to users / runs in production:** `postcss`, `sharp` (via `next`);
  `dompurify` (via `posthog-js`).
- **Build-time only (`electron-builder` dev dependency chain):** `tar` (incl. the
  one critical), `form-data`, `undici`, `brace-expansion`, `js-yaml`, `fast-uri`.
  Lower practical risk — they process build inputs, not user input — but the
  release workflow does run them on tagged builds.
- **Dev server only:** `esbuild` (Windows-only dev-server file read, via `vite`).

## Suggested order of work

1. `next` → `>= 16.2.11` (clears 28 advisories, incl. `postcss`/`sharp` if their pins move with it).
2. `electron` → `>= 39.8.5` in `app/package.json` (major bump; needs a smoke test of the desktop app).
3. `electron-builder` → latest, to pull fixed `tar`/`form-data`/`brace-expansion`/`js-yaml`/`fast-uri`/`undici`.
4. `posthog-js` → a release carrying `dompurify >= 3.4.12`.
5. `vite`/`esbuild` refresh — lowest priority.

## Full advisory list

Grouped by package, most severe first.

### `tar` 7.5.16 — 5 advisories  (fix: >= 7.5.21)

Dependency path(s): `app>electron-builder>app-builder-lib>tar`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| critical | [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) | CVE-2026-59873 | node-tar: Decompression/parse DoS via unlimited input | >=7.5.19 |
| high | [GHSA-8x88-c5mf-7j5w](https://github.com/advisories/GHSA-8x88-c5mf-7j5w) | CVE-2026-59874 | node-tar: Negative tar entry size causes infinite loop in archive replace | >=7.5.18 |
| moderate | [GHSA-w8wr-v893-vjvp](https://github.com/advisories/GHSA-w8wr-v893-vjvp) | CVE-2026-59871 | node-tar: Process crash via PAX numeric path type confusion | >=7.5.18 |
| moderate | [GHSA-gvwx-54wh-qm9j](https://github.com/advisories/GHSA-gvwx-54wh-qm9j) | CVE-2026-59875 | node-tar: Uncaught Exception DoS via NUL byte in PAX path/linkpath records | >=7.5.17 |
| moderate | [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m) | — | node-tar: Uncontrolled recursion in mapHas/filesFilter allows uncatchable stack-overflow DoS via crafted long-path tar with member selection | >=7.5.21 |

### `next` 16.1.6 — 28 advisories  (fix: >= 16.2.11)

Dependency path(s): `web>next`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3) | — | Next.js has a Denial of Service with Server Components | >=16.2.3 |
| high | [GHSA-8h8q-6873-q5fj](https://github.com/advisories/GHSA-8h8q-6873-q5fj) | — | Next.js Vulnerable to Denial of Service with Server Components | >=16.2.5 |
| high | [GHSA-26hh-7cqf-hhc6](https://github.com/advisories/GHSA-26hh-7cqf-hhc6) | CVE-2026-45109 | Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes - Incomplete Fix Follow-Up | >=16.2.6 |
| high | [GHSA-mg66-mrh9-m8jx](https://github.com/advisories/GHSA-mg66-mrh9-m8jx) | CVE-2026-44579 | Next.js vulnerable to Denial of Service via connection exhaustion in applications using Cache Components | >=16.2.5 |
| high | [GHSA-c4j6-fc7j-m34r](https://github.com/advisories/GHSA-c4j6-fc7j-m34r) | CVE-2026-44578 | Next.js vulnerable to server-side request forgery in applications using WebSocket upgrades | >=16.2.5 |
| high | [GHSA-492v-c6pp-mqqv](https://github.com/advisories/GHSA-492v-c6pp-mqqv) | CVE-2026-44574 | Next.js has a Middleware / Proxy bypass through dynamic route parameter injection | >=16.2.5 |
| high | [GHSA-267c-6grr-h53f](https://github.com/advisories/GHSA-267c-6grr-h53f) | CVE-2026-44575 | Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes | >=16.2.5 |
| high | [GHSA-36qx-fr4f-26g5](https://github.com/advisories/GHSA-36qx-fr4f-26g5) | CVE-2026-44573 | Next.js has a Middleware / Proxy bypass in Pages Router applications using i18n | >=16.2.5 |
| high | [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) | CVE-2026-64642 | Next.js: Middleware / Proxy bypass in App Router applications using Turbopack and single locale | >=16.2.11 |
| high | [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) | CVE-2026-64641 | Next.js: Denial of Service in App Router using Server Actions | >=16.2.11 |
| high | [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x) | CVE-2026-64649 | Next.js: Server-Side Request Forgery in Server Actions on custom servers | >=16.2.11 |
| high | [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) | CVE-2026-64645 | Next.js: Server-Side Request Forgery in rewrites via attacker-controlled destination hostname | >=16.2.11 |
| moderate | [GHSA-ggv3-7p47-pfv8](https://github.com/advisories/GHSA-ggv3-7p47-pfv8) | CVE-2026-29057 | Next.js: HTTP request smuggling in rewrites | >=16.1.7 |
| moderate | [GHSA-3x4c-7xq6-9pq8](https://github.com/advisories/GHSA-3x4c-7xq6-9pq8) | CVE-2026-27980 | Next.js: Unbounded next/image disk cache growth can exhaust storage | >=16.1.7 |
| moderate | [GHSA-h27x-g6w4-24gq](https://github.com/advisories/GHSA-h27x-g6w4-24gq) | CVE-2026-27979 | Next.js: Unbounded postponed resume buffering can lead to DoS | >=16.1.7 |
| moderate | [GHSA-mq59-m269-xvcx](https://github.com/advisories/GHSA-mq59-m269-xvcx) | CVE-2026-27978 | Next.js: null origin can bypass Server Actions CSRF checks | >=16.1.7 |
| moderate | [GHSA-ffhc-5mcf-pf4q](https://github.com/advisories/GHSA-ffhc-5mcf-pf4q) | CVE-2026-44581 | Next.js vulnerable to cross-site scripting in App Router applications using CSP nonces | >=16.2.5 |
| moderate | [GHSA-gx5p-jg67-6x7h](https://github.com/advisories/GHSA-gx5p-jg67-6x7h) | CVE-2026-44580 | Next.js has cross-site scripting in beforeInteractive scripts with untrusted input | >=16.2.5 |
| moderate | [GHSA-h64f-5h5j-jqjh](https://github.com/advisories/GHSA-h64f-5h5j-jqjh) | CVE-2026-44577 | Next.js has a Denial of Service in the Image Optimization API | >=16.2.5 |
| moderate | [GHSA-wfc6-r584-vfw7](https://github.com/advisories/GHSA-wfc6-r584-vfw7) | CVE-2026-44576 | Next.js vulnerable to cache poisoning in React Server Component responses | >=16.2.5 |
| moderate | [GHSA-68g3-v927-f742](https://github.com/advisories/GHSA-68g3-v927-f742) | CVE-2026-64648 | Next.js: Cache confusion of response bodies for requests with bodies | >=16.2.11 |
| moderate | [GHSA-4633-3j49-mh5q](https://github.com/advisories/GHSA-4633-3j49-mh5q) | CVE-2026-64647 | Next.js: Cache confusion of response bodies for requests with bodies containing invalid UTF-8 byte sequences | >=16.2.11 |
| moderate | [GHSA-4c39-4ccg-62r3](https://github.com/advisories/GHSA-4c39-4ccg-62r3) | CVE-2026-64646 | Next.js: Unbounded Server Action payload in Edge runtime | >=16.2.11 |
| moderate | [GHSA-q8wf-6r8g-63ch](https://github.com/advisories/GHSA-q8wf-6r8g-63ch) | CVE-2026-64644 | Next.js: Denial of Service in the Image Optimization API using SVGs | >=16.2.11 |
| moderate | [GHSA-955p-x3mx-jcvp](https://github.com/advisories/GHSA-955p-x3mx-jcvp) | CVE-2026-64643 | Next.js: Unauthenticated disclosure of internal Server Function endpoints | >=16.2.11 |
| low | [GHSA-jcc7-9wpm-mj36](https://github.com/advisories/GHSA-jcc7-9wpm-mj36) | CVE-2026-27977 | Next.js: null origin can bypass dev HMR websocket CSRF checks | >=16.1.7 |
| low | [GHSA-3g8h-86w9-wvmq](https://github.com/advisories/GHSA-3g8h-86w9-wvmq) | CVE-2026-44572 | Next.js's Middleware / Proxy redirects can be cache-poisoned | >=16.2.5 |
| low | [GHSA-vfv6-92ff-j949](https://github.com/advisories/GHSA-vfv6-92ff-j949) | CVE-2026-44582 | Next.js vulnerable to cache poisoning via collisions in React Server Component cache-busting | >=16.2.5 |

### `electron` 33.4.11 — 18 advisories  (fix: >= 39.8.5)

Dependency path(s): `app>electron`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-532v-xpq5-8h95](https://github.com/advisories/GHSA-532v-xpq5-8h95) | CVE-2026-34774 | Electron: Use-after-free in offscreen child window paint callback | >=39.8.1 |
| high | [GHSA-8337-3p73-46f4](https://github.com/advisories/GHSA-8337-3p73-46f4) | CVE-2026-34771 | Electron: Use-after-free in WebContents fullscreen, pointer-lock, and keyboard-lock permission callbacks | >=38.8.6 |
| high | [GHSA-jjp3-mq3x-295m](https://github.com/advisories/GHSA-jjp3-mq3x-295m) | CVE-2026-34770 | Electron: Use-after-free in PowerMonitor on Windows and macOS | >=38.8.6 |
| high | [GHSA-9wfr-w7mm-pc7f](https://github.com/advisories/GHSA-9wfr-w7mm-pc7f) | CVE-2026-34769 | Electron: Renderer command-line switch injection via undocumented commandLineSwitches webPreference | >=38.8.6 |
| moderate | [GHSA-vmqv-hx8q-j7mg](https://github.com/advisories/GHSA-vmqv-hx8q-j7mg) | CVE-2025-55305 | Electron has ASAR Integrity Bypass via resource modification | >=35.7.5 |
| moderate | [GHSA-5rqw-r77c-jp79](https://github.com/advisories/GHSA-5rqw-r77c-jp79) | CVE-2026-34779 | Electron: AppleScript injection in app.moveToApplicationsFolder on macOS | >=38.8.6 |
| moderate | [GHSA-xj5x-m3f3-5x3h](https://github.com/advisories/GHSA-xj5x-m3f3-5x3h) | CVE-2026-34778 | Electron: Service worker can spoof executeJavaScript IPC replies | >=38.8.6 |
| moderate | [GHSA-r5p7-gp4j-qhrx](https://github.com/advisories/GHSA-r5p7-gp4j-qhrx) | CVE-2026-34777 | Electron: Incorrect origin passed to permission request handler for iframe requests | >=38.8.6 |
| moderate | [GHSA-3c8v-cfp5-9885](https://github.com/advisories/GHSA-3c8v-cfp5-9885) | CVE-2026-34776 | Electron: Out-of-bounds read in second-instance IPC on macOS and Linux | >=38.8.6 |
| moderate | [GHSA-xwr5-m59h-vwqr](https://github.com/advisories/GHSA-xwr5-m59h-vwqr) | CVE-2026-34775 | Electron: nodeIntegrationInWorker not correctly scoped in shared renderer processes | >=38.8.6 |
| moderate | [GHSA-mwmh-mq4g-g6gr](https://github.com/advisories/GHSA-mwmh-mq4g-g6gr) | CVE-2026-34773 | Electron: Registry key path injection in app.setAsDefaultProtocolClient on Windows | >=38.8.6 |
| moderate | [GHSA-9w97-2464-8783](https://github.com/advisories/GHSA-9w97-2464-8783) | CVE-2026-34772 | Electron: Use-after-free in download save dialog callback | >=38.8.6 |
| moderate | [GHSA-4p4r-m79c-wq3v](https://github.com/advisories/GHSA-4p4r-m79c-wq3v) | CVE-2026-34767 | Electron: HTTP Response Header Injection in custom protocol handlers and webRequest | >=38.8.6 |
| moderate | [GHSA-f3pv-wv63-48x8](https://github.com/advisories/GHSA-f3pv-wv63-48x8) | CVE-2026-34765 | Electron: Named window.open targets not scoped to the opener's browsing context | >=39.8.5 |
| low | [GHSA-jfqx-fxh3-c62j](https://github.com/advisories/GHSA-jfqx-fxh3-c62j) | CVE-2026-34768 | Electron: Unquoted executable path in app.setLoginItemSettings on Windows | >=38.8.6 |
| low | [GHSA-9899-m83m-qhpj](https://github.com/advisories/GHSA-9899-m83m-qhpj) | CVE-2026-34766 | Electron: USB device selection not validated against filtered device list | >=38.8.6 |
| low | [GHSA-8x5q-pvf5-64mp](https://github.com/advisories/GHSA-8x5q-pvf5-64mp) | CVE-2026-34764 | Electron: Use-after-free in offscreen shared texture release() callback | >=39.8.5 |
| low | [GHSA-f37v-82c4-4x64](https://github.com/advisories/GHSA-f37v-82c4-4x64) | CVE-2026-34781 | Electron: Crash in clipboard.readImage() on malformed clipboard image data | >=39.8.5 |

### `undici` 6.26.0 — 4 advisories  (fix: >= 6.27.0)

Dependency path(s): `app>electron-builder>app-builder-lib>@electron/rebuild>node-gyp>undici`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | CVE-2026-12151 | undici WebSocket client vulnerable to denial of service via fragment count bypass | >=6.27.0 |
| moderate | [GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv) | CVE-2026-9679 | undici vulnerable to HTTP header injection via Set-Cookie percent-decoding | >=6.27.0 |
| low | [GHSA-35p6-xmwp-9g52](https://github.com/advisories/GHSA-35p6-xmwp-9g52) | CVE-2026-6733 | undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse | >=6.27.0 |
| low | [GHSA-g8m3-5g58-fq7m](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) | CVE-2026-11525 | undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching | >=6.27.0 |

### `brace-expansion` 2.1.1 / 1.1.15 / 5.0.6 / 1.1.15, 2.1.1, 5.0.6 — 4 advisories  (fix: >= 5.0.8)

Dependency path(s): `app>electron-builder>app-builder-lib>@electron/universal>minimatch>brace-expansion`, `app>electron-builder>app-builder-lib>@electron/asar>minimatch>brace-expansion`, `app>electron-builder>app-builder-lib>minimatch>brace-expansion`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | CVE-2026-13149 | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups | >=2.1.2 |
| high | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | CVE-2026-13149 | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups | >=1.1.16 |
| high | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | CVE-2026-13149 | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups | >=5.0.7 |
| high | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | CVE-2026-14257 | brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash | >=5.0.8 |

### `postcss` 8.4.31 / 8.4.31, 8.5.15 — 3 advisories  (fix: >= 8.5.18)

Dependency path(s): `web>next>postcss`, `app>vite>postcss`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | CVE-2026-45623 | PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments | >=8.5.12 |
| high | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | — | PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure | >=8.5.18 |
| moderate | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | CVE-2026-41305 | PostCSS has XSS via Unescaped </style> in its CSS Stringify Output | >=8.5.10 |

### `fast-uri` 3.1.2 — 2 advisories  (fix: >= 3.1.4)

Dependency path(s): `app>electron-builder>app-builder-lib>ajv>fast-uri`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) | CVE-2026-16221 | fast-uri vulnerable to host confusion via literal backslash authority delimiter | >=3.1.4 |
| high | [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) | CVE-2026-13676 | fast-uri vulnerable to host confusion via failed IDN canonicalization | >=3.1.3 |

### `form-data` 4.0.5 — 1 advisory  (fix: >= 4.0.6)

Dependency path(s): `app>electron-builder>app-builder-lib>electron-publish>form-data`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) | CVE-2026-12143 | form-data: CRLF injection in form-data via unescaped multipart field names and filenames | >=4.0.6 |

### `js-yaml` 4.2.0 — 1 advisory  (fix: >= 4.3.0)

Dependency path(s): `app>electron-builder>app-builder-lib>js-yaml`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) | CVE-2026-59869 | js-yaml: YAML merge-key chains can force quadratic CPU consumption | >=4.3.0 |

### `sharp` 0.34.5 — 1 advisory  (fix: >= 0.35.0)

Dependency path(s): `web>next>sharp`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| high | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | — | sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 | >=0.35.0 |

### `dompurify` 3.4.9 — 2 advisories  (fix: >= 3.4.12)

Dependency path(s): `app>posthog-js>dompurify`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| moderate | [GHSA-cmwh-pvxp-8882](https://github.com/advisories/GHSA-cmwh-pvxp-8882) | CVE-2026-65898 | DOMPurify: Permanent `ALLOWED_ATTR` pollution via `setConfig()` bypassing the hook clone-guard (incomplete fix of the 3.4.7 hook-pollution patch) | >=3.4.11 |
| low | [GHSA-c2j3-45gr-mqc4](https://github.com/advisories/GHSA-c2j3-45gr-mqc4) | — | DOMPurify: `CUSTOM_ELEMENT_HANDLING` bypasses `afterSanitizeElements` for allowed custom elements. | >=3.4.12 |

### `esbuild` 0.28.0 — 1 advisory  (fix: >= 0.28.1)

Dependency path(s): `app>vite>esbuild`

| Severity | Advisory | CVE | Title | Patched |
| --- | --- | --- | --- | --- |
| low | [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) | — | esbuild allows arbitrary file read when running the development server on Windows | >=0.28.1 |

## Scope note

`ops/cronicle/scripts/` is not a pnpm workspace package and has no lockfile of
its own, so it is not covered by `pnpm audit`. It runs on the Pi against the
system Node runtime.
