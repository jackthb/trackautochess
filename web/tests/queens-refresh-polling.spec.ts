import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("Queens page renders and shows background refresh status", async ({
  page,
}) => {
  let refreshCalls = 0;
  let releaseRefresh: () => void = () => {};
  const refreshStarted = new Promise<void>((resolve) => {
    void page.route("**/api/queens/refresh", async (route) => {
      refreshCalls += 1;
      resolve();
      await new Promise<void>((release) => {
        releaseRefresh = release;
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          polled: 1,
          ok: 1,
          missing: 0,
          upstream_error: 0,
          changed: 1,
          checked_at: "2099-01-01T00:00:00.000Z",
        }),
      });
    });
  });

  await page.addInitScript(() => {
    Date.now = () => new Date("2099-01-01T00:00:00.000Z").getTime();
  });

  await page.goto("/queens", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Queen Players" })).toBeVisible();
  await refreshStarted;
  await expect(page.getByRole("status")).toHaveText("Refreshing Queen profiles...");
  releaseRefresh();
  await expect(page.getByRole("status")).toHaveText(
    "Profiles refreshed. Updating table..."
  );
  expect(refreshCalls).toBe(1);
});

test("Queens page records no-change refresh checks without table updates", async ({
  page,
}) => {
  await page.route("**/api/queens/refresh", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        polled: 1,
        ok: 1,
        missing: 0,
        upstream_error: 0,
        changed: 0,
        checked_at: "2099-01-01T00:00:00.000Z",
      }),
    });
  });

  await page.addInitScript(() => {
    Date.now = () => new Date("2099-01-01T00:00:00.000Z").getTime();
  });

  await page.goto("/queens", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Queen Players" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Queen profiles are already current."
  );
  await expect(page.getByText("5m 00s")).toBeVisible();
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
