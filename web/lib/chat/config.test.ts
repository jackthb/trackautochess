import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CHAT_DEFAULT_GENERATION_MODEL,
  chatGenerationModelId,
} from "./config";

describe("chatGenerationModelId", () => {
  test("defaults to the current low-cost Alibaba flash model", () => {
    assert.equal(chatGenerationModelId({}), CHAT_DEFAULT_GENERATION_MODEL);
    assert.equal(CHAT_DEFAULT_GENERATION_MODEL, "alibaba/qwen3.7-flash");
  });

  test("uses a trimmed CHAT_GENERATION_MODEL override", () => {
    assert.equal(
      chatGenerationModelId({ CHAT_GENERATION_MODEL: " openai/gpt-5.4 " }),
      "openai/gpt-5.4",
    );
  });
});
