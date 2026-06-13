import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("Queens page renders and can call the refresh endpoint from the browser", async ({
  page,
}) => {
  let refreshCalls = 0;

  await page.route("**/api/queens/refresh", async (route) => {
    refreshCalls += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        polled: 1,
        ok: 1,
        missing: 0,
        upstream_error: 0,
      }),
    });
  });

  await page.goto("/queens", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Queen Players" })).toBeVisible();
  const response = await page.evaluate(async () => {
    const resp = await fetch("/api/queens/refresh", { method: "POST" });
    return { ok: resp.ok, body: await resp.json() };
  });
  expect(response).toEqual({
    ok: true,
    body: { polled: 1, ok: 1, missing: 0, upstream_error: 0 },
  });
  expect(refreshCalls).toBe(1);
});

test("player page exposes the profile refresh surface", async ({ page }) => {
  const playerPath =
    process.env.SMOKE_PLAYER_PATH ?? "/players/76561198237138642";

  await page.goto(playerPath, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Last fetched")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Checking|Refresh Stats|Refreshing/ })
  ).toBeVisible();
});
