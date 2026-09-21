import assert from "node:assert/strict";
import test from "node:test";
import { loopbackDesktopReturnTo } from "./desktopReturnTo";

test("desktop login preserves callback path and state through both web validations", () => {
  const returnTo = "http://127.0.0.1:27034/steam/callback?state=0123456789abcdef";
  const startValidated = loopbackDesktopReturnTo(returnTo);
  assert.equal(startValidated, returnTo);
  // The entry route places this value on Steam's return_to URL. The callback
  // validates it again before appending session parameters to that same URL.
  const steamCallback = new URL("https://www.trackautochess.test/api/auth/steam/callback");
  steamCallback.searchParams.set("desktop_return_to", startValidated!);
  const callbackValidated = loopbackDesktopReturnTo(steamCallback.searchParams.get("desktop_return_to"));
  assert.equal(callbackValidated, returnTo);
  const finalRedirect = new URL(callbackValidated!);
  finalRedirect.searchParams.set("access_token", "test-token");
  assert.equal(finalRedirect.pathname, "/steam/callback");
  assert.equal(finalRedirect.searchParams.get("state"), "0123456789abcdef");
});

test("web return validation retains legacy clients and rejects remote destinations", () => {
  assert.equal(loopbackDesktopReturnTo("http://127.0.0.1:27034"), "http://127.0.0.1:27034/");
  for (const value of ["https://127.0.0.1:27034/", "http://example.com/", "http://user:password@127.0.0.1/"]) {
    assert.equal(loopbackDesktopReturnTo(value), null);
  }
});
