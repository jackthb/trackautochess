import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildChatSystemPrompt,
  buildGenericChatSystemPrompt,
  buildRagChatSystemPrompt,
} from "./prompt";
import type { MatchedContentDoc } from "./types";

const sampleDoc: MatchedContentDoc = {
  id: "synergy:human",
  docType: "synergy",
  title: "Human",
  content: "Humans gain extra gold when they win rounds.",
  urlPath: "/synergies/human",
  similarity: 0.91,
};

describe("buildGenericChatSystemPrompt", () => {
  test("asks for game-focused answers with an uncertainty warning", () => {
    const prompt = buildGenericChatSystemPrompt();
    assert.match(prompt, /Track Auto Chess/);
    assert.match(prompt, /Drodo Studio/);
    assert.match(prompt, /Dota 2 Auto Chess mod/);
    assert.match(prompt, /synergies/);
    assert.match(prompt, /If you are unsure, say so/);
    assert.match(prompt, /Do not use emoji/);
    assert.doesNotMatch(prompt, /beta assistant/i);
    assert.doesNotMatch(prompt, /retrieved documents/i);
  });
});

describe("buildRagChatSystemPrompt", () => {
  test("keeps document-only citation rules and includes retrieved docs", () => {
    const prompt = buildRagChatSystemPrompt([sampleDoc]);
    assert.match(prompt, /ONLY the retrieved documents/);
    assert.match(prompt, /Do not invent game mechanics/);
    assert.match(prompt, /\[Human\]\(\/synergies\/human\)/);
    assert.match(prompt, /Humans gain extra gold/);
    assert.match(prompt, /Link: \/synergies\/human/);
  });
});

describe("buildChatSystemPrompt", () => {
  test("uses generic mode when no docs are present", () => {
    const prompt = buildChatSystemPrompt({
      docs: [],
    });
    assert.equal(prompt, buildGenericChatSystemPrompt());
    assert.doesNotMatch(prompt, /Humans gain extra gold/);
  });

  test("uses grounded mode when synergy docs are present", () => {
    const prompt = buildChatSystemPrompt({
      docs: [sampleDoc],
    });
    assert.match(prompt, /Documents below are ordered: build guides/);
    assert.match(prompt, /Humans gain extra gold/);
    assert.match(prompt, /\[Human\]\(\/synergies\/human\)/);
  });

  test("uses RAG mode when enabled without docs", () => {
    const prompt = buildChatSystemPrompt({
      ragEnabled: true,
    });
    assert.equal(prompt, buildRagChatSystemPrompt([]));
  });
});
