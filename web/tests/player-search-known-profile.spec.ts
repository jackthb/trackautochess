import { expect, test } from "@playwright/test";

const knownPlayer = {
  steam_id: "76561198022169086",
  name: "Jack",
  custom_url: "jackc",
  has_autochess_profile: true,
  has_games: true,
  drodo_profile_missing: false,
};

test("known Steam profile URLs resolve to cached users without the Steam fallback", async ({
  page,
}) => {
  const steamFallbackRequests: string[] = [];

  await page.route("**/api/players/search**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") ?? "";

    if (url.searchParams.get("steam") === "1") {
      steamFallbackRequests.push(route.request().url());
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(query ? [knownPlayer] : []),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page
    .getByPlaceholder("Steam profile URL or SteamID64")
    .fill(`https://steamcommunity.com/profiles/${knownPlayer.steam_id}`);

  await expect(page.getByText(knownPlayer.name)).toBeVisible();
  await expect(page.getByText("Search with Steam")).toBeHidden();
  expect(steamFallbackRequests).toEqual([]);
});
