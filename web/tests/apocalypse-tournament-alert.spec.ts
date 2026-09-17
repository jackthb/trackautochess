import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`home at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("keeps signup and player lookup available without the expired tournament notice", async ({
      page,
    }) => {
      await page.goto("/");

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        /Track\s*Auto Chess/i,
      );
      await expect(
        page.getByRole("textbox", { name: "Email address", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Sign up", exact: true }),
      ).toBeEnabled();

      const search = page.getByPlaceholder("Steam profile URL or SteamID64", {
        exact: true,
      });
      await expect(search).toBeVisible();
      await search.fill("invalid steam profile!");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(search).toHaveAttribute("aria-invalid", "true");
      await expect(
        page.getByText("Enter a SteamID64, vanity name, or profile URL.", {
          exact: true,
        }),
      ).toBeVisible();

      await expect(
        page.getByRole("link", {
          name: "Join the Apocalypse Tournament Discord",
        }),
      ).toHaveCount(0);
      await expect(page.getByText(/Apocalypse Tournament/)).toHaveCount(0);
    });
  });
}
