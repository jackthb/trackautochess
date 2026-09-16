import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isForeignScriptException } from "./posthog";

// The real injected frame captured on /creators: its filename is the page
// document, and it carries `in_app: true`.
const documentFrame = {
  filename: "https://www.trackautochess.com/creators",
  function: "global code",
  in_app: true,
  lineno: 1,
  colno: 19,
};

const bundleFrame = {
  filename: "https://www.trackautochess.com/_next/static/chunks/main.js",
  function: "onClick",
  in_app: true,
  lineno: 42,
  colno: 7,
};

function exceptionEvent(frames: unknown[], value = "boom") {
  return {
    event: "$exception",
    properties: {
      $current_url: documentFrame.filename,
      $exception_list: [
        { type: "TypeError", value, stacktrace: { type: "raw", frames } },
      ],
    },
  };
}

describe("isForeignScriptException", () => {
  test("drops the known Firefox reader error in the page document", () => {
    assert.equal(isForeignScriptException(exceptionEvent(
      [documentFrame], "undefined is not an object (evaluating 'window.__firefox__.reader')",
    )), true);
  });

  test("keeps unknown inline, native and source-file errors", () => {
    for (const frame of [documentFrame, { function: "native" }, { filename: "webpack://app/page.tsx" }]) {
      assert.equal(isForeignScriptException(exceptionEvent([frame])), false);
    }
  });

  test("drops extension-only stacks", () => {
    assert.equal(isForeignScriptException(exceptionEvent([
      { filename: "chrome-extension://abc/script.js" },
    ])), true);
  });

  test("keeps a mixed extension and application stack", () => {
    assert.equal(isForeignScriptException(exceptionEvent([
      { filename: "moz-extension://abc/script.js" }, bundleFrame,
    ])), false);
  });

  test("keeps an error chain containing an unknown frameless cause", () => {
    const event = exceptionEvent([{ filename: "chrome-extension://abc/script.js" }]);
    event.properties.$exception_list.push({
      type: "Error", value: "application failure", stacktrace: { type: "raw", frames: [] },
    });
    assert.equal(isForeignScriptException(event), false);
  });

  test("keeps an exception with a frame from our /_next/ bundle", () => {
    assert.equal(
      isForeignScriptException(exceptionEvent([documentFrame, bundleFrame])),
      false
    );
  });

  test("keeps a frameless exception", () => {
    assert.equal(isForeignScriptException(exceptionEvent([])), false);
  });

  test("keeps non-exception events", () => {
    assert.equal(
      isForeignScriptException({ event: "$pageview", properties: {} }),
      false
    );
  });
});
