/**
 * Build the canonical units.json from units_by_cost.json.
 * Format: { "units": { "Name": { "cost": N, "synergies": [...] } }, "_meta": {...} }
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");

const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "units_by_cost.json"), "utf8"));

// Build canonical units.json
const units = {};
for (const [name, data] of Object.entries(raw.units)) {
  units[name] = {
    cost: data.cost,
    synergies: data.synergies,
  };
}

const output = {
  units,
  _meta: {
    source: raw._meta.source,
    scraped: raw._meta.scraped,
    totalUnits: Object.keys(units).length,
    byCost: Object.fromEntries(
      Object.entries(raw.byCost).map(([cost, names]) => [
        `$${cost}`,
        names.length,
      ])
    ),
  },
};

// Write to data/
writeFileSync(resolve(DATA_DIR, "units.json"), JSON.stringify(output, null, 2));
console.log(`Written: data/units.json (${Object.keys(units).length} units)`);

// Print summary
const costCounts = {};
for (const data of Object.values(units)) {
  const c = data.cost ?? "?";
  costCounts[c] = (costCounts[c] || 0) + 1;
}
console.log("\nCost distribution:");
for (const [cost, count] of Object.entries(costCounts).sort()) {
  console.log(`  $${cost}: ${count} units`);
}
