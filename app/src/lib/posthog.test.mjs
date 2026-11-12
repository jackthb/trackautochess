import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Run the real lazy lifecycle with a fake SDK, without collecting telemetry.
// Vite normally replaces import.meta.env; substitute its build-time value here.
function loadModule(url, requireMock, env = {}) {
  const source = readFileSync(url, "utf8").replaceAll("import.meta.env", JSON.stringify(env));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(requireMock, module, module.exports);
  return module.exports;
}

test("desktop initialization disables replay while ordinary analytics still work", async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  let config;
  let initCount = 0;
  const events = [];
  const client = {
    init: (_key, options) => { config = options; initCount++; },
    register: (properties) => assert.deepEqual(properties, { source: "desktop_app" }),
    startSessionRecording: () => assert.fail("Replay must not be started"),
    capture: (...args) => events.push(args),
    identify: () => {},
    reset: () => {},
  };
  const shared = loadModule(new URL("../../../shared/posthog.ts", import.meta.url), () => {
    throw new Error("Unexpected shared dependency");
  });
  const bindings = loadModule(new URL("./posthog.ts", import.meta.url), (id) => {
    if (id === "@dac/shared/posthog") return shared;
    if (id === "posthog-js/dist/module.full.no-external") return { default: client };
    throw new Error(`Unexpected dependency: ${id}`);
  });
  assert.equal(await bindings.getPostHog(), client);
  assert.equal(config.disable_session_recording, true);
  assert.equal(config.session_recording.maskAllInputs, true);
  assert.equal(config.session_recording.maskTextSelector, "*");
  bindings.capture("tab_viewed", { tab: "history" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [["tab_viewed", { tab: "history" }]]);
  assert.equal(initCount, 1);

  const disabledBindings = loadModule(new URL("./posthog.ts", import.meta.url), (id) => {
    if (id === "@dac/shared/posthog") return shared;
    assert.fail("A blank analytics token must prevent loading the SDK");
  }, { VITE_POSTHOG_DESKTOP_TOKEN: "" });
  assert.equal(await disabledBindings.getPostHog(), null);
});
