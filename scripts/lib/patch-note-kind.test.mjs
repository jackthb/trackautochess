import assert from "node:assert/strict";
import test from "node:test";

import { classifyHistoricalPatchNoteKind, classifyPatchNoteKind } from "./patch-note-kind.mjs";

const september7Cases = [
  ["Cooldown increased from 8/6/4s to 8/7/6s", "nerf"],
  [
    "Cooldown reduced from 10/9/8s to 10/8/6s; bounce count increased from 4/5/6 to 4/5/7",
    "buff",
  ],
  [
    "Duration increased from 4/6/10s to 6/8/12s; attack-speed slow adjusted from 30/40/60% to 40/50/60%",
    "buff",
  ],
  ["Base HP reduced from 550 to 500", "nerf"],
  ["Base HP increased from 1000 to 1100", "buff"],
  ["Bounce count reduced from 4/5/7 to 3/4/6", "nerf"],
  [
    "(6) Mechs gold-upgrade chance at courier level 6/7/8/9/10 changed from 25%/50%/75%/100%/100% to 20%/40%/60%/80%/100%",
    "nerf",
  ],
  ["Spawn delay for Aqir units reduced from 0.5s to 0.1s", "buff"],
];

test("classifies real September 7 stat changes by gameplay direction", () => {
  for (const [detail, expected] of september7Cases) {
    assert.equal(classifyPatchNoteKind(detail), expected, detail);
  }
});

test("classifies resource and timing costs opposite to beneficial stats", () => {
  const cases = [
    ["Mana cost increased from 50 to 75", "nerf"],
    ["Gold cost decreased from 4 to 3", "buff"],
    ["Cast time increased from 0.3s to 0.5s", "nerf"],
    ["Armor decreased from 10 to 8", "nerf"],
    ["Movement speed increased from 300 to 325", "buff"],
    ["Heal reduced from 20 to 15", "nerf"],
    ["Bounces increased from 4 to 5", "buff"],
    ["AS reduced from 100 to 80", "nerf"],
    ["ATTACK SPEED increased from 100 to 120", "buff"],
  ];

  for (const [detail, expected] of cases) {
    assert.equal(classifyPatchNoteKind(detail), expected, detail);
  }
});

test("treats stronger enemy debuffs as caster buffs", () => {
  assert.equal(
    classifyPatchNoteKind("Enemy stun duration increased from 1s to 1.5s"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Enemy movement-speed slow increased from 20% to 30%"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Enemy ability cooldown increased from 8s to 10s"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Enemy armor decreased from 10 to 8"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Cooldown increased from 8s to 10s for enemies"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Armor of enemies decreased from 10 to 8"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Cooldown on enemies increased from 8s to 10s"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Cooldown of all enemies increased from 8s to 10s"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Movement speed of all enemies increased from 300 to 325"),
    "nerf",
  );
});

test("keeps mixed-direction and opaque economy changes neutral", () => {
  assert.equal(
    classifyPatchNoteKind("Damage increased from 100 to 120; cooldown increased from 8s to 10s"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Damage increased from 100 to 120, cooldown increased from 8s to 10s"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Damage increased from 100 to 120 but armor reduced from 10 to 8"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Shop odds adjusted for courier levels 7 and 8"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Recruit threshold increased as the courier levels up"),
    "change",
  );
});

test("combines same-direction clauses separated by conjunctions", () => {
  assert.equal(
    classifyPatchNoteKind("Damage increased from 100 to 120 and cooldown reduced from 10s to 8s"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Damage and armor increased from 10 to 12"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Enemy slow and stun duration increased from 1s to 1.5s"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Enemy slow and cooldown increased"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Enemy stun duration and cooldown increased"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Armor and cooldown reduced for enemies"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Movement speed and cooldown on all enemies increased"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Increased enemy slow and cooldown"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind("Damage and cooldown increased"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Armor and cooldown reduced"),
    "change",
  );
});

test("preserves explicit lifecycle kinds", () => {
  assert.equal(classifyPatchNoteKind("Fixed a bug where IO could not be recruited"), "fix");
  assert.equal(classifyPatchNoteKind("Added a new T3 item"), "new");
  assert.equal(classifyPatchNoteKind("Temporarily removed from the chess pool"), "removed");
  assert.equal(classifyPatchNoteKind("Ability reworked"), "change");
});

test("classifies hosting notices, ranked announcements, and empty bugfix lines", () => {
  assert.equal(classifyPatchNoteKind("Fix bug!"), "fix");
  assert.equal(classifyPatchNoteKind("-fix bug"), "fix");
  assert.equal(
    classifyPatchNoteKind(
      "Drodo Notice: Due to server restrictions, all matches are hosted locally, please DONOT LEAVE EARLY if you are the HOST. Rank mode is currently closed until solutions on localhosts implemented.",
    ),
    "note",
  );
  assert.equal(
    classifyPatchNoteKind("Ranked Mode is attempting to reopen. (Any bug during the Beta test please notify us via email!)"),
    "note",
  );
  assert.equal(
    classifyPatchNoteKind(
      "Duration decreased from 10s to 6s, reduction percent decreased from 10/30/60 to 10/30/50",
    ),
    "nerf",
  );
  assert.equal(
    classifyPatchNoteKind("Rank mode points increased from 10 to 20"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Rank mode health increased from 10 to 20"),
    "buff",
  );
  assert.equal(
    classifyPatchNoteKind(
      "We will fix this gradually and make up for your losses",
      "Pass priorities are currently unavailable due to Valve servers out of touch.",
    ),
    "note",
  );
  assert.equal(
    classifyPatchNoteKind("Shop odds adjusted for courier levels 7 and 8", "The new season of S29"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind("Relaunching the client", "Relaunching the client for the new version"),
    "change",
  );
});

test("historical labels ignore names, missing health, and award badges", () => {
  const necrophos = "The execution damage has been changed from (200/300/400 + 0.6/1.2/1.8 times the target's missing health) to (500/700/900 + 50%/70%/90% of the target's maximum health). Cooldown has been balanced from 8/6/4 seconds to 8/7/6 seconds. <Targeted active ability: Activates on full mana> Use Reaper's Scythe to strike an enemy.";
  assert.equal(classifyHistoricalPatchNoteKind(necrophos), "change");
  assert.equal(classifyPatchNoteKind(necrophos, "Necrophos - Reaper's Scythe"), "change");
  assert.equal(
    classifyHistoricalPatchNoteKind("♕Queen Top 20: Badge for S34 ♕Queen: 320 Candies"),
    "change",
  );
  assert.equal(
    classifyPatchNoteKind(
      "Satan, Linken's Sphere, and Bloodstone their special effects or maximum-health-modifying effects missing.",
    ),
    "fix",
  );
});
