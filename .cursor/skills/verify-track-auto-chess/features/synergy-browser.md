# Synergy browser

## Sub-features

- Browse class traits such as Warrior.
- Browse species traits such as Beast.
- Search synergy name, description, and lore.
- Open shared `/synergies/<slug>` detail pages from either collection.

## How to get to it (user POV)

From `/`, open the `Synergies` navigation menu and choose `Classes` or `Species`. Select a visible synergy card to open its details.

## Driving it with Cursor computer-use

Click `getByRole("button", { name: "Synergies" })`, then `getByRole("link", { name: "Classes" })`. Assert the `Classes` heading, fill `getByPlaceholder("Search classes...")` with `Warrior`, click the `Warrior` link, and assert `/synergies/warrior` with a `Warrior` heading.

For Species, choose the `Species` link, fill `getByPlaceholder("Search species...")` with `Beast`, click `Beast`, and assert `/synergies/beast` with a `Beast` heading.

## Gotchas

- Classes and Species use different index routes but share the `/synergies/<slug>` detail route.
- On mobile, open the `Open menu` button before selecting the same accessible links.
- Search includes lore and descriptions, so use the exact names above when a single-card result is important to the proof.
- These pages use committed content and need no Supabase credentials.
