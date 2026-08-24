import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  chatQueryTokens,
  levenshtein,
  matchSynergies,
  scoreSynergyQuery,
  type SynergyQueryTarget,
} from "./matchSynergies";

const CATALOG: SynergyQueryTarget[] = [
  { name: "Human", slug: "human" },
  { name: "Mage", slug: "mage" },
  { name: "Demon", slug: "demon" },
  { name: "Demon Hunter", slug: "demon-hunter" },
  { name: "Hunter", slug: "hunter" },
  { name: "God", slug: "god" },
];

describe("chatQueryTokens", () => {
  test("normalizes plurals and multi-word names", () => {
    const tokens = chatQueryTokens("How do I play Demon Hunters?");
    assert.ok(tokens.includes("demon"));
    assert.ok(tokens.includes("hunter"));
    assert.ok(tokens.includes("demon-hunter"));
  });
});

describe("levenshtein", () => {
  test("counts single-character typos", () => {
    assert.equal(levenshtein("human", "human"), 0);
    assert.equal(levenshtein("humman", "human"), 1);
    assert.equal(levenshtein("damage", "mage"), 2);
  });
});

describe("scoreSynergyQuery", () => {
  test("matches humans to Human", () => {
    assert.equal(scoreSynergyQuery("How do I play Humans?", CATALOG[0]), 90);
  });

  test("does not treat damage as Mage", () => {
    assert.equal(scoreSynergyQuery("What is damage?", CATALOG[1]), 0);
  });

  test("fuzzy-matches a close misspelling", () => {
    const score = scoreSynergyQuery("How do I play humman?", CATALOG[0]);
    assert.ok(score > 0);
    assert.ok(score < 90);
  });
});

describe("matchSynergies", () => {
  test("returns Human for a humans question", () => {
    const matches = matchSynergies("How do I play Humans?", CATALOG);
    assert.equal(matches[0]?.synergy.slug, "human");
  });

  test("prefers Demon Hunter when both words are present", () => {
    const matches = matchSynergies("How do I play demon hunters?", CATALOG);
    assert.equal(matches[0]?.synergy.slug, "demon-hunter");
    assert.equal(
      matches.some((match) => match.synergy.slug === "demon"),
      false,
    );
    assert.equal(
      matches.some((match) => match.synergy.slug === "hunter"),
      false,
    );
  });

  test("does not match Demon Hunter for demons alone", () => {
    const matches = matchSynergies("How do I play demons?", CATALOG);
    assert.equal(matches[0]?.synergy.slug, "demon");
    assert.equal(
      matches.some((match) => match.synergy.slug === "demon-hunter"),
      false,
    );
  });

  test("returns nothing when no synergy is mentioned", () => {
    const matches = matchSynergies("What is the current patch?", CATALOG);
    assert.equal(matches.length, 0);
  });
});
