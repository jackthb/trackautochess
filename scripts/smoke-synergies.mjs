// Synergy-badge smoke test. Runs the real shared computation against real
// content/game data, so a stale unit record or a missing counts_as_synergy
// item link fails here instead of on a live profile.
//
//   node --import ./scripts/lib/register-ts.mjs scripts/smoke-synergies.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildItemSynergyLookup,
  buildSynergyMinCountByName,
  buildSynergyTiersByName,
  computeLineupSynergies,
} from "../shared/game-structure.ts";
import { parseSynergies } from "../shared/game-utils.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GAME_DIR = path.join(ROOT, "content", "game");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readDir = (dir) =>
  fs
    .readdirSync(path.join(GAME_DIR, dir))
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(GAME_DIR, dir, file)));

/** Mirror of the runtime-data generator's units_full / synergies shaping. */
function loadContent() {
  const unitsFull = {};
  for (const entry of readDir("units")) {
    const source = entry.source ?? {};
    const overrides = entry.overrides ?? {};
    unitsFull[entry.name ?? source.name] = {
      id: source.id,
      cost: source.cost,
      synergies: overrides.synergies ?? source.synergies ?? [],
    };
  }
  const synergies = {};
  for (const entry of readDir("synergies")) {
    const source = entry.source ?? {};
    const overrides = entry.overrides ?? {};
    synergies[entry.gameId] = {
      name: entry.name ?? source.name,
      tiers: overrides.tiers ?? source.tiers ?? [],
    };
  }
  const itemsFull = {};
  for (const entry of readDir("items")) {
    const source = entry.source ?? {};
    if (source.id) itemsFull[source.id] = { name: entry.name ?? source.name };
  }
  return { unitsFull, synergies, itemsFull };
}

const { unitsFull, synergies, itemsFull } = loadContent();
const unitSynergies = Object.fromEntries(
  Object.entries(unitsFull).map(([name, info]) => [name, info.synergies]),
);
const options = {
  unitSynergies,
  synergyMinCount: buildSynergyMinCountByName(synergies),
  synergyTiers: buildSynergyTiersByName(synergies),
  itemCountsAsSynergy: buildItemSynergyLookup(
    readJson(path.join(GAME_DIR, "item-links.json")),
    itemsFull,
  ),
};

const byName = (result) =>
  Object.fromEntries(result.map((entry) => [entry.name, entry]));

// --- Content guards ---------------------------------------------------------

// Every counts_as_synergy item named in the item catalog must be linked, or
// its carrier silently stops counting toward the synergy it grants.
for (const [item, synergy] of [
  ["Minotaur Horn", "Dragon"],
  ["Spider Leg", "Aqir"],
  ["Kobold Cup", "Kobold"],
  ["Ogre Hood", "Ogre"],
  ["Satanic", "Faceless"],
]) {
  assert.equal(
    options.itemCountsAsSynergy[item],
    synergy,
    `${item} should count its carrier as ${synergy}`,
  );
}

// Ringmaster has no static traits by design (no race, 3 classes rolled per
// match); the roll is captured per match in `chess_rm_class` instead.
assert.deepEqual(unitsFull.Ringmaster.synergies, []);

// Those captured classes are raw `is_*` keys. They have to resolve to the same
// display names the unit lookup uses, or the override silently counts nothing.
for (const [key, name] of [
  ["is_demonhunter", "Demon Hunter"],
  ["is_assassin", "Assassin"],
  ["is_druid", "Druid"],
  ["is_mage", "Mage"],
]) {
  assert.equal(synergies[key]?.name, name, `${key} must resolve to "${name}"`);
  assert.ok(
    options.synergyTiers[name],
    `"${name}" must be a synergy the tier lookup knows`,
  );
}

// --- jack's 27 Jul board ----------------------------------------------------
// 8 Mages (7 static + Ringmaster's roll), 6 Humans, 4 Dragons (3 static + a
// Minotaur Horn carrier), 2 Wizards. The 2-Wizard perk drops every 4+
// threshold by one, so Mage activates (9) and Dragon activates (5).

const board = [
  { name: "Ogre Magi" },
  { name: "Puck" },
  { name: "Lina" },
  { name: "Phoenix" },
  { name: "Crystal Maiden" },
  { name: "Jakiro" },
  { name: "Keeper of the Light" },
  { name: "Ringmaster" },
  { name: "Dragon Knight", items: ["item_gulonghaojiao"] },
  { name: "Lycan" },
  { name: "Legion Commander" },
  { name: "Lion" },
  { name: "Rubick" },
];
const storedBuff = parseSynergies(
  "mage:8|human:6|dragon:4|wizard:2|knight:2|demon:1|elf:1|ogre:1|element:1|beast:1|hunter:1|god:1",
);

// Board rows carry per-piece items, so counts-as items are exact there.
const fromBoard = byName(
  computeLineupSynergies(board, { ...options, storedSynergies: storedBuff }),
);
assert.equal(fromBoard.Mage.count, 8, "Ringmaster's rolled Mage class counts");
assert.equal(fromBoard.Mage.tier, 9, "2 Wizards activate 9-Mage with 8 bodies");
assert.equal(fromBoard.Human.count, 6);
assert.equal(fromBoard.Human.tier, 6);
assert.equal(fromBoard.Dragon.count, 4, "Minotaur Horn carrier counts as Dragon");
assert.equal(fromBoard.Dragon.tier, 5, "2 Wizards activate 5-Dragon with 4 bodies");
assert.equal(fromBoard.Wizard.tier, 2);
assert.equal(fromBoard.Knight.tier, 2);
assert.equal(fromBoard.Demon.tier, 1);
assert.equal(fromBoard.Elemental, undefined, "a lone Elemental is not active");

// The profile match list has no per-piece items — only the lineup and the
// stored buff. It must land on the same tiers as the match page.
const lineupOnly = board.map(({ name }) => ({ name }));
const fromLineup = byName(
  computeLineupSynergies(lineupOnly, { ...options, storedSynergies: storedBuff }),
);
for (const name of ["Mage", "Human", "Dragon", "Wizard", "Knight", "Demon"]) {
  assert.equal(
    fromLineup[name]?.tier,
    fromBoard[name].tier,
    `${name} tier must match across the match page and the profile row`,
  );
}

// --- Ringmaster's captured class roll ---------------------------------------
// `chess_rm_class` records the roll per match, so where a match carries it the
// classes are counted exactly rather than inferred from the game's counts.
const ringmasterRolledMage = {
  ...options,
  unitSynergyOverrides: { Ringmaster: ["Mage", "Assassin", "Druid"] },
};
const exact = byName(computeLineupSynergies(board, ringmasterRolledMage));
assert.equal(exact.Mage.count, 8, "the rolled Mage class counts with no buff at all");
assert.equal(exact.Mage.tier, 9);

// A roll that did not include Mage must not be inflated to 9 by a stale buff:
// Ringmaster is resolved now, so it no longer buys headroom.
const rolledElsewhere = byName(
  computeLineupSynergies(board, {
    ...options,
    unitSynergyOverrides: { Ringmaster: ["Assassin", "Druid", "Hunter"] },
    storedSynergies: storedBuff,
  }),
);
assert.equal(rolledElsewhere.Mage.count, 7);
assert.equal(rolledElsewhere.Mage.tier, 6);

// --- Floor bounding ---------------------------------------------------------

// A stale buff must not invent bodies. Without a Ringmaster (or any other
// unresolved piece) on board there is no headroom for a non-item synergy.
const noRingmaster = board.filter((piece) => piece.name !== "Ringmaster");
const stale = byName(
  computeLineupSynergies(noRingmaster, {
    ...options,
    storedSynergies: parseSynergies("mage:9|human:8"),
  }),
);
assert.equal(stale.Mage.count, 7, "buff cannot raise Mage past the bodies shown");
assert.equal(stale.Human.count, 6, "buff cannot raise Human past the bodies shown");

// A synergy the board does not have at all is never introduced by the buff.
const phantom = byName(
  computeLineupSynergies(board, {
    ...options,
    storedSynergies: parseSynergies("undead:6"),
  }),
);
assert.equal(phantom.Undead, undefined, "buff-only synergies are not displayed");

// --- Wizard perk edges ------------------------------------------------------

// One Wizard is not enough for the discount. (The buff has to agree that
// there is only one — Ringmaster's roll can legitimately be the second.)
const oneWizard = byName(
  computeLineupSynergies(
    board.filter((piece) => piece.name !== "Rubick"),
    {
      ...options,
      storedSynergies: parseSynergies("mage:8|human:6|dragon:4|wizard:1|knight:2|demon:1"),
    },
  ),
);
assert.equal(oneWizard.Mage.count, 8);
assert.equal(oneWizard.Mage.tier, 6, "no discount below 2 Wizards");

// The discount only applies to thresholds of 4 or more: Human's (3) tier is
// untouched, so 2 Humans still show nothing.
const twoHumans = byName(
  computeLineupSynergies(
    [
      { name: "Lina" },
      { name: "Crystal Maiden" },
      { name: "Rubick" },
      { name: "Naga Siren" },
    ],
    options,
  ),
);
assert.equal(twoHumans.Human, undefined, "(3) Human is not discounted to (2)");
assert.equal(twoHumans.Wizard.tier, 2);

console.log("smoke-synergies: ok");
