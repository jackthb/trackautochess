/**
 * Parse board builder text into structured units + synergies JSON.
 * Then cross-reference cost data from patch notes.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");

const raw = readFileSync(resolve(DATA_DIR, "board_builder_full.txt"), "utf8");
const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Extract synergies (between "Synergies" and "$")
// ---------------------------------------------------------------------------
const synStart = lines.indexOf("Synergies") + 1;
const synEnd = lines.indexOf("$");
const synergies = lines.slice(synStart, synEnd);

// ---------------------------------------------------------------------------
// Extract unit names (between "$...1 2 3 4 5" block and "ARENA")
// ---------------------------------------------------------------------------
// Units are all-caps, between the cost buttons and "ARENA"
const unitStart = lines.indexOf("5", synEnd) + 1;
const unitEnd = lines.indexOf("ARENA");
const unitNames = lines.slice(unitStart, unitEnd).filter(l => /^[A-Z][A-Z '\-]+$/.test(l));

// ---------------------------------------------------------------------------
// Extract cost ordering from the numbered sequence after units
// The numbers after ARENA map to the items in the item registry (tiers)
// The unit costs come from the cost filter — we need another source.
// Use patch notes data to fill in costs where available.
// ---------------------------------------------------------------------------
const patchesRaw = JSON.parse(readFileSync(resolve(DATA_DIR, "patches_raw.json"), "utf8"));
const patchText = patchesRaw.dom.bodyText;

// Build cost map from patch notes patterns
const costMap = {};

// Pattern: "Name ($N ...)" or "Name ($N ➡️ $M)" — use final cost
const costRe = /([A-Z][A-Za-z '\-]{2,30})\s*\(\$(\d+)(?:\s*[\u27a1][\ufe0f]?\s*\$(\d+))?\s*[,)]/g;
let m;
while ((m = costRe.exec(patchText)) !== null) {
  const name = m[1].trim().toUpperCase();
  const cost = parseInt(m[3] || m[2], 10); // use final cost if changed
  costMap[name] = cost;
}

// Also add known costs from our old units.json
const oldUnits = JSON.parse(readFileSync(resolve(DATA_DIR, "units.json"), "utf8"));
for (const [name, data] of Object.entries(oldUnits.units)) {
  const key = name.toUpperCase();
  if (!costMap[key]) costMap[key] = data.cost;
}

// Hardcode a few we know from context
const knownCosts = {
  "LARGO": 2, "LIFESTEALER": 2, "ABYSSAL UNDERLORD": 5,
  "NAGA SIREN": 3, "BANE": 1, "TINY": 2,
};
for (const [name, cost] of Object.entries(knownCosts)) {
  costMap[name] = cost;
}

// ---------------------------------------------------------------------------
// Build units object — name -> { cost, synergies: [] }
// Synergy per unit requires clicking each unit in the board builder.
// For now, carry over from old data and flag unknowns.
// ---------------------------------------------------------------------------
const oldUnitMap = {};
for (const [name, data] of Object.entries(oldUnits.units)) {
  oldUnitMap[name.toUpperCase()] = data;
}

// Normalise name: "CRYSTAL MAIDEN" -> "Crystal Maiden"
function titleCase(s) {
  return s.split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

const units = {};
const unknownCost = [];

for (const rawName of unitNames) {
  const title = titleCase(rawName);
  const cost = costMap[rawName] ?? null;
  const old = oldUnitMap[rawName];

  units[title] = {
    cost,
    species: old?.species ?? [],
    class: old?.class ?? [],
    _needsReview: !old || cost === null,
  };

  if (cost === null) unknownCost.push(title);
}

console.log(`Total units: ${unitNames.length}`);
console.log(`Units with known cost: ${unitNames.length - unknownCost.length}`);
console.log(`Units needing cost review: ${unknownCost.length}`);
console.log(unknownCost.join(", "));

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------
writeFileSync(resolve(DATA_DIR, "units_current.json"), JSON.stringify({
  units,
  synergies,
  _meta: {
    source: "autochess.site board builder + patch notes",
    scraped: new Date().toISOString().split("T")[0],
    totalUnits: Object.keys(units).length,
    needsReview: unknownCost,
  }
}, null, 2));

console.log(`\nWritten: data/units_current.json`);
console.log(`Synergies (${synergies.length}): ${synergies.join(", ")}`);
