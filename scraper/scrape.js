/**
 * Scrape autochess.site for current patch unit/item data.
 * Writes to ../data/units.json and ../data/items.json
 *
 * Usage:
 *   node scrape.js               # scrape everything
 *   node scrape.js --target pieces
 *   node scrape.js --target items
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

async function scrapePieces(page) {
  console.log("Scraping pieces from", `${BASE_URL}/pieces`);
  await page.goto(`${BASE_URL}/pieces`, { waitUntil: "networkidle2", timeout: 30000 });

  // Wait for piece data to render
  await page.waitForSelector("[class*='piece'], [class*='hero'], [class*='unit'], table", {
    timeout: 10000,
  }).catch(() => console.warn("Selector timeout — attempting extraction anyway"));

  const raw = await page.evaluate(() => {
    // Dump all visible text and structure for inspection
    return {
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 5000),
      tables: Array.from(document.querySelectorAll("table")).map((t) => t.outerHTML.slice(0, 2000)),
      lists: Array.from(document.querySelectorAll("ul, ol")).map((l) => l.innerText.slice(0, 500)),
    };
  });

  return raw;
}

async function scrapeItems(page) {
  console.log("Scraping items from", `${BASE_URL}/items`);
  await page.goto(`${BASE_URL}/items`, { waitUntil: "networkidle2", timeout: 30000 });

  await page.waitForSelector("[class*='item'], table", {
    timeout: 10000,
  }).catch(() => console.warn("Selector timeout — attempting extraction anyway"));

  const raw = await page.evaluate(() => {
    return {
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 5000),
      tables: Array.from(document.querySelectorAll("table")).map((t) => t.outerHTML.slice(0, 2000)),
    };
  });

  return raw;
}

async function scrapePatchNotes(page) {
  console.log("Scraping patch notes from", `${BASE_URL}/patch-notes`);
  await page.goto(`${BASE_URL}/patch-notes`, { waitUntil: "networkidle2", timeout: 30000 });

  const raw = await page.evaluate(() => {
    return {
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 3000),
    };
  });

  return raw;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const results = {};

    if (target === "all" || target === "pieces") {
      results.pieces = await scrapePieces(page);
      const outPath = resolve(DATA_DIR, "pieces_raw.json");
      writeFileSync(outPath, JSON.stringify(results.pieces, null, 2));
      console.log("Raw pieces data written to", outPath);
    }

    if (target === "all" || target === "items") {
      results.items = await scrapeItems(page);
      const outPath = resolve(DATA_DIR, "items_raw.json");
      writeFileSync(outPath, JSON.stringify(results.items, null, 2));
      console.log("Raw items data written to", outPath);
    }

    if (target === "all" || target === "patches") {
      results.patches = await scrapePatchNotes(page);
      const outPath = resolve(DATA_DIR, "patches_raw.json");
      writeFileSync(outPath, JSON.stringify(results.patches, null, 2));
      console.log("Raw patch data written to", outPath);
    }

    console.log("\nDone. Review *_raw.json files to build structured parsers.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
