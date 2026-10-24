import assert from "node:assert/strict";
import test from "node:test";

import { entryDetailForDisplay, entryTextForMeta } from "./patchEntryText.mjs";

test("hides an exact repeat and keeps a suffix after the name", () => {
  assert.equal(entryDetailForDisplay("Fix bug", "Fix bug"), "");
  assert.equal(entryDetailForDisplay("Fix bug", "Fix bug!"), "");
  assert.equal(
    entryDetailForDisplay(
      "Pass priorities are currently unavailable.",
      "Pass priorities are currently unavailable. We will fix this.",
    ),
    "We will fix this.",
  );
  assert.equal(
    entryDetailForDisplay(
      "S42 Arcade Hunter Season",
      "S42 Arcade Hunter Season (March 1st - April 30th) awards will be granted. Queen Top 20 receives the S41 badge.",
    ),
    "(March 1st - April 30th) awards will be granted. Queen Top 20 receives the S41 badge.",
  );
  assert.equal(entryDetailForDisplay("Knight", "Knightly order added"), "Knightly order added");
  assert.equal(entryDetailForDisplay("Largo", "Health decreased from 800 to 700"), "Health decreased from 800 to 700");
  assert.equal(entryDetailForDisplay("Largo", "   "), "");
});

test("meta description uses the longer text when the detail starts with the name", () => {
  assert.equal(entryTextForMeta("Fix bug", "Fix bug"), "Fix bug");
  assert.equal(
    entryTextForMeta(
      "Pass priorities are currently unavailable.",
      "Pass priorities are currently unavailable. We will fix this.",
    ),
    "Pass priorities are currently unavailable. We will fix this.",
  );
  assert.equal(
    entryTextForMeta("Largo", "Health decreased from 800 to 700"),
    "Largo: Health decreased from 800 to 700",
  );
});
