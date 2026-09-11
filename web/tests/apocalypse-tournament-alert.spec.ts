import { expect, test } from "@playwright/test";

test("home alert links to the Apocalypse Tournament Discord", async ({
  page,
}) => {
  await page.goto("/");

  const alert = page.getByRole("link", {
    name: "Join the Apocalypse Tournament Discord",
  });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute(
    "href",
    "https://discord.gg/rGtg2yJdS",
  );
  await expect(alert).toHaveAttribute("target", "_blank");
  await expect(alert).toHaveAttribute("rel", "noopener noreferrer");
  await expect(alert).toContainText("Apocalypse Tournament");
  await expect(alert).toContainText("11–13 September");
  await expect(alert).toContainText("hosted by Dumpstered & Arthur");
  await expect(alert).toContainText("Join on Discord");
  const strip = page.getByRole("status");
  const palette = await strip.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text-secondary)";
    probe.style.background =
      "color-mix(in srgb, var(--gold) 8%, transparent)";
    probe.style.borderBottom =
      "1px solid color-mix(in srgb, var(--gold) 35%, var(--border))";
    element.appendChild(probe);

    const actual = getComputedStyle(element);
    const expected = getComputedStyle(probe);
    const result = {
      actual: {
        backgroundColor: actual.backgroundColor,
        backgroundImage: actual.backgroundImage,
        borderBottomColor: actual.borderBottomColor,
        color: actual.color,
      },
      expected: {
        backgroundColor: expected.backgroundColor,
        backgroundImage: expected.backgroundImage,
        borderBottomColor: expected.borderBottomColor,
        color: expected.color,
      },
    };

    probe.remove();
    return result;
  });
  expect(palette.actual).toEqual(palette.expected);

  const goldColor = await alert.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--gold)";
    element.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await alert.hover();
  await expect(alert).toHaveCSS("color", goldColor);
  await page.mouse.move(0, 0);
  await alert.focus();
  await expect(alert).toHaveCSS("color", goldColor);
  await expect(alert).toHaveCSS("outline-color", goldColor);

  await expect(
    page.getByRole("region", { name: "Featured tournament" }),
  ).toHaveCount(0);
});
