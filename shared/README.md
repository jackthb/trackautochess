# Shared application UI and data

`@dac/shared` is the common source package for the desktop renderer and web app.
Extend it for existing shared concepts rather than introducing a second UI
package. Each public module has an explicit subpath in `package.json`.

## Ownership

- `tokens.css` owns the common colour, typography, spacing, radius and motion
  vocabulary. Use its existing tokens before introducing new values.
- `components.css` owns styles for shared UI. Both applications import this
  stylesheet and the tokens once at their entry point.
- React components own presentation and interaction. Pass data, icon URL
  resolvers, callbacks and optional content through props.
- Electron IPC, native window controls, authentication, data fetching and
  Next.js navigation belong in their respective application adapters, not here.
- Domain helpers and types may be shared independently of React components.

Common does not mean identical screens. Desktop setup/capture and web browsing
remain separate experiences. Share equivalent presentation when it has actual
consumers; do not move a platform-specific screen merely for uniformity.

## Consumption

Import explicit subpaths such as `@dac/shared/Button` or
`@dac/shared/game-structure`. Next transpiles the package; Vite resolves its
source and deduplicates React. Hook-based components must be consumed within a
Next client boundary. Keep browser DOM access in effects or user interactions,
so server rendering does not require a browser.

`Button` renders a native button by default, with `type="button"` to avoid
accidental form submissions. Use `type="submit"` for submission or `as="a"`
with anchor attributes for navigation. Keep routing and external-link policy in
the consuming app.

## Verification

Check TypeScript in both applications after changing shared props or exports.
Build both consumers after changing styles or assets. For visual or interaction
changes, review representative states in both apps, including keyboard focus,
loading/disabled controls and narrow web layouts. A successful build alone does
not establish visual consistency or accessibility.

The existing web-specific Radix/Tailwind controls and desktop-specific controls
have not yet been consolidated. Fonts, accessible tooltips and representative
screen review remain part of the beta design work; this package is the
foundation, not a claim that the design refresh is complete.
