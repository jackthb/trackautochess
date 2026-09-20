import { expect, test } from "@playwright/test";

const knownPlayer = {
  steam_id: "76561198000000001",
  name: "Example Player",
  custom_url: "example-player",
  has_autochess_profile: true,
  has_games: true,
  drodo_profile_missing: false,
};

test("submitted Steam profile URLs navigate to the resolved player", async ({
  page,
}) => {
  const lookupRequests: string[] = [];

  await page.route("**/api/players/search**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") ?? "";

    if (url.searchParams.get("steam") === "1") {
      lookupRequests.push(query);
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

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/players/${knownPlayer.custom_url}$`));
  expect(lookupRequests).toEqual([
    `https://steamcommunity.com/profiles/${knownPlayer.steam_id}`,
  ]);
});
