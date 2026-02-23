/**
 * Extract structured game data from the autochess.site JS bundle.
 * Single fetch, no browser needed.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");

const res = await fetch("https://www.autochess.site/static/js/main.917ef4c8.js");
const js = await res.text();
console.log("Bundle size:", js.length, "bytes");

// ---------------------------------------------------------------------------
// Extract all unit arrays from builds: units:["Name","Name",...]
// ---------------------------------------------------------------------------
const allUnits = new Set();
const buildUnitsRe = /units:\[([^\]]+)\]/g;
let m;
while ((m = buildUnitsRe.exec(js)) !== null) {
  const names = m[1].match(/"([^"]+)"/g);
  if (names) {
    for (const n of names) {
      const name = n.replace(/"/g, "").trim();
      // Some entries have "Unit | Unit" format for interchangeable units
      for (const part of name.split("|")) {
        allUnits.add(part.trim());
      }
    }
  }
}
console.log(`\nUnits found across all builds: ${allUnits.size}`);
const unitList = [...allUnits].sort();
console.log(unitList.join(", "));

// ---------------------------------------------------------------------------
// Extract full builds array
// ---------------------------------------------------------------------------
// Find the builds array in the bundle - look for the pattern
const buildsMatch = js.match(/\{name:"[^"]+",description:"[^"]*",units:\[[^\]]+\],relics:\[[^\]]*\],items:\[[^\]]*\][^}]*\}/g);
const builds = [];
if (buildsMatch) {
  for (const raw of buildsMatch) {
    try {
      // Convert JS object literal to JSON-ish form
      const jsonLike = raw
        .replace(/(\w+):/g, '"$1":')
        .replace(/'/g, '"');
      // Use Function to evaluate the JS object safely
      const obj = new Function(`return (${raw})`)();
      builds.push(obj);
    } catch {
      // Parse error — store raw for inspection
      builds.push({ raw: raw.slice(0, 200) });
    }
  }
}
console.log(`\nBuilds found: ${builds.length}`);

// ---------------------------------------------------------------------------
// Extract patch notes structured data
// ---------------------------------------------------------------------------
const patchMatch = js.match(/\{date:"[^"]+",items:\[[^\]]*(?:\{[^}]*\}[^\]]*)*\]\}/g);
console.log(`\nPatch date entries found: ${patchMatch ? patchMatch.length : 0}`);

// ---------------------------------------------------------------------------
// Save outputs
// ---------------------------------------------------------------------------
writeFileSync(resolve(DATA_DIR, "units_from_bundle.json"), JSON.stringify({
  total: allUnits.size,
  units: unitList,
}, null, 2));
console.log(`\nWritten: data/units_from_bundle.json`);

writeFileSync(resolve(DATA_DIR, "builds_from_bundle.json"), JSON.stringify(builds, null, 2));
console.log(`Written: data/builds_from_bundle.json`);
