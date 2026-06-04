#!/usr/bin/env node
/**
 * Toggle the per-patch `entitiesSynced` flag on data/patch_notes/*.json.
 *
 * The scraper writes `entitiesSynced: false` on every new patch (and resets it
 * when a hotfix is folded in). That flag means "this patch's game-data changes
 * have NOT yet been pulled from the VPK into data/*.json and regenerated into
 * committed content/data files."
 * Once the full entity sync has run, flip the flag true with this script (or via
 * the /sync-patch-entities skill, which runs the sync then calls this).
 *
 * Usage:
 *   node scripts/mark-patch-synced.mjs --list        # show patches still pending
 *   node scripts/mark-patch-synced.mjs               # mark ALL pending patches synced
 *   node scripts/mark-patch-synced.mjs <slug>        # mark one patch synced
 *   node scripts/mark-patch-synced.mjs --unset <slug># re-flag a patch as pending
 *
 * <slug> is the patch filename without .json (e.g. 2026-05-24-kobold-cheers-poof-appears).
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { patchNoteToJson } from "./lib/patch-note-json.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "patch_notes");

function loadPatches() {
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => {
      const file = join(DATA_DIR, f);
      return { slug: f.replace(/\.json$/, ""), file, data: JSON.parse(readFileSync(file, "utf-8")) };
    });
}

function write(p, synced) {
  // Re-read so we only touch the two flag keys and preserve everything else
  // (and the file's existing key order, with the flag kept next to `source`).
  const data = JSON.parse(readFileSync(p.file, "utf-8"));
  data.entitiesSynced = synced;
  if (synced) data.entitiesSyncedAt = new Date().toISOString();
  else delete data.entitiesSyncedAt;
  writeFileSync(p.file, patchNoteToJson(data));
}

const argv = process.argv.slice(2);

if (argv.includes("--list")) {
  const pending = loadPatches().filter((p) => p.data.entitiesSynced === false);
  if (pending.length === 0) {
    console.log("No patches pending entity sync. All caught up.");
  } else {
    console.log(`${pending.length} patch(es) pending entity sync:`);
    for (const p of pending) console.log(`  - ${p.slug}  (${p.data.title ?? "?"})`);
  }
  process.exit(0);
}

const unsetIdx = argv.indexOf("--unset");
if (unsetIdx !== -1) {
  const slug = argv[unsetIdx + 1];
  if (!slug) {
    console.error("--unset requires a <slug>");
    process.exit(1);
  }
  const p = loadPatches().find((p) => p.slug === slug);
  if (!p) {
    console.error(`No patch named ${slug}`);
    process.exit(1);
  }
  write(p, false);
  console.log(`Re-flagged ${slug} as pending entity sync.`);
  process.exit(0);
}

const slug = argv.find((a) => !a.startsWith("--"));
const patches = loadPatches();
const targets = slug
  ? patches.filter((p) => p.slug === slug)
  : patches.filter((p) => p.data.entitiesSynced === false);

if (slug && targets.length === 0) {
  console.error(`No patch named ${slug}`);
  process.exit(1);
}
if (targets.length === 0) {
  console.log("No patches pending entity sync. Nothing to do.");
  process.exit(0);
}

for (const p of targets) {
  write(p, true);
  console.log(`Marked ${p.slug} synced.`);
}
console.log(`\nDone - ${targets.length} patch(es) flagged synced. Commit content/ and data/.`);
