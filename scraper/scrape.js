/**
 * Scrape autochess.site for current patch unit/item data.
 * Intercepts XHR/fetch responses to capture API calls,
 * and falls back to DOM extraction if needed.
 *
 * Writes raw data to ../data/ for inspection.
 *
 * Usage:
 *   node scrape.js               # scrape everything
 *   node scrape.js --target pieces
 *   node scrape.js --target items
 *   node scrape.js --target patches
 */

import puppeteer from "puppeteer";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const BASE_URL = "https://www.autochess.site";

const args = process.argv.slice(2);
const target = args.includes("--target") ? args[args.indexOf("--target") + 1] : "all";

function save(filename, data) {
  const outPath = resolve(DATA_DIR, filename);
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`  Written: ${outPath}`);
}

async function scrapePage(browser, path) {
  const url = `${BASE_URL}${path}`;
  console.log(`\nFetching ${url}`);

  const page = await browser.newPage();
  const intercepted = [];

  // Intercept all responses — capture any JSON that looks like game data
  page.on("response", async (response) => {
    const resUrl = response.url();
    const contentType = response.headers()["content-type"] || "";
    if (contentType.includes("application/json") || resUrl.includes("/api/")) {
      try {
        const text = await response.text();
        const json = JSON.parse(text);
        intercepted.push({ url: resUrl, data: json });
        console.log(`  Intercepted JSON: ${resUrl} (${text.length} bytes)`);
      } catch {
        // not valid JSON, skip
      }
    }
  });

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

  // Give React/Next.js extra time to hydrate
  await new Promise((r) => setTimeout(r, 3000));

  // Take a screenshot so we can see what rendered
  const screenshotPath = resolve(DATA_DIR, `screenshot${path.replace(/\//g, "_")}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`  Screenshot: ${screenshotPath}`);

  // Extract all visible text content and any structured data attributes
  const dom = await page.evaluate(() => {
    // Try common data attribute patterns used by React apps
    const dataAttrs = Array.from(document.querySelectorAll("[data-piece], [data-unit], [data-hero], [data-item]"))
      .map((el) => el.outerHTML.slice(0, 500));

    // Grab all text content grouped by tag
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"))
      .map((el) => el.innerText.trim())
      .filter(Boolean);

    const bodyText = document.body.innerText;

    // Look for Next.js / Nuxt hydration data in script tags
    const scripts = Array.from(document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__"))
      .map((s) => s.textContent.slice(0, 10000));

    // Grab all table data if present
    const tables = Array.from(document.querySelectorAll("table")).map((t) => ({
      headers: Array.from(t.querySelectorAll("th")).map((th) => th.innerText.trim()),
      rows: Array.from(t.querySelectorAll("tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.trim())
      ).filter((r) => r.length > 0),
    }));

    // Grab all list items
    const listItems = Array.from(document.querySelectorAll("li"))
      .map((li) => li.innerText.trim())
      .filter((t) => t.length > 0 && t.length < 200);

    return { headings, bodyText: bodyText.slice(0, 10000), dataAttrs, scripts, tables, listItems };
  });

  await page.close();
  return { url, intercepted, dom };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const pages = {
      pieces: "/pieces",
      items: "/items",
      patches: "/patch-notes",
    };

    for (const [name, path] of Object.entries(pages)) {
      if (target !== "all" && target !== name) continue;

      const result = await scrapePage(browser, path);
      save(`${name}_raw.json`, result);

      if (result.intercepted.length > 0) {
        console.log(`  Found ${result.intercepted.length} API response(s) for ${name}`);
        result.intercepted.forEach((r, i) => save(`${name}_api_${i}.json`, r.data));
      } else {
        console.log(`  No API responses intercepted for ${name} — see screenshot`);
      }

      // Print first 500 chars of body text so we can see what rendered
      console.log(`\n  Body preview:\n  ${result.dom.bodyText.slice(0, 500).replace(/\n/g, "\n  ")}`);
    }
  } finally {
    await browser.close();
  }

  console.log("\nDone. Check data/*_raw.json and data/screenshot_*.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
