# Patch notes

## Sub-features

- Show the latest patch as a featured card.
- List historical patches by year and date.
- Open a patch detail with breadcrumbs and official-source links.
- Show whether committed entity data is synced with the featured patch.

## How to get to it (user POV)

From `/`, choose `Patch Notes` in the public navigation. At `/patch-notes`, choose the featured `Read patch notes` card or a dated historical entry.

## Driving it with Cursor computer-use

Click `getByRole("link", { name: "Patch Notes" })` and assert `/patch-notes` plus `getByRole("heading", { name: "Patch Notes" })`. Within `getByRole("region", { name: "Latest patch notes" })`, click its link labeled by the card text. Assert the resulting `/patch-notes/<slug>` route, a level-one patch title, and `getByRole("navigation", { name: "Breadcrumb" })` containing the `Patch Notes` link.

Capture the featured sync badge as either `Game data synced` or `Game data pending`; its accessible label explains exactly what that state means.

## Gotchas

- The latest patch title and slug change when committed content updates, so select the stable `Latest patch notes` region instead of hard-coding a title.
- `Game data pending` is a valid product state, not a verification failure. Report which state was observed.
- Official notes and Workshop links leave the app in a new external browsing context; they are not needed to prove internal navigation.
- Launch regenerates the runtime patch index before rendering this page.
