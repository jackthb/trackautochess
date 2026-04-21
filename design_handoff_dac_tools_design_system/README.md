# Handoff: DAC Tools Design System

## Overview
This package contains the DAC Tools brand & component design system — a dark, cool-slate UI vocabulary with a Cinzel display face, JetBrains Mono for all UI/body, tracked-out uppercase hierarchy, and softly-rounded corners. Use it to bring the live DAC Tools codebase (jackthb/dac-tools) in line with the refreshed tokens.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. Your task is to **recreate these designs in the DAC Tools codebase's existing environment** (React + its current styling system) using the patterns already established there. The HTML specimens are the source of truth for colors, type, radii, spacing, and component anatomy; how you express those in code should follow the repo's conventions (CSS modules, Tailwind, styled-components — whatever is already in use).

If you're starting fresh, mirror the tokens in `shared/tokens.css` and import `colors_and_type.css` as the root stylesheet.

## Fidelity
**High-fidelity.** Every specimen uses final colors, typography, spacing, and radii. Pixel-match them.

## Design Tokens

All tokens live in `colors_and_type.css`. The authoritative values:

### Backgrounds (dark, cool charcoal-navy)
| Token | Hex | Use |
|---|---|---|
| `--bg-deep` | `#1E2130` | App shell, page background |
| `--bg-surface` | `#262A3A` | Cards, title bars, tables |
| `--bg-elevated` | `#2F3346` | Dropdowns, modals, chips |
| `--bg-hover` | `#383D52` | Row hover, button hover |

### Borders
| Token | Hex | Use |
|---|---|---|
| `--border` | `#3A405A` | Default hairline |
| `--border-subtle` | `#2A2F42` | Row dividers, internal separators |

### Text (cool slate ramp)
| Token | Hex | Use |
|---|---|---|
| `--text-primary` | `#E4E7EE` | Body, values, headings |
| `--text-secondary` | `#9096AC` | Meta, secondary copy |
| `--text-muted` | `#5C6278` | Labels, placeholders, disabled |

### Placement / tiers (chess-gold palette)
| Token | Hex |
|---|---|
| `--gold` | `#C9A84C` |
| `--gold-dim` | `#8A7234` |
| `--silver` | `#8A92A8` |
| `--bronze` | `#8B6D4F` |

### Status
| Token | Hex | Use |
|---|---|---|
| `--red` | `#9B3A3A` | Destructive fill |
| `--red-bright` | `#C44E4E` | Loss, −1 rank |
| `--green` | `#3A7A4A` | Confirm fill |
| `--green-bright` | `#4EAA62` | Win, +1 rank |

### Accent (from logo gradient)
| Token | Hex | Use |
|---|---|---|
| `--accent` | `#E0402A` | Primary button, tab underline |
| `--accent-hover` | `#FF6046` | Hover state |
| `--accent-dim` | `#CC3520` | Logo mark fill |

### Typography
- **Display**: `Cinzel` — 400 / 600 / 700 (Google Fonts). Fallback: `Trajan Pro, serif`. Used only for hero type, placement numerals, and logo.
- **Body / UI / Mono**: `JetBrains Mono` — 400 / 500 / 600 / 700. Fallback: `ui-monospace, Menlo, monospace`. Used everywhere else.

Sizes (px): 11, 12, 13, 14, 16, 18, 24, 32, hero clamp(42, 7vw, 72).
Line height: tight 1.1, body 1.5, relaxed 1.7.
Letter-spacing: body 0.5, UI 1, upper 1.5, upper-wide 2, display 3, hero 10.
Weights: 400 / 500 / 600 / 700.

### Radii (softly rounded, never sharp)
| Token | Value | Use |
|---|---|---|
| `--r-0` | 2px | Default — tables, tabs, buttons |
| `--r-2` | 4px | Unit-stars chip |
| `--r-3` | 6px | Chip, small icon |
| `--r-4` | 8px | Icon tile, small button |
| `--r-6` | 10px | Tooltip |
| `--r-8` | 12px | Card, video, lightbox |
| `--r-pill` | 128px | Marketing CTA only |

### Spacing scale (px)
2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48.

### Elevation
- `--shadow-tooltip`: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)`
- `--shadow-lightbox`: `0 16px 64px rgba(0,0,0,0.6)`

### Transitions
- `--t-fast`: 0.1s
- `--t-base`: 0.15s
- `--t-slow`: 0.2s
- `--t-easing`: `cubic-bezier(0.16, 1, 0.3, 1)`

## Semantic Type Roles
Pre-composed classes in `colors_and_type.css`:
- `.h-hero` — Cinzel 700, clamp hero, 10px tracking, uppercase
- `.h-display` — Cinzel 600, 18px, 3px tracking, uppercase, secondary color
- `.h-section` — Mono 500, 13px, 2px tracking, uppercase, muted
- `.h-label` — Mono 500, 11px, 1.5px tracking, uppercase, muted
- `.t-body` / `.t-body-sm` — body + small body
- `.t-meta` / `.t-meta-xs` — 12px / 11px muted meta
- `.t-stat-value` — 32px bold, tight leading
- `.t-placement` — Cinzel 700, 28px, for placement numerals
- `.t-tabular` — enables tabular-nums

## Components
Each is documented as an HTML specimen in `preview/`. Summary:

### Buttons (`components-buttons.html`)
- Ghost (default), Primary (accent), Confirm (green fill), Danger (red fill), Small, Small-danger, Disabled.
- 7px 18px padding, 1px border, 13px mono, 0.5px tracking, `--r-4` (8px).
- Primary: `#E0402A` bg with `--bg-deep` text for contrast. Hover = 0.9 opacity.

### Tabs (`components-tabs.html`)
- Mono 500 uppercase, 1px tracking, 13px.
- Active: `text-primary` + 2px accent underline. Hover: muted → secondary.
- Pending indicator: 7px green-bright dot, top-right of label.

### Inputs (`components-inputs.html`)
- JetBrains Mono 13px, 7×10 padding, bg = `--bg-deep`, border `--border`, radius 6px.
- Focus: border → `#E0402A`.
- Chips: `--bg-elevated` fill, 6px radius, cost pill inset.

### Game row (`components-gamerow.html`)
- 6-column grid: placement plate · lineup · record · rank · date · (spacer).
- Rows separated by `--border-subtle`; header by `--border`. Hover = `--bg-hover`.
- Gold row has `rgba(201,168,76,0.04)` tint.
- Unit squares: 28×28, 2px colored border, 6px radius, `--bg-elevated` fill.

### Window chrome (`components-chrome.html`)
- 36px title bar (bg-deep), Cinzel logo centered-left, 46px traffic-light controls on the right.
- 28px stat bar at bottom (bg-surface), 6px status dots.

### Placement numerals (`type-numerals.html`)
- Cinzel 700, 28px, in 52×52 box with 1px colored border, tier-tinted.

### Stats / numerals (`type-stats.html`)
- 4-column grid of 34px stat values, 1px gaps, rounded 8px container.

## Brand
- **Logo** (`brand-logo.html`): SVG mark + Cinzel "DAC Tools" wordmark with accent "DAC" and secondary-colored "Tools".
- **Backgrounds** (`brand-backgrounds.html`): plain dark surface, noise-dusted surface, masked grid variant.
- **Iconography** (`brand-iconography.html`): mono glyphs (+, −, ▲, ▼, ★) colored by status.

## Interactions & Behavior
- **Transitions**: use `--t-base` with `--t-easing` for color/border changes on hover.
- **Hover states**: buttons, rows, tabs all have hover treatments — see specimens.
- **Focus**: inputs gain accent border; no outline.
- **No animation beyond simple transitions** unless specifically designed.

## Files
Tokens:
- `colors_and_type.css` — root stylesheet, all CSS variables + semantic classes

Specimens (in `preview/`):
- Type: `type-body.html`, `type-display.html`, `type-labels.html`, `type-numerals.html`, `type-stats.html`
- Colors: `colors-background.html`, `colors-text.html`, `colors-accent.html`, `colors-semantic.html`, `colors-tiers.html`
- Spacing: `spacing-scale.html`, `spacing-borders.html`, `spacing-elevation.html`
- Components: `components-buttons.html`, `components-tabs.html`, `components-inputs.html`, `components-gamerow.html`, `components-chrome.html`
- Brand: `brand-logo.html`, `brand-backgrounds.html`, `brand-iconography.html`
- Shared: `card-base.css` (framing for specimens — not part of the system itself)

## How to use with Claude Code
1. Download this folder as a zip.
2. In your local DAC Tools repo, create a `design_handoff/` directory and unzip there.
3. Open Claude Code in the repo root.
4. Prompt: *"Read `design_handoff/README.md` and `design_handoff/colors_and_type.css`. Update our token files and component styles in the codebase to match. Preserve our existing architecture — map tokens into our current styling system (CSS modules / Tailwind / whatever is there)."*
5. Iterate component-by-component, opening the relevant `preview/*.html` specimen alongside each real component.
