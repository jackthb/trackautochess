// Re-export only: the implementation lives in shared/ because
// scripts/scrape-patch-notes.mjs needs the exact same slugs (it writes the
// patch-note slugs this app later resolves).
export { slugifyName } from "@dac/shared/slugify.mjs";
