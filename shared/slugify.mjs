/**
 * Canonical URL-slug derivation, shared by the web app and the patch-note
 * scraper.
 *
 * These two had identical private copies. That is a worse duplication than it
 * looks: the scraper writes the slugs that the web app later resolves, so any
 * divergence between the copies turns into 404s on published patch notes
 * rather than a visible error at the point of the change.
 *
 * Plain `.mjs` (with a hand-written `.d.mts`) because the scraper is run
 * directly by node from the repo root and has no TypeScript build step — the
 * same arrangement `drodo-core.mjs` already uses.
 *
 * @param {string} value
 * @returns {string}
 */
export function slugifyName(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
