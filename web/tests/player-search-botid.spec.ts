import { expect, test } from "@playwright/test";

// Regression guard for the App Router migration: the client half of Vercel
// BotId (`<BotIdClient>`) used to live in pages/_app.tsx. When that file was
// deleted, BotIdClient was dropped from the chrome, so requests to the
// protected routes carried no verification token — the server's checkBotId
// then 403'd real users and player search showed "We didn't find any users."
//
// BotIdClient injects an inline <script> that configures protection (and
// references x-is-human / the protected paths). Asserting that script is
// present is a robust check that survives botid version churn, unlike driving
// botid's full challenge/KPSDK flow through the browser.
test("player search route is BotId-protected (BotIdClient is mounted)", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // The home search box renders.
  await expect(
    page.getByPlaceholder("Steam profile URL or SteamID64")
  ).toBeVisible();

  // BotIdClient must inject its protection config covering /api/players/search.
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
});
