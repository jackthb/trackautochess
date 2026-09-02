# Entity browser

## Sub-features

- Browse Units by cost tier and Items by item tier.
- Filter Units by name, description, lore, or synergy tag.
- Filter Items by name or description.
- Open committed-content detail pages with breadcrumbs and related entities.

## How to get to it (user POV)

From `/`, open the `Entities` navigation menu and choose `Units` or `Items`. Unit cards lead to `/units/<slug>`; item cards lead to `/items/<slug>`.

## Driving it with Cursor computer-use

For Units, click `getByRole("button", { name: "Entities" })`, then `getByRole("link", { name: "Units" })`. Assert `getByRole("heading", { name: "Units" })`, fill `getByPlaceholder("Search units...")` with `Tidehunter`, and click the `Tidehunter` link. Assert `/units/tidehunter`, the `Tidehunter` heading, and the `Overview` section.

For Items, follow the same menu through `getByRole("link", { name: "Items" })`, fill `getByPlaceholder("Search items...")` with `Vanguard`, click the `Vanguard` link, and assert `/items/vanguard` plus the `Vanguard` heading.

## Gotchas

- On a narrow viewport, first click `getByRole("button", { name: "Open menu" })`; the same link names appear in the dialog.
- Entity data comes from committed `content/` JSON through the generated `web/generated/content-data.ts`; Launch regenerates it before Next starts.
- Search matches descriptions and lore as well as names, so a broad query can legitimately leave several cards.
- Unit synergy buttons are real filters. `Deselect filters` appears only after at least one filter is active.
