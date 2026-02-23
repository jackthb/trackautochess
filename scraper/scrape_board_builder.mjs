/**
 * Scrape the board builder by interacting with filters to trigger data fetches.
 * Intercepts all network responses to capture any JSON piece data.
 * Single page visit.
 */

import puppeteer from "puppeteer";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
mkdirSync(DATA_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

// Capture every JSON response
const captured = [];
page.on("response", async (response) => {
  const url = response.url();
  const ct = response.headers()["content-type"] || "";
  if (ct.includes("json") || url.includes("/api/") || url.includes("_next/data")) {
    try {
      const text = await response.text();
      const json = JSON.parse(text);
      console.log(`  JSON response: ${url} (${text.length} bytes)`);
      captured.push({ url, data: json });
    } catch {}
  }
});

console.log("Navigating to board builder...");
await page.goto("https://www.autochess.site/board-builder", {
  waitUntil: "networkidle2",
  timeout: 30000,
});
await new Promise((r) => setTimeout(r, 3000));

// Screenshot what we see before interaction
await page.screenshot({ path: resolve(DATA_DIR, "board_builder_initial.png") });

// Find all clickable filter elements — cost buttons, synergy tabs, etc.
const clickables = await page.evaluate(() => {
  const results = [];
  // Buttons, tabs, filter chips
  const els = document.querySelectorAll("button, [role='tab'], [role='button'], [class*='filter'], [class*='tab'], [class*='cost'], [class*='tier']");
  for (const el of els) {
    const text = el.innerText?.trim();
    if (text && text.length < 50) {
      results.push({ text, tag: el.tagName, classes: el.className.slice(0, 80) });
    }
  }
  return results;
});

console.log(`\nFound ${clickables.length} clickable elements:`);
clickables.forEach((c) => console.log(`  [${c.tag}] "${c.text}" — ${c.classes}`));

// Try clicking each button and wait for network activity
const buttons = await page.$$("button");
console.log(`\nClicking ${buttons.length} buttons to trigger data fetches...`);

for (let i = 0; i < Math.min(buttons.length, 20); i++) {
  try {
    const text = await buttons[i].evaluate((el) => el.innerText?.trim());
    if (!text) continue;
    console.log(`  Clicking: "${text}"`);
    await buttons[i].click();
    await new Promise((r) => setTimeout(r, 800));
  } catch {}
}

// Final screenshot
await page.screenshot({ path: resolve(DATA_DIR, "board_builder_after_clicks.png"), fullPage: true });

// Also grab whatever text rendered
const bodyText = await page.evaluate(() => document.body.innerText);
console.log("\nBody text after interaction:");
console.log(bodyText.slice(0, 2000));

await browser.close();

// Save results
if (captured.length > 0) {
  console.log(`\nCaptured ${captured.length} JSON responses:`);
  captured.forEach((c, i) => {
    console.log(`  ${i}: ${c.url}`);
    writeFileSync(resolve(DATA_DIR, `board_builder_api_${i}.json`), JSON.stringify(c.data, null, 2));
  });
} else {
  console.log("\nNo JSON API responses captured — data is client-side only");
}

writeFileSync(resolve(DATA_DIR, "board_builder_bodytext.txt"), bodyText);
console.log("Written: board_builder_bodytext.txt");
