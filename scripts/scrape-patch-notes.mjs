#!/usr/bin/env node
/**
 * Scrape DAC patch notes from the Steam Workshop changelog.
 *
 * Fetches the changelog page, parses entries, diffs against index.json,
 * and writes new patch JSON files.
 *
 * Usage:
 *   node scripts/scrape-patch-notes.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DATA = join(__dirname, "..", "data");
const DATA_DIR = join(ROOT_DATA, "patch_notes");
const INDEX_PATH = join(DATA_DIR, "index.json");
const ITEMS_PATH = join(ROOT_DATA, "items.json");
const UNITS_PATH = join(ROOT_DATA, "units.json");
const UNITS_FULL_PATH = join(ROOT_DATA, "units_full.json");
const SYNERGIES_PATH = join(ROOT_DATA, "synergies.json");
const CHANGELOG_URL =
  "https://steamcommunity.com/sharedfiles/filedetails/changelog/1613886175";

const DRY_RUN = process.argv.includes("--dry-run");

async function fetchChangelog() {
  const resp = await fetch(CHANGELOG_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching changelog`);
  return resp.text();
}

function parseChangelogEntries(html) {
  const entries = [];
  const currentYear = new Date().getFullYear();

  // Split by changelog entry containers
  const blocks = html.split(/changeLogCtn/);

  for (const block of blocks) {
    // Match: "Update: 25 May @ 1:45am" or "Update: 29 Apr @ 8:10am"
    const dateMatch = block.match(
      /Update:\s*(\d+)\s+(\w+)\s*@\s*([\d:]+[ap]m)/i
    );
    if (!dateMatch) continue;

    const day = dateMatch[1];
    const month = dateMatch[2];
    const time = dateMatch[3];

    const parsed = new Date(`${month} ${day}, ${currentYear}`);
    if (isNaN(parsed.getTime())) continue;
    const isoDate = parsed.toISOString().split("T")[0];

    // Extract content from <p id="...">content</p>
    const contentMatch = block.match(/<p\s+id="[^"]*">([\s\S]*?)<\/p>/i);
    if (!contentMatch) continue;

    let content = contentMatch[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/●\s*/g, "")
      .trim();

    if (!content) continue;

    entries.push({ date: isoDate, time, content });
  }

  return entries;
}

function classifyEntry(line) {
  const l = line.toLowerCase();
  if (l.includes("rework")) return "change";
  if (l.includes("added") || l.includes("new ")) return "new";
  if (l.includes("removed") || l.includes("temporarily removed"))
    return "removed";
  if (l.includes("fix")) return "fix";
  if (
    l.includes("increased") ||
    l.includes("bonus") ||
    l.includes("duration increased") ||
    l.includes("radius increased")
  )
    return "buff";
  if (
    l.includes("decreased") ||
    l.includes("reduced") ||
    l.includes("downgrade") ||
    l.includes("nerfed")
  )
    return "nerf";
  return "change";
}

function contentToSections(content) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const entries = [];
  for (const line of lines) {
    const match = line.match(/^([^:–—]+?)\s*[:–—]\s*(.+)$/);
    if (match) {
      entries.push({
        kind: classifyEntry(line),
        name: match[1].trim(),
        detail: match[2].trim(),
      });
    } else {
      entries.push({
        kind: classifyEntry(line),
        name: line.length > 60 ? line.slice(0, 50) + "…" : line,
        detail: line,
      });
    }
  }

  return [{ heading: "Changes", entries }];
}

function slugifyName(value) {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function applyGameDataChanges(sections) {
  const items = JSON.parse(readFileSync(ITEMS_PATH, "utf-8"));
  const units = JSON.parse(readFileSync(UNITS_PATH, "utf-8"));
  const unitsFull = JSON.parse(readFileSync(UNITS_FULL_PATH, "utf-8"));
  const synergies = JSON.parse(readFileSync(SYNERGIES_PATH, "utf-8"));
  let changed = false;

  const itemsBySlug = new Map();
  for (const name of Object.keys(items.items)) {
    itemsBySlug.set(slugifyName(name), name);
    itemsBySlug.set(slugifyName(name.replace(/'/g, "")), name);
  }

  const unitsBySlug = new Map();
  for (const name of Object.keys(units.units ?? units)) {
    unitsBySlug.set(slugifyName(name), name);
  }

  for (const section of sections) {
    for (const entry of section.entries) {
      const detail = entry.detail;
      const bare = entry.name.replace(/\s*-\s+.*$/, "").replace(/\s*\(.*\)$/, "").trim();

      // Item tier changes: "Downgraded from T3 to T2" or "Upgraded from T2 to T3"
      const tierMatch = detail.match(/(?:downgrade|upgrade)d?\s+from\s+T(\d)\s+to\s+T(\d)/i);
      if (tierMatch) {
        const newTier = parseInt(tierMatch[2]);
        const slug = slugifyName(entry.name.replace(/'/g, ""));
        const itemName = itemsBySlug.get(slug) || itemsBySlug.get(slugifyName(entry.name));
        if (itemName && items.items[itemName]) {
          console.log(`  → ${itemName}: tier ${items.items[itemName].tier} → ${newTier}`);
          items.items[itemName].tier = newTier;
          changed = true;
        }
      }

      // New item: "New T3 item: Kobold Cup" (name could be either field)
      const newItemFromName = entry.name.match(/new\s+T(\d)\s+item/i);
      const newItemFromDetail = detail.match(/new\s+T(\d)\s+item/i);
      if (newItemFromName) {
        const tier = parseInt(newItemFromName[1]);
        const itemName = detail.trim();
        if (itemName && !items.items[itemName]) {
          console.log(`  → New item: ${itemName} (T${tier})`);
          items.items[itemName] = { tier };
          items.total = Object.keys(items.items).length;
          changed = true;
        }
      } else if (newItemFromDetail) {
        const tier = parseInt(newItemFromDetail[1]);
        const itemName = entry.name.trim();
        if (itemName && !items.items[itemName]) {
          console.log(`  → New item: ${itemName} (T${tier})`);
          items.items[itemName] = { tier };
          items.total = Object.keys(items.items).length;
          changed = true;
        }
      }

      // Unit class/species change: "Class changed from X to Y" or "Species changed from X to Y"
      const classMatch = detail.match(/(?:class|species)\s+changed\s+from\s+(\w[\w\s]*?)\s+to\s+(\w[\w\s]*?)\.?$/i);
      if (classMatch) {
        const oldSyn = classMatch[1].trim();
        const newSyn = classMatch[2].trim();
        const unitName = unitsBySlug.get(slugifyName(bare));
        if (unitName) {
          for (const data of [units.units?.[unitName] ?? units[unitName], unitsFull[unitName]]) {
            if (!data?.synergies) continue;
            const idx = data.synergies.indexOf(oldSyn);
            if (idx !== -1) {
              console.log(`  → ${unitName}: ${oldSyn} → ${newSyn}`);
              data.synergies[idx] = newSyn;
              changed = true;
            }
          }
        }
      }

      // Synergy tier rework: "Reworked from (1)(2)(3) to (2)(4)"
      const tierRework = detail.match(/reworked?\s+from\s+\([\d)(]+\)\s+to\s+(\([\d)(]+\))/i);
      if (tierRework) {
        const newTiers = [...tierRework[1].matchAll(/\((\d+)\)/g)].map(m => parseInt(m[1]));
        const synSlug = slugifyName(bare);
        for (const [, syn] of Object.entries(synergies)) {
          if (syn.name && slugifyName(syn.name) === synSlug && newTiers.length > 0) {
            console.log(`  → ${syn.name} synergy tiers: [${syn.tiers}] → [${newTiers}]`);
            syn.tiers = newTiers;
            changed = true;
          }
        }
      }
    }
  }

  if (changed && !DRY_RUN) {
    writeFileSync(ITEMS_PATH, JSON.stringify(items, null, 2) + "\n");
    writeFileSync(UNITS_PATH, JSON.stringify(units.units ? units : { units }, null, 2) + "\n");
    writeFileSync(UNITS_FULL_PATH, JSON.stringify(unitsFull, null, 2) + "\n");
    writeFileSync(SYNERGIES_PATH, JSON.stringify(synergies, null, 2) + "\n");
    console.log("Updated game data files.");
  } else if (changed) {
    console.log("[dry-run] Would update game data files.");
  }
}

async function main() {
  console.log("Fetching Steam Workshop changelog...");
  const html = await fetchChangelog();

  console.log("Parsing entries...");
  const entries = parseChangelogEntries(html);
  console.log(`Found ${entries.length} changelog entries on page 1`);

  const index = JSON.parse(readFileSync(INDEX_PATH, "utf-8"));
  const existingDates = new Set(index.patches.map((p) => p.date));
  const existingSlugs = new Set(index.patches.map((p) => p.slug));

  // Group by date, skip existing
  const byDate = new Map();
  for (const entry of entries) {
    if (existingDates.has(entry.date)) continue;
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }

  if (byDate.size === 0) {
    console.log("No new patches found.");
    return;
  }

  console.log(`${byDate.size} new patch date(s) to add`);

  const newPatches = [];

  for (const [date, dayEntries] of byDate) {
    const combined = dayEntries.map((e) => e.content).join("\n\n");
    const title = "Rebalance Patch";
    let slug = `${date}-rebalance-patch`;
    if (existingSlugs.has(slug)) continue;
    const filePath = join(DATA_DIR, `${slug}.json`);

    const patchData = {
      date,
      title,
      source: CHANGELOG_URL,
      sections: contentToSections(combined),
    };

    if (DRY_RUN) {
      console.log(`\n[dry-run] Would write ${slug}.json:`);
      console.log(JSON.stringify(patchData, null, 2));
    } else {
      writeFileSync(filePath, JSON.stringify(patchData, null, 2) + "\n");
      console.log(`Wrote ${slug}.json`);
    }

    newPatches.push({ date, title, slug });

    console.log("Applying game data changes...");
    applyGameDataChanges(patchData.sections);
  }

  if (!DRY_RUN && newPatches.length > 0) {
    newPatches.sort((a, b) => b.date.localeCompare(a.date));
    index.patches = [...newPatches, ...index.patches];
    writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
    console.log(`Updated index.json with ${newPatches.length} new patch(es)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
