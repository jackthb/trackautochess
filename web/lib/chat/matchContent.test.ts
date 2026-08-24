import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { matchContentDocs, scoreGuideQuery } from "./matchContent";

describe("scoreGuideQuery", () => {
  test("matches hunters to the 9 Hunters guide without requiring the 9", () => {
    const score = scoreGuideQuery("How do I play hunters?", {
      name: "9 Hunters",
      slug: "9-hunters",
    });
    assert.ok(score >= 70);
  });

  test("does not treat how-to-play as a match for a named synergy question", () => {
    const score = scoreGuideQuery("How do I play Humans?", {
      name: "How To Play Dota Auto Chess — A Beginner's Guide",
      slug: "how-to-play",
    });
    assert.equal(score, 0);
  });
});

describe("matchContentDocs", () => {
  test("stacks a hunters guide on top of the Hunter synergy", () => {
    const docs = matchContentDocs("How do I play hunters?");
    assert.equal(docs[0]?.docType, "guide");
    assert.equal(docs[0]?.id, "guide:9-hunters");
    assert.ok(docs.some((doc) => doc.id === "synergy:hunter"));
  });

  test("looks up Human synergy without pulling the beginner guide", () => {
    const docs = matchContentDocs("How do I play Humans?");
    assert.ok(docs.some((doc) => doc.id === "synergy:human"));
    assert.equal(
      docs.some((doc) => doc.id === "guide:how-to-play"),
      false,
    );
  });

  test("looks up a named item", () => {
    const docs = matchContentDocs("What does Telescope do?");
    assert.ok(docs.some((doc) => doc.id === "item:telescope"));
  });

  test("looks up a named unit", () => {
    const docs = matchContentDocs("What does Sniper do?");
    assert.ok(docs.some((doc) => doc.id === "unit:sniper"));
  });

  test("returns nothing when no named content is mentioned", () => {
    const docs = matchContentDocs("What is the current patch?");
    assert.equal(docs.length, 0);
  });
});
