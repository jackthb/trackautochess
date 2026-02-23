/**
 * Parse raw scraped data into structured units.json and items.json.
 * Uses only already-scraped data — no new network requests.
 *
 * Usage:
 *   node parse.js
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");

function load(filename) {
  return JSON.parse(readFileSync(resolve(DATA_DIR, filename), "utf8"));
}

function save(filename, data) {
  const outPath = resolve(DATA_DIR, filename);
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Written: ${outPath}`);
}

// ---------------------------------------------------------------------------
// Items parser
// ---------------------------------------------------------------------------

function parseItems(bodyText) {
  const items = {};

  // Format in body text:
  //   1\nBRACER\n1\nWRAITH BAND\n...
  //   Each item is: tier\nNAME
  const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Find where the item list starts (after the star filter tabs)
  const startIdx = lines.findIndex((l) => l === "★★★★★") + 1;
  if (startIdx === 0) {
    console.warn("Items: could not find start marker");
    return items;
  }

  let i = startIdx;
  while (i < lines.length) {
    const tierStr = lines[i];
    const tier = parseInt(tierStr, 10);
    if (!isNaN(tier) && tier >= 1 && tier <= 5) {
      const name = lines[i + 1];
      if (name && !/^[0-9]$/.test(name) && name !== "AUTOCHESS.SITE") {
        // Normalise to title case
        const normalised = name
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        items[normalised] = { tier };
        i += 2;
        continue;
      }
    }
    i++;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Patch notes parser — extracts unit data from mentions in patch notes
// ---------------------------------------------------------------------------

function parsePatchNotes(bodyText) {
  const units = {};
  const synergies = new Set();
  const patches = [];
  let currentPatch = null;

  // Patterns:
  // "New Chess Piece: Largo ($2 Naga/Monk)"
  // "Tiny ($2 Element/Warrior): Upgraded from $1 to $2"
  // "Bane ($1 Satyr/Faceless/Warlock): Species changed..."
  // "Morphling ($2 ➡️ $5), gained Elf"
  // "Ogre Magi ($1 ➡️ $3)"

  const newPieceRe = /New (?:Chess )?Piece[:\s]+([A-Za-z '\-]+?)\s*\(\$(\d+)[,\s]+([A-Za-z/]+)\)/g;
  const unitMentionRe = /([A-Z][A-Za-z '\-]{2,30})\s*\(\$(\d+)(?:\s*➡️\s*\$\d+)?\s*(?:,\s*)?([A-Za-z/]+)?\)/g;
  const dateRe = /^\d{1,2}\s+[A-Z][a-z]+$/;

  const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Detect patch date headers
    if (dateRe.test(line)) {
      currentPatch = line;
      patches.push(line);
      continue;
    }

    // New piece announcements — most reliable format
    const newPieceMatches = [...line.matchAll(newPieceRe)];
    for (const m of newPieceMatches) {
      const name = m[1].trim();
      const cost = parseInt(m[2], 10);
      const typeStr = m[3];
      const types = typeStr.split("/").map((t) => t.trim());
      units[name] = { cost, species: [], class: [], addedPatch: currentPatch };
      // Last type is usually the class, preceding are species — heuristic
      classifyTypes(units[name], types, synergies);
      console.log(`  New piece: ${name} ($${cost} ${typeStr}) @ ${currentPatch}`);
    }

    // General unit mentions with cost + type info
    const mentionMatches = [...line.matchAll(unitMentionRe)];
    for (const m of mentionMatches) {
      const name = m[1].trim();
      const cost = parseInt(m[2], 10);
      const typeStr = m[3];
      // Skip if already added as new piece, or name looks like noise
      if (units[name] || !typeStr || name.length < 3) continue;
      if (/^(The|And|For|New|Fixed|Upgraded|Changed)/.test(name)) continue;
      const types = typeStr.split("/").map((t) => t.trim());
      units[name] = { cost, species: [], class: [], seenInPatch: currentPatch };
      classifyTypes(units[name], types, synergies);
      console.log(`  Unit mention: ${name} ($${cost} ${typeStr}) @ ${currentPatch}`);
    }
  }

  return { units, synergies: [...synergies].sort(), patches };
}

// Heuristic: known classes vs species based on our existing data + new info
const KNOWN_CLASSES = new Set([
  "Warrior", "Mage", "Assassin", "Hunter", "Knight", "Warlock",
  "Druid", "Shaman", "Mech", "Demon Hunter", "Wizard", "Monk",
  "Faceless",
]);

const KNOWN_SPECIES = new Set([
  "Human", "Elf", "Orc", "Goblin", "Troll", "Undead", "Beast",
  "Dragon", "Demon", "Naga", "Elemental", "Dwarf", "Ogre", "God",
  "Satyr", "Kobold", "Draenei", "Aqir", "Pandaren",
]);

function classifyTypes(unit, types, synergies) {
  for (const t of types) {
    synergies.add(t);
    if (KNOWN_CLASSES.has(t)) {
      unit.class.push(t);
    } else if (KNOWN_SPECIES.has(t)) {
      unit.species.push(t);
    } else {
      // Unknown — add to both buckets with a flag so we can review
      unit.species.push(t);
      console.warn(`    Unknown type '${t}' — classified as species, review needed`);
    }
  }
}

// ---------------------------------------------------------------------------
// Builds parser — extract unit names from the builds body text
// ---------------------------------------------------------------------------

function parseBuilds(bodyText) {
  const unitsFound = new Set();
  const builds = [];

  // Format: "Units:\nUnitName\nUnitName\n..."
  const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
  let inUnits = false;
  let currentBuild = null;
  let currentUnits = [];

  for (const line of lines) {
    if (line.endsWith("Build")) {
      if (currentBuild && currentUnits.length) {
        builds.push({ name: currentBuild, units: [...currentUnits] });
      }
      currentBuild = line;
      currentUnits = [];
      inUnits = false;
    } else if (line === "Units:") {
      inUnits = true;
    } else if (inUnits) {
      if (line.startsWith("Recommended") || line.startsWith("🛡️") ||
          line.startsWith("🧩") || line.startsWith("💠") ||
          line.startsWith("🌲") || line.startsWith("⚠️") ||
          line.startsWith("💡") || line === "AUTOCHESS.SITE") {
        inUnits = false;
      } else if (line.length > 2 && !line.startsWith("•")) {
        currentUnits.push(line);
        unitsFound.add(line);
      }
    }
  }
  if (currentBuild && currentUnits.length) {
    builds.push({ name: currentBuild, units: currentUnits });
  }

  return { builds, unitsFound: [...unitsFound].sort() };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const itemsRaw = load("items_raw.json");
const patchesRaw = load("patches_raw.json");

console.log("\n=== Parsing items ===");
const items = parseItems(itemsRaw.dom.bodyText);
console.log(`  Found ${Object.keys(items).length} items`);

console.log("\n=== Parsing patch notes ===");
const { units: patchUnits, synergies, patches } = parsePatchNotes(patchesRaw.dom.bodyText);
console.log(`  Found ${Object.keys(patchUnits).length} units, ${synergies.length} synergy types`);
console.log(`  Patches found: ${patches.length}`);
console.log(`  Most recent patch: ${patches[0]}`);

// Save intermediate outputs for review
save("items_parsed.json", { items, total: Object.keys(items).length });
save("units_from_patches.json", { units: patchUnits, synergies, patches });

console.log("\n=== Summary ===");
console.log(`Items: ${Object.keys(items).length} total`);
console.log(`Units from patch notes: ${Object.keys(patchUnits).length} (partial — patch notes only mention changed/new units)`);
console.log(`Synergies seen: ${synergies.join(", ")}`);
console.log(`\nReview items_parsed.json and units_from_patches.json`);
console.log("Then manually merge with existing units.json to fill gaps.");
