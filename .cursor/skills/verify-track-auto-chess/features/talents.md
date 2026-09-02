# Talents

## Sub-features

- Show courier talent pairs by milestone round.
- Order the tree from the latest milestone down.
- Explain round-45 unlock behavior.
- Link the Leafy Essence relic from the introduction.

## How to get to it (user POV)

From `/`, choose the public `Talents` navigation link. The page at `/talents` displays both options for each milestone. Choose `Leafy Essence` in the introduction to open its relic detail.

## Driving it with Cursor computer-use

Click `getByRole("link", { name: "Talents" })` and assert `/talents` plus `getByRole("heading", { name: "Talents" })`. Confirm the visible introduction starts with `At each milestone round`. Click `getByRole("link", { name: "Leafy Essence" })`, then assert `/relics/leafy-essence` and the `Leafy Essence` heading.

## Gotchas

- `Talents` is a standalone navigation link, not inside the Entities or Synergies menus.
- The talent tree is read top-down from the highest round, intentionally reversing ascending tier order.
- Talent and relic content comes from committed game data, so no database configuration is needed.
- Capture enough of the tree to show paired options and the route change to the linked relic; a heading-only screenshot does not prove the interaction.
