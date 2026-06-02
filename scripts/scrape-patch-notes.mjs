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

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DATA = join(__dirname, "..", "data");
const DATA_DIR = join(ROOT_DATA, "patch_notes");
const INDEX_PATH = join(DATA_DIR, "index.json");
const ITEMS_PATH = join(ROOT_DATA, "items.json");
const UNITS_FULL_PATH = join(ROOT_DATA, "units_full.json");
const SYNERGIES_PATH = join(ROOT_DATA, "synergies.json");
const CHANGELOG_URL =
  "https://steamcommunity.com/sharedfiles/filedetails/changelog/1613886175";

const DRY_RUN = process.argv.includes("--dry-run");
const CHANGELOG_FILE_ARG = process.argv.find((arg) =>
  arg.startsWith("--changelog-file=")
);
const CHANGELOG_FILE = CHANGELOG_FILE_ARG?.split("=").slice(1).join("=");

async function fetchChangelog() {
  if (CHANGELOG_FILE) return readFileSync(CHANGELOG_FILE, "utf-8");
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

    const monthIndex = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
      .indexOf(month.toLowerCase().slice(0, 3));
    if (monthIndex === -1) continue;
    const isoDate = `${currentYear}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // Extract content from <p id="...">content</p>
    const contentMatch = block.match(/<p\s+id="[^"]*">([\s\S]*?)<\/p>/i);
    if (!contentMatch) continue;

    const rawHtml = contentMatch[1];

    // Extract Google Docs link before stripping HTML.
    // Steam wraps external links in a linkfilter: href="...linkfilter/?u=https%3A%2F%2Fdocs.google.com%2F..."
    let docsUrl = null;
    const docsFilterMatch = rawHtml.match(
      /href="[^"]*linkfilter\/\?u=(https?%3A%2F%2Fdocs\.google\.com%2F[^"&]+)"/i
    );
    if (docsFilterMatch) {
      docsUrl = decodeURIComponent(docsFilterMatch[1]);
    } else {
      const docsDirectMatch = rawHtml.match(
        /href="(https:\/\/docs\.google\.com\/document\/d\/[^"]+\/pub)"/i
      );
      if (docsDirectMatch) docsUrl = docsDirectMatch[1];
    }

    let content = rawHtml
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

    entries.push({ date: isoDate, time, content, docsUrl });
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

async function fetchGoogleDoc(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return resp.text();
  } catch (err) {
    console.warn(`Could not fetch Google Doc ${url}: ${err.message}`);
    return null;
  }
}

function htmlToText(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/●\s*/g, "")
    .trim();
}

const SECTION_PATTERNS = [
  { pattern: /chess\s*piece|unit/i, heading: "Chess Pieces" },
  { pattern: /item/i, heading: "Items" },
  { pattern: /relic/i, heading: "Relics" },
  { pattern: /synergy/i, heading: "Synergy Changes" },
  { pattern: /talent/i, heading: "Talents" },
  { pattern: /bug|fix/i, heading: "Bug Fixes" },
  { pattern: /season|award/i, heading: "Season Awards" },
];

function parseGoogleDoc(html) {
  // Title: first <p> in div.doc-content
  const titleMatch = html.match(
    /class="[^"]*doc-content[^"]*"[^>]*>[\s\S]*?<p[^>]*><span[^>]*>([^<]+)<\/span>/i
  );
  const title = titleMatch ? htmlToText(titleMatch[1]) : "Rebalance Patch";

  // Extract just the doc-content div
  const contentMatch = html.match(
    /<div[^>]*class="[^"]*doc-content[^"]*"[^>]*>([\s\S]*)<\/div>/i
  );
  if (!contentMatch) return { title, sections: [] };
  // Move <hr> tags out of <p> tags so splitting on <hr> doesn't break entries
  const body = contentMatch[1].replace(/<hr\s*\/?>\s*<\/p>/gi, "</p><hr>");

  const chunks = body.split(/<hr\s*\/?>/i);

  const sections = [];
  for (const chunk of chunks) {
    // Find heading — in <h4>, or the first <p> whose text matches a section pattern
    const h4Match = chunk.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    let rawHeading = h4Match ? htmlToText(h4Match[1]) : null;

    if (!rawHeading) {
      const pTags = [...chunk.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
      for (const p of pTags) {
        const text = htmlToText(p[1]);
        if (text && SECTION_PATTERNS.some((s) => s.pattern.test(text))) {
          rawHeading = text;
          break;
        }
      }
    }
    if (!rawHeading) continue;

    const sectionDef = SECTION_PATTERNS.find((s) => s.pattern.test(rawHeading));
    if (!sectionDef) continue;

    const section = { heading: sectionDef.heading, entries: [] };

    // Find all <p> tags with ● bullets (main entries)
    const entryRegex = /<p[^>]*>(?:<span[^>]*>)?●\s*(?:<\/span>)?\s*([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = entryRegex.exec(chunk)) !== null) {
      const entryHtml = m[1];
      const entryText = htmlToText(entryHtml);

      const parsed = entryText.match(/^([^:–—]+?)\s*[:–—]\s*(.+)$/);
      if (parsed) {
        section.entries.push({
          kind: classifyEntry(entryText),
          name: parsed[1].trim(),
          detail: parsed[2].trim(),
        });
      } else if (entryText.length > 3) {
        section.entries.push({
          kind: classifyEntry(entryText),
          name: entryText,
          detail: entryText,
        });
      }
    }

    if (section.entries.length > 0) sections.push(section);
  }

  return { title, sections };
}

function normalizeContent(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function entryContentHash(entry) {
  return createHash("sha256")
    .update(normalizeContent(entry.content))
    .digest("hex")
    .slice(0, 16);
}

function sourceEntryRecord(entry) {
  return {
    date: entry.date,
    time: entry.time,
    docsUrl: entry.docsUrl || undefined,
    contentHash: entryContentHash(entry),
  };
}

function sourceEntryKey(entry) {
  return `${entry.date}|${entry.time}|${entryContentHash(entry)}`;
}

function collectSourceEntryKeys(patch) {
  return new Set(
    (patch.sourceEntries || [])
      .map((entry) => {
        if (entry.key) return entry.key;
        if (entry.date && entry.time && entry.contentHash) {
          return `${entry.date}|${entry.time}|${entry.contentHash}`;
        }
        return null;
      })
      .filter(Boolean)
  );
}

function isEntryRepresented(entry, existingPatches, knownSourceEntryKeys) {
  if (knownSourceEntryKeys.has(sourceEntryKey(entry))) return true;

  // Older patch files did not store Steam entry-level metadata. Fall back to
  // conservative checks that still allow a distinct Google Doc release posted
  // on a date that was previously represented only by a generic hotfix.
  for (const patch of existingPatches) {
    if (
      entry.docsUrl &&
      (patch.source === entry.docsUrl || patch.workshop_url === entry.docsUrl)
    ) {
      return true;
    }

    if (patch.date === entry.date) {
      if (!entry.docsUrl) return true;
      if (patch.source === entry.docsUrl) return true;
    }

    if ((patch.absorbedDates || []).includes(entry.date) && !entry.docsUrl) {
      return true;
    }
  }

  return false;
}

function slugifyName(value) {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── Hotfix folding ────────────────────────────────────────────────
// A small generic "Rebalance Patch" landing within a couple of days of a
// substantial patch is treated as a hotfix and folded into that patch as a
// dated section, rather than cluttering the list with a one-line entry.
// Named patches (anything with a real Google Doc title) are always separate.
const HOTFIX_MAX_ENTRIES = 2; // child must be this small to fold
const HOTFIX_MAX_DAYS = 2; // child must land within this many days of the parent
const PARENT_MIN_ENTRIES = 4; // parent must be at least this big ("more than three")

// A "substantive" entry is a real change line — its detail says something
// distinct from its name (e.g. "Gyrocopter - Flak Cannon" | "Targets 4->3").
// The Steam-summary fallback emits name === detail for blurb/announcement
// lines ("Fix bug!" | "Fix bug!", season notices), which don't count. This is
// what lets a same-patch tail of pure announcements fold even with several
// lines, while a genuinely small *changed* patch stays on its own.
function isSubstantiveEntry(e) {
  return (e?.name || "").trim() !== (e?.detail || "").trim();
}

function countEntries(sections) {
  return (sections || []).reduce(
    (n, s) => n + (s.entries || []).filter(isSubstantiveEntry).length,
    0
  );
}

// Generic = the "Rebalance Patch" fallback (no distinct Google Doc name).
function isGenericTitle(title) {
  return !title || /^rebalance patch\b/i.test(title.trim());
}

function daysBetween(isoA, isoB) {
  return Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
}

// Fold a hotfix's entries into the parent as a "Hotfix — <date>" section and
// record the absorbed date so re-scrapes don't recreate it. Mutates `parent`
// in memory and rewrites its file.
function foldHotfix(parent, hotfixDate, hotfixSections, hotfixEntries = []) {
  const entries = (hotfixSections || []).flatMap((s) => s.entries || []);
  parent.sections = [
    ...(parent.sections || []),
    { heading: `Hotfix — ${hotfixDate}`, entries },
  ];
  parent.absorbedDates = [
    ...new Set([...(parent.absorbedDates || []), hotfixDate]),
  ];
  parent.sourceEntries = [
    ...(parent.sourceEntries || []),
    ...hotfixEntries.map(sourceEntryRecord),
  ];
  // A folded hotfix brings fresh game-data changes, so the parent's entities
  // need re-syncing — reset its flag.
  parent.entitiesSynced = false;
  if (DRY_RUN) {
    console.log(`[dry-run] Would fold ${hotfixDate} into ${parent.slug}.json`);
    return;
  }
  const data = JSON.parse(readFileSync(parent.file, "utf-8"));
  data.sections = parent.sections;
  data.absorbedDates = parent.absorbedDates;
  data.sourceEntries = parent.sourceEntries;
  data.entitiesSynced = false;
  writeFileSync(parent.file, JSON.stringify(data, null, 2) + "\n");
  console.log(`Folded ${hotfixDate} hotfix into ${parent.slug}.json`);
}

function applyGameDataChanges(sections) {
  const items = JSON.parse(readFileSync(ITEMS_PATH, "utf-8"));
  const unitsFull = JSON.parse(readFileSync(UNITS_FULL_PATH, "utf-8"));
  const synergies = JSON.parse(readFileSync(SYNERGIES_PATH, "utf-8"));
  let changed = false;

  const itemsBySlug = new Map();
  for (const name of Object.keys(items.items)) {
    itemsBySlug.set(slugifyName(name), name);
    itemsBySlug.set(slugifyName(name.replace(/'/g, "")), name);
  }

  const unitsBySlug = new Map();
  for (const name of Object.keys(unitsFull)) {
    unitsBySlug.set(slugifyName(name), name);
  }

  for (const section of sections) {
    for (const entry of section.entries) {
      const detail = entry.detail;
      const bare = entry.name.replace(/\s*-\s+.*$/, "").replace(/\s*\(.*\)$/, "").trim();

      // Item tier changes: "Downgraded from T3 to T2" or "Upgraded from T2 to T3"
      const tierMatch = detail.match(/(?:downgrade|upgrade)d?\s+from\s+T(\d)\s+to\s+T(\d)/i);
      if (tierMatch) {
        const newTier = parseInt(tierMatch[2]);
        const slug = slugifyName(entry.name.replace(/'/g, ""));
        const itemName = itemsBySlug.get(slug) || itemsBySlug.get(slugifyName(entry.name));
        if (itemName && items.items[itemName]) {
          console.log(`  → ${itemName}: tier ${items.items[itemName].tier} → ${newTier}`);
          items.items[itemName].tier = newTier;
          changed = true;
        }
      }

      // New item: "New T3 item: Kobold Cup" (name could be either field)
      const newItemFromName = entry.name.match(/new\s+T(\d)\s+item/i);
      const newItemFromDetail = detail.match(/new\s+T(\d)\s+item/i);
      if (newItemFromName) {
        const tier = parseInt(newItemFromName[1]);
        const itemName = detail.trim();
        if (itemName && !items.items[itemName]) {
          console.log(`  → New item: ${itemName} (T${tier})`);
          items.items[itemName] = { tier };
          items.total = Object.keys(items.items).length;
          changed = true;
        }
      } else if (newItemFromDetail) {
        const tier = parseInt(newItemFromDetail[1]);
        const itemName = entry.name.trim();
        if (itemName && !items.items[itemName]) {
          console.log(`  → New item: ${itemName} (T${tier})`);
          items.items[itemName] = { tier };
          items.total = Object.keys(items.items).length;
          changed = true;
        }
      }

      // Unit class/species change: "Class changed from X to Y" or "Species changed from X to Y"
      const classMatch = detail.match(/(?:class|species)\s+changed\s+from\s+(\w[\w\s]*?)\s+to\s+(\w[\w\s]*?)\.?$/i);
      if (classMatch) {
        const oldSyn = classMatch[1].trim();
        const newSyn = classMatch[2].trim();
        const unitName = unitsBySlug.get(slugifyName(bare));
        if (unitName) {
          for (const data of [unitsFull[unitName]]) {
            if (!data?.synergies) continue;
            const idx = data.synergies.indexOf(oldSyn);
            if (idx !== -1) {
              console.log(`  → ${unitName}: ${oldSyn} → ${newSyn}`);
              data.synergies[idx] = newSyn;
              changed = true;
            }
          }
        }
      }

      // Synergy tier rework: "Reworked from (1)(2)(3) to (2)(4)"
      const tierRework = detail.match(/reworked?\s+from\s+\([\d)(]+\)\s+to\s+(\([\d)(]+\))/i);
      if (tierRework) {
        const newTiers = [...tierRework[1].matchAll(/\((\d+)\)/g)].map(m => parseInt(m[1]));
        const synSlug = slugifyName(bare);
        for (const [, syn] of Object.entries(synergies)) {
          if (syn.name && slugifyName(syn.name) === synSlug && newTiers.length > 0) {
            console.log(`  → ${syn.name} synergy tiers: [${syn.tiers}] → [${newTiers}]`);
            syn.tiers = newTiers;
            changed = true;
          }
        }
      }
    }
  }

  if (changed && !DRY_RUN) {
    writeFileSync(ITEMS_PATH, JSON.stringify(items, null, 2) + "\n");
    writeFileSync(UNITS_FULL_PATH, JSON.stringify(unitsFull, null, 2) + "\n");
    writeFileSync(SYNERGIES_PATH, JSON.stringify(synergies, null, 2) + "\n");
    console.log("Updated game data files.");
  } else if (changed) {
    console.log("[dry-run] Would update game data files.");
  }
}

async function main() {
  console.log("Fetching Steam Workshop changelog...");
  const html = await fetchChangelog();

  console.log("Parsing entries...");
  const entries = parseChangelogEntries(html);
  console.log(`Found ${entries.length} changelog entries on page 1`);

  const index = JSON.parse(readFileSync(INDEX_PATH, "utf-8"));

  // Load existing patch docs from disk so hotfixes can find a parent to fold
  // into, and so already-absorbed dates aren't re-scraped as standalone.
  const existingPatches = [];
  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    const data = JSON.parse(readFileSync(join(DATA_DIR, f), "utf-8"));
    existingPatches.push({
      date: data.date,
      slug: f.replace(/\.json$/, ""),
      file: join(DATA_DIR, f),
      title: data.title,
      sections: data.sections || [],
      absorbedDates: data.absorbedDates || [],
      source: data.source,
      workshop_url: data.workshop_url,
      sourceEntries: data.sourceEntries || [],
    });
  }

  const knownSourceEntryKeys = new Set(
    existingPatches.flatMap((patch) => [...collectSourceEntryKeys(patch)])
  );
  const existingSlugs = new Set(index.patches.map((p) => p.slug));

  // Group by date, skip only Steam entries that are already represented. Do
  // not skip solely by calendar date: Steam can publish a generic hotfix and a
  // named patch on the same day, and older runs may have absorbed that date.
  const byDate = new Map();
  for (const entry of entries) {
    if (isEntryRepresented(entry, existingPatches, knownSourceEntryKeys)) continue;
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }

  if (byDate.size === 0) {
    console.log("No new patches found.");
    return;
  }

  console.log(`${byDate.size} new patch date(s) to add`);

  const newPatches = [];
  // Standalone patches written this run — a later hotfix in the same batch can
  // fold into one of these as well as into a pre-existing patch.
  const writtenStandalone = [];

  // Oldest-first so a parent is always written before any hotfix folding into it.
  for (const date of [...byDate.keys()].sort()) {
    const dayEntries = byDate.get(date);
    // Prefer Google Docs source over Steam summary
    const docsUrl = dayEntries.find((e) => e.docsUrl)?.docsUrl;
    let title = "Rebalance Patch";
    let sections;

    if (docsUrl) {
      console.log(`Fetching Google Doc: ${docsUrl}`);
      const docHtml = await fetchGoogleDoc(docsUrl);
      if (docHtml) {
        const parsed = parseGoogleDoc(docHtml);
        title = parsed.title;
        sections = parsed.sections;
      }
    }

    if (!sections || sections.length === 0) {
      const combined = dayEntries.map((e) => e.content).join("\n\n");
      sections = contentToSections(combined);
    }

    // Hotfix folding: a small *generic* patch landing within a couple of days
    // of a substantial patch is folded into that patch rather than listed on
    // its own. Named patches never qualify (isGenericTitle is false).
    if (isGenericTitle(title) && countEntries(sections) <= HOTFIX_MAX_ENTRIES) {
      const parent = [...existingPatches, ...writtenStandalone]
        .filter(
          (p) =>
            p.date < date &&
            daysBetween(p.date, date) <= HOTFIX_MAX_DAYS &&
            countEntries(p.sections) >= PARENT_MIN_ENTRIES
        )
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (parent) {
        foldHotfix(parent, date, sections, dayEntries);
        console.log("Applying game data changes...");
        applyGameDataChanges(sections);
        continue;
      }
    }

    const slugBase = slugifyName(title);
    let slug = `${date}-${slugBase || "rebalance-patch"}`;
    if (existingSlugs.has(slug)) continue;
    const filePath = join(DATA_DIR, `${slug}.json`);

    const patchData = {
      date,
      title,
      source: docsUrl || CHANGELOG_URL,
      workshop_url: docsUrl ? CHANGELOG_URL : undefined,
      // New patches carry game-data changes that have NOT yet been pulled from
      // the VPK into data/*.json + the CMS. Flipped true by the
      // /sync-patch-entities skill or scripts/mark-patch-synced.mjs.
      entitiesSynced: false,
      sourceEntries: dayEntries.map(sourceEntryRecord),
      sections,
    };

    if (DRY_RUN) {
      console.log(`\n[dry-run] Would write ${slug}.json:`);
      console.log(JSON.stringify(patchData, null, 2));
    } else {
      writeFileSync(filePath, JSON.stringify(patchData, null, 2) + "\n");
      console.log(`Wrote ${slug}.json`);
    }

    writtenStandalone.push({
      date,
      slug,
      file: filePath,
      title,
      sections,
      absorbedDates: [],
      sourceEntries: dayEntries.map(sourceEntryRecord),
    });
    newPatches.push({ date, title, slug });

    console.log("Applying game data changes...");
    applyGameDataChanges(patchData.sections);
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
