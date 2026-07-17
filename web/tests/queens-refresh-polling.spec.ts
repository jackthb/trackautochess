import { expect, test } from "@playwright/test";
import { QUEENS_DRODO_VIEW_REFRESH_ENABLED } from "../lib/queensVisitor";

test.describe.configure({ mode: "serial" });

test("Queens page renders the saved ladder snapshot", async ({ page }) => {
  let refreshCalls = 0;
  await page.route("**/api/queens/refresh", async (route) => {
    refreshCalls += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        disabled: true,
        polled: 0,
        ok: 0,
        missing: 0,
        upstream_error: 0,
        changed: 0,
        checked_at: null,
      }),
    });
  });

  await page.goto("/queens", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Queen Players" })).toBeVisible();
  await expect(page.getByText(/Ranks come from the in-game Queen ladder capture/i)).toBeVisible();

  if (!QUEENS_DRODO_VIEW_REFRESH_ENABLED) {
    expect(refreshCalls).toBe(0);
    await expect(page.getByRole("status")).not.toHaveText(
      "Refreshing Queen profiles..."
    );
  }
});

test("player page exposes the profile refresh surface", async ({ page }) => {
  const playerPath =
    process.env.SMOKE_PLAYER_PATH ?? "/players/76561198237138642";

  await page.goto(playerPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible();
});
