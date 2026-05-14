import { expect, test } from "@playwright/test";

test("player search sends BotID headers from the first GUI lookup", async ({
  page,
}) => {
  const searchRequests: Array<{
    headers: Record<string, string>;
    url: string;
  }> = [];

  await page.route(
    /\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]+\/c\.js(?:\?.*)?$/,
    async (route) => {
      await route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C && window.V_C.push({ b: 1, d: 0 });",
      });
    }
  );

  await page.route("**/api/players/search**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.searchParams.has("q")) {
      searchRequests.push({
        headers: request.headers(),
        url: request.url(),
      });
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          steam_id: "76561198022169086",
          name: "Search Probe",
          custom_url: "search-probe",
          has_autochess_profile: true,
          drodo_profile_missing: false,
        },
      ]),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const searchInput = page.getByPlaceholder("Steam profile URL or SteamID64");
  await expect(searchInput).toBeVisible();

  const botIdScriptCount = await page.locator("script").evaluateAll((scripts) =>
    scripts.filter((script) => {
      const source = script.textContent ?? "";
      return (
        source.includes("x-is-human") &&
        source.includes("/api/players/search")
      );
    }).length
  );
  expect(botIdScriptCount).toBeGreaterThan(0);

  await searchInput.fill("search-probe");
  await expect(page.getByText("Search Probe")).toBeVisible();

  await expect.poll(() => searchRequests.length).toBeGreaterThan(0);

  const [request] = searchRequests;
  expect(request.url).toContain("/api/players/search?q=search-probe");
  expect(request.headers["x-path"]).toBe("/api/players/search");
  expect(request.headers["x-method"]).toBe("GET");
  expect(JSON.parse(request.headers["x-is-human"])).toMatchObject({
    b: 1,
    d: 0,
  });
});
