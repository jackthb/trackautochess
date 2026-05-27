#!/usr/bin/env node
/**
 * Scrape DAC patch notes from the Steam Workshop changelog.
 *
 * Fetches the changelog page, parses entries, diffs against index.json,
 * and writes new patch JSON files.
 *
 * Usage:
 *   node scripts/scrape-patch-notes.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "patch_notes");
const INDEX_PATH = join(DATA_DIR, "index.json");
const CHANGELOG_URL =
  "https://steamcommunity.com/sharedfiles/filedetails/changelog/1613886175";

const DRY_RUN = process.argv.includes("--dry-run");

async function fetchChangelog() {
  const resp = await fetch(CHANGELOG_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching changelog`);
  return resp.text();
}

function parseChangelogEntries(html) {
  const entries = [];
  const currentYear = new Date().getFullYear();

  // Split by changelog entry containers
  const blocks = html.split(/changeLogCtn/);

  for (const block of blocks) {
    // Match: "Update: 25 May @ 1:45am" or "Update: 29 Apr @ 8:10am"
    const dateMatch = block.match(
      /Update:\s*(\d+)\s+(\w+)\s*@\s*([\d:]+[ap]m)/i
    );
    if (!dateMatch) continue;

    const day = dateMatch[1];
    const month = dateMatch[2];
    const time = dateMatch[3];

    const parsed = new Date(`${month} ${day}, ${currentYear}`);
    if (isNaN(parsed.getTime())) continue;
    const isoDate = parsed.toISOString().split("T")[0];

    // Extract content from <p id="...">content</p>
    const contentMatch = block.match(/<p\s+id="[^"]*">([\s\S]*?)<\/p>/i);
    if (!contentMatch) continue;

    let content = contentMatch[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/●\s*/g, "")
      .trim();

    if (!content) continue;

    entries.push({ date: isoDate, time, content });
  }

  return entries;
}

function classifyEntry(line) {
  const l = line.toLowerCase();
  if (l.includes("rework")) return "change";
  if (l.includes("added") || l.includes("new ")) return "new";
  if (l.includes("removed") || l.includes("temporarily removed"))
    return "removed";
  if (l.includes("fix")) return "fix";
  if (
    l.includes("increased") ||
    l.includes("bonus") ||
    l.includes("duration increased") ||
    l.includes("radius increased")
  )
    return "buff";
  if (
    l.includes("decreased") ||
    l.includes("reduced") ||
    l.includes("downgrade") ||
    l.includes("nerfed")
  )
    return "nerf";
  return "change";
}

function contentToSections(content) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const entries = [];
  for (const line of lines) {
    const match = line.match(/^([^:–—]+?)\s*[:–—]\s*(.+)$/);
    if (match) {
      entries.push({
        kind: classifyEntry(line),
        name: match[1].trim(),
        detail: match[2].trim(),
      });
    } else {
      entries.push({
        kind: classifyEntry(line),
        name: line.length > 60 ? line.slice(0, 50) + "…" : line,
        detail: line,
      });
    }
  }

  return [{ heading: "Changes", entries }];
}

async function main() {
  console.log("Fetching Steam Workshop changelog...");
  const html = await fetchChangelog();

  console.log("Parsing entries...");
  const entries = parseChangelogEntries(html);
  console.log(`Found ${entries.length} changelog entries on page 1`);

  const index = JSON.parse(readFileSync(INDEX_PATH, "utf-8"));
  const existingDates = new Set(index.patches.map((p) => p.date));
  const existingSlugs = new Set(index.patches.map((p) => p.slug));

  // Group by date, skip existing
  const byDate = new Map();
  for (const entry of entries) {
    if (existingDates.has(entry.date)) continue;
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }

  if (byDate.size === 0) {
    console.log("No new patches found.");
    return;
  }

  console.log(`${byDate.size} new patch date(s) to add`);

  const newPatches = [];

  for (const [date, dayEntries] of byDate) {
    const combined = dayEntries.map((e) => e.content).join("\n\n");
    const title = "Rebalance Patch";
    let slug = `${date}-rebalance-patch`;
    if (existingSlugs.has(slug)) continue;
    const filePath = join(DATA_DIR, `${slug}.json`);

    const patchData = {
      date,
      title,
      source: CHANGELOG_URL,
      sections: contentToSections(combined),
    };

    if (DRY_RUN) {
      console.log(`\n[dry-run] Would write ${slug}.json:`);
      console.log(JSON.stringify(patchData, null, 2));
    } else {
      writeFileSync(filePath, JSON.stringify(patchData, null, 2) + "\n");
      console.log(`Wrote ${slug}.json`);
    }

    newPatches.push({ date, title, slug });
  }

  if (!DRY_RUN && newPatches.length > 0) {
    newPatches.sort((a, b) => b.date.localeCompare(a.date));
    index.patches = [...newPatches, ...index.patches];
    writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
    console.log(`Updated index.json with ${newPatches.length} new patch(es)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
