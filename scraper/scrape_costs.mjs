/**
 * Get cost tier for all 114 units using the hero pool cost filter (a <select> dropdown).
 * Also click each synergy filter to map units → synergies.
 *
 * Navigates via home page first (SPA routing), then uses the select element.
 * Single browser session — minimal requests.
 */

import puppeteer from "puppeteer";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get unit names from the hero pool grid that are currently VISIBLE.
 * Uses the hero pool grid (grid-cols-4 unit cards) — each card has a truncate div for the name.
 * When cost filter is active, hidden cards get display:none via React re-render.
 */
async function getVisibleUnits(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll(".grid.grid-cols-4 .group.cursor-pointer");
    const names = [];
    for (const card of cards) {
      const style = window.getComputedStyle(card);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const nameEl = card.querySelector("div.truncate");
      if (nameEl) {
        const name = nameEl.innerText?.trim();
        if (name && name.length > 1) names.push(name);
      }
    }
    return names;
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Find the cost filter <select> selector
// ---------------------------------------------------------------------------
async function findCostSelectSelector(page) {
  return page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")];
    for (const s of selects) {
      const opts = [...s.options].map((o) => o.value);
      if (opts.includes("All") && opts.includes("1") && opts.includes("5")) {
        // Build a unique selector
        return s.className ? null : null; // fallback: just return index
      }
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

// ---------------------------------------------------------------------------
// Navigate: home → Board Builder
// ---------------------------------------------------------------------------
console.log("Loading home page...");
await page.goto("https://www.autochess.site", { waitUntil: "networkidle2", timeout: 30000 });
await sleep(2000);

await page.evaluate(() => {
  const links = [...document.querySelectorAll("a, button")];
  const bb = links.find((el) => el.innerText?.toLowerCase().includes("board builder") || el.href?.includes("board-builder"));
  if (bb) bb.click();
});
await sleep(3000);

const cardCount = await page.evaluate(() =>
  document.querySelectorAll(".grid.grid-cols-4 .group.cursor-pointer").length
);
console.log(`Unit cards in hero pool: ${cardCount}`);

// ---------------------------------------------------------------------------
// Phase 1: Cost filter via <select>
// ---------------------------------------------------------------------------

const costMap = {}; // rawName → cost
const byCost = {};

// Find the cost filter select (has options All/1/2/3/4/5)
const costSelectIdx = await page.evaluate(() => {
  const selects = [...document.querySelectorAll("select")];
  return selects.findIndex((s) => {
    const opts = [...s.options].map((o) => o.value);
    return opts.includes("All") && opts.includes("1") && opts.includes("5");
  });
});

if (costSelectIdx === -1) {
  console.error("Cost filter <select> not found!");
  process.exit(1);
}
console.log(`Cost filter select found at index ${costSelectIdx}`);

for (const cost of [1, 2, 3, 4, 5]) {
  console.log(`\nFiltering by cost $${cost}...`);

  // Select the value using page.evaluate to target by index
  await page.evaluate(
    (idx, val) => {
      const sel = document.querySelectorAll("select")[idx];
      sel.value = val;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    },
    costSelectIdx,
    String(cost)
  );

  await sleep(1200);

  const units = await getVisibleUnits(page);
  byCost[cost] = units;
  for (const name of units) {
    costMap[name] = cost;
  }
  console.log(`  $${cost}: ${units.length} units — ${units.join(", ")}`);
}

// Reset to All
await page.evaluate(
  (idx) => {
    const sel = document.querySelectorAll("select")[idx];
    sel.value = "All";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  },
  costSelectIdx
);
await sleep(1000);

const allUnits = await getVisibleUnits(page);
console.log(`\nTotal units after reset to All: ${allUnits.length}`);

// ---------------------------------------------------------------------------
// Phase 2: Synergy filters
// ---------------------------------------------------------------------------

// Find the synergy filter elements — they are in the left panel as clickable items
// Inspect: synergies appear before the unit grid in the DOM, likely as div/li/span
const synFilterInfo = await page.evaluate(() => {
  // Find "Aqir" element to identify synergy filter type
  const all = [...document.querySelectorAll("*")];
  const aqir = all.find((el) => el.childElementCount === 0 && el.innerText?.trim() === "Aqir");
  if (!aqir) return { found: false };
  return {
    found: true,
    tag: aqir.tagName,
    class: aqir.className?.slice(0, 100),
    parentTag: aqir.parentElement?.tagName,
    parentClass: aqir.parentElement?.className?.slice(0, 100),
    grandparentClass: aqir.parentElement?.parentElement?.className?.slice(0, 100),
  };
});
console.log("\nSynergy filter element:", JSON.stringify(synFilterInfo));

const synergyList = [
  "Aqir","Assassin","Beast","Centaur","Demon","Demon Hunter","Draenei",
  "Dragon","Druid","Dwarf","Elemental","Elf","Faceless","Goblin","God",
  "Harpy","Human","Hunter","Knight","Kobold","Mage","Mech","Monk","Naga",
  "Ogre","Orc","Pandaren","Priest","Satyr","Shaman","Tauren","Troll",
  "Undead","Warlock","Warrior","Wizard",
];

const unitSynergies = {};

// Synergy filter is select[0], value = synergy name, "All" resets
const synSelectIdx = 0;

for (const syn of synergyList) {
  await page.evaluate(
    (idx, val) => {
      const sel = document.querySelectorAll("select")[idx];
      sel.value = val;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    },
    synSelectIdx,
    syn
  );

  await sleep(900);

  const units = await getVisibleUnits(page);
  for (const name of units) {
    if (!unitSynergies[name]) unitSynergies[name] = new Set();
    unitSynergies[name].add(syn);
  }
  console.log(`  ${syn}: ${units.length} units — ${units.join(", ")}`);

  // Reset to All
  await page.evaluate(
    (idx) => {
      const sel = document.querySelectorAll("select")[idx];
      sel.value = "All";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    },
    synSelectIdx
  );
  await sleep(400);
}

await browser.close();

// ---------------------------------------------------------------------------
// Build output
// ---------------------------------------------------------------------------

function titleCase(s) {
  return s.split(" ").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

// Canonical list: union of all cost filter results + allUnits reset
const rawNames = new Set([...allUnits, ...Object.keys(costMap)]);
const result = {};
const unknownCost = [];

for (const rawName of rawNames) {
  const title = titleCase(rawName);
  const cost = costMap[rawName] ?? null;
  const synsList = unitSynergies[rawName] ? [...unitSynergies[rawName]] : [];
  result[title] = { cost, synergies: synsList };
  if (cost === null) unknownCost.push(title);
}

console.log(`\n=== Summary ===`);
console.log(`Total units: ${Object.keys(result).length}`);
console.log(`With cost: ${Object.keys(result).length - unknownCost.length}`);
if (unknownCost.length) {
  console.log(`Unknown cost: ${unknownCost.join(", ")}`);
}

const output = {
  units: result,
  byCost,
  _meta: {
    source: "autochess.site board builder cost/synergy filters",
    scraped: new Date().toISOString().split("T")[0],
    totalUnits: Object.keys(result).length,
  },
};

writeFileSync(resolve(DATA_DIR, "units_by_cost.json"), JSON.stringify(output, null, 2));
console.log(`\nWritten: data/units_by_cost.json`);
