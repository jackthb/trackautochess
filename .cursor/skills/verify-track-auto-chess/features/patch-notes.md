# Patch notes

## Sub-features

- List historical patches by year and date.
- Open a patch detail with breadcrumbs and official-source links.
- Show a featured latest-patch card and sync state only when `getPatchPromo` can build promo data for the latest slug.

## How to get to it (user POV)

From `/`, choose `Patch Notes` in the public navigation. At `/patch-notes`, choose a dated historical entry. In the current committed content, the first entry is `Aegis Prediction & Hidden Serendipity(Part 2)` dated August 30, 2026.

## Driving it with Cursor computer-use

Click `getByRole("link", { name: "Patch Notes" })` and assert `/patch-notes` plus `getByRole("heading", { name: "Patch Notes" })`. Click the first dated entry, currently the link containing `Aegis Prediction & Hidden Serendipity(Part 2)` and `READ →`. Assert `/patch-notes/2026-08-30-aegis-prediction-and-hidden-serendipity-part-2`, a level-one heading with that title, and `getByRole("navigation", { name: "Breadcrumb" })` containing the `Patch Notes` link.

If `getByRole("region", { name: "Latest patch notes" })` exists in a later content revision, capture its sync badge as either `Game data synced` or `Game data pending`; its accessible label explains exactly what that state means.

## Gotchas

- This checkout does not render a featured card because the latest patch has no promo data. Do not require `Latest patch notes` or a sync badge unless it is visibly present.
- The latest title and slug change when committed content updates. Re-read the first generated `patchIndexData` entry and update the expected title/path before driving a newer checkout.
- When present, `Game data pending` is a valid product state, not a verification failure. Report which state was observed.
- Official notes and Workshop links leave the app in a new external browsing context; they are not needed to prove internal navigation.
- Launch regenerates the runtime patch index before rendering this page.
