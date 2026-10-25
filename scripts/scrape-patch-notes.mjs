#!/usr/bin/env node
/**
 * Scrape DAC patch notes from the Steam Workshop changelog.
 *
 * Fetches the changelog page, parses entries, diffs against content files,
 * and writes new patch JSON files.
 *
 * Usage:
 *   node scripts/scrape-patch-notes.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { patchNoteToJson } from "./lib/patch-note-json.mjs";
import { classifyPatchNoteKind } from "./lib/patch-note-kind.mjs";
import { slugifyName } from "../shared/slugify.mjs";
import {
  applyIncomingEntries,
  assessChangelogFetch,
  assignEntryDates,
  changelogPageUrl,
  collectChangelogPages,
  entryContentHash,
  hasNextChangelogPage,
  parseChangelogEntries,
  parseChangelogReaderEntries,
  splitChangelogLine,
  takeEntriesUntilKnown,
} from "./lib/patch-note-changelog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_CONTENT = join(__dirname, "..", "content");
const PATCH_NOTES_DIR = join(ROOT_CONTENT, "patch-notes");
const PATCH_BANNERS_DIR = join(__dirname, "..", "web", "public", "patch-banners");
const GAME_CONTENT_DIR = join(ROOT_CONTENT, "game");
const ITEMS_DIR = join(GAME_CONTENT_DIR, "items");
const UNITS_DIR = join(GAME_CONTENT_DIR, "units");
const SYNERGIES_DIR = join(GAME_CONTENT_DIR, "synergies");
const RELICS_DIR = join(GAME_CONTENT_DIR, "relics");
const PUBLISHED_FILE_ID = "1613886175";
const CHANGELOG_URL =
  `https://steamcommunity.com/sharedfiles/filedetails/changelog/${PUBLISHED_FILE_ID}`;
const CHANGELOG_FETCH_URL =
  `${CHANGELOG_URL}?l=english`;
// A 429, any other non-200, or a page missing "Showing X-Y of N entries" is
// not the end of the changelog. The run fails and writes nothing. Reader and
// browser fallbacks are only for transport failures, and they still refuse to
// write unless they reach a post already on disk.
const MAX_CHANGELOG_PAGES = 30;
// Steam 429s a fast walk. Scheduled runs stop on page 1 or 2; a backfill
// still waits between pages and backs off on "too many requests".
const PAGE_DELAY_MS = 2500;
const RATE_LIMIT_BACKOFF_MS = [5000, 15000, 45000];
// Rarely, Steam blocks both the direct fetch and the reader's fetch in the
// same run (an anti-bot challenge, not just an IP-reputation block). A real
// browser navigation clears that challenge, so a full scrape can use it as
// the last fallback. That browser is not part of workshop-refresh: the
// scheduled emit path passes --since and --until and never launches one.
// When Steam blocks that path, it retries through the r.jina.ai reader and
// then the entries already saved in content/patch-notes.

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const DRY_RUN = process.argv.includes("--dry-run");
const CHANGELOG_FILE_ARG = process.argv.find((arg) =>
  arg.startsWith("--changelog-file=")
);
const CHANGELOG_FILE = CHANGELOG_FILE_ARG?.split("=").slice(1).join("=");
const ANNOTATE_PATCH_ARG = process.argv.find((arg) =>
  arg.startsWith("--annotate-patch=")
);
const ANNOTATE_PATCH = ANNOTATE_PATCH_ARG?.split("=").slice(1).join("=");
const EMIT_ENTRIES_ARG = process.argv.find((arg) => arg.startsWith("--emit-entries="));
if (process.argv.some((arg) => arg.startsWith("--around="))) {
  throw new Error("--around was removed; pass --since=<exclusive unix seconds> and --until=<inclusive unix seconds>");
}
if (process.argv.some((arg) => arg.startsWith("--known-source-id="))) {
  throw new Error("--known-source-id was removed; pass --since=<exclusive unix seconds> and --until=<inclusive unix seconds>");
}

function numericFlag(prefix) {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) return null;
  const value = Number(arg.split("=").slice(1).join("="));
  if (!Number.isFinite(value)) throw new Error(`${prefix}<unix seconds> must be a number`);
  return value;
}

const SINCE_SECONDS = numericFlag("--since=");
const UNTIL_SECONDS = numericFlag("--until=");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchChangelogResponse(url, label) {
  let last = { status: 0, html: "" };
  for (let attempt = 0; attempt <= RATE_LIMIT_BACKOFF_MS.length; attempt += 1) {
    if (attempt > 0) {
      const wait = RATE_LIMIT_BACKOFF_MS[attempt - 1];
      console.warn(`${label} HTTP ${last.status}; waiting ${wait}ms before retry`);
      await sleep(wait);
    }
    const resp = await fetch(url, { headers: REQUEST_HEADERS });
    last = { status: resp.status, html: await resp.text() };
    if (resp.status !== 429) return last;
  }
  return last;
}

function readerUrlFor(pageUrl) {
  return `https://r.jina.ai/http://${pageUrl}`;
}

function isFatalChangelogError(err) {
  return /Refusing to write|pagination stopped|not a usable Steam page|rate-limited|ended before a known post/.test(
    err?.message || "",
  );
}

function acceptCollectedPages(collected, label) {
  if (collected.reachedKnown || collected.exhausted) return true;
  if (collected.entries.length > 0) {
    throw new Error(
      `${label} fetched changelog entries but never reached an entry already on disk. Refusing to write a gap.`,
    );
  }
  return false;
}

async function fetchChangelogWithEntries(isKnown) {
  if (CHANGELOG_FILE) {
    const html = readFileSync(CHANGELOG_FILE, "utf-8");
    const entries = parseChangelogEntries(html);
    const assessment = assessChangelogFetch({ status: 200, html, entries });
    if (!assessment.ok) {
      throw new Error(
        `Changelog file is not a usable Steam page (${assessment.reason}). Refusing to write.`,
      );
    }
    const taken = takeEntriesUntilKnown(entries, isKnown);
    if (!taken.reachedKnown && !assessment.lastPage) {
      throw new Error(
        "Changelog file ended before a known post without Showing Y of N. Refusing to write.",
      );
    }
    return {
      html,
      entries: taken.fresh,
      reachedKnown: taken.reachedKnown,
      exhausted: assessment.lastPage && !taken.reachedKnown,
      pagesFetched: 1,
    };
  }

  let firstHtml = "";
  let firstError = null;

  try {
    const direct = await collectChangelogPages({
      isKnown,
      maxPages: MAX_CHANGELOG_PAGES,
      fetchPage: async (page) => {
        if (page > 1) await sleep(PAGE_DELAY_MS);
        const url = changelogPageUrl(CHANGELOG_FETCH_URL, page);
        const response = await fetchChangelogResponse(url, `Steam changelog page ${page}`);
        if (page === 1) firstHtml = response.html;
        const entries = response.status === 200 ? parseChangelogEntries(response.html) : [];
        return { status: response.status, html: response.html, entries };
      },
    });
    if (acceptCollectedPages(direct, "Direct changelog fetch")) {
      console.log(
        `Fetched ${direct.entries.length} new changelog entr${direct.entries.length === 1 ? "y" : "ies"} across ${direct.pagesFetched} page(s).`,
      );
      return { ...direct, html: firstHtml };
    }
  } catch (err) {
    firstError = err;
    if (isFatalChangelogError(err)) throw err;
    console.warn(`Direct changelog fetch failed: ${err.message}`);
  }

  console.warn(
    "Steam changelog returned 0 direct HTML entries; trying text-rendered fallback..."
  );
  const fallback = await fetchReaderChangelogWithEntries(isKnown);
  if (fallback.entries.length > 0) return fallback;

  console.warn(
    "Text-rendered fallback returned 0 entries; trying browser-rendered fallback..."
  );
  const browserFallback = await fetchChangelogWithBrowserEntries(isKnown);
  if (browserFallback.entries.length > 0) return browserFallback;

  const html = firstHtml || fallback.html || browserFallback.html;
  if (html) return { html, entries: [], reachedKnown: false, exhausted: false, pagesFetched: 0 };
  throw firstError || new Error("Could not fetch Steam changelog");
}

async function fetchChangelogViaBrowser(url) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      userAgent: REQUEST_HEADERS["User-Agent"],
      locale: "en-US",
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function fetchChangelogWithBrowserEntries(isKnown) {
  let firstHtml = "";
  try {
    const collected = await collectChangelogPages({
      isKnown,
      maxPages: MAX_CHANGELOG_PAGES,
      fetchPage: async (page) => {
        if (page > 1) await sleep(PAGE_DELAY_MS);
        const url = changelogPageUrl(CHANGELOG_FETCH_URL, page);
        const html = await fetchChangelogViaBrowser(url);
        if (!firstHtml) firstHtml = html;
        const status = /too many requests/i.test(html) ? 429 : 200;
        const entries = status === 200 ? parseChangelogEntries(html) : [];
        return { status, html, entries };
      },
    });
    if (acceptCollectedPages(collected, "Browser-rendered changelog fetch")) {
      return { ...collected, html: firstHtml };
    }
  } catch (err) {
    if (isFatalChangelogError(err)) throw err;
    console.warn(`Browser-rendered fallback unavailable: ${err.message}`);
  }
  return { html: firstHtml, entries: [], reachedKnown: false, exhausted: false, pagesFetched: 0 };
}

async function fetchReaderChangelogWithEntries(isKnown) {
  let firstHtml = "";
  let latestUpdateId = null;
  try {
    latestUpdateId = await fetchLatestSteamUpdateId();
  } catch (err) {
    console.warn(`Could not fetch latest Steam update id: ${err.message}`);
  }

  try {
    const collected = await collectChangelogPages({
      isKnown,
      maxPages: MAX_CHANGELOG_PAGES,
      fetchPage: async (page) => {
        if (page > 1) await sleep(PAGE_DELAY_MS);
        const url = readerUrlFor(changelogPageUrl(CHANGELOG_FETCH_URL, page));
        const response = await fetchChangelogResponse(url, `Text-rendered changelog page ${page}`);
        if (!firstHtml) firstHtml = response.html;
        if (response.status !== 200) {
          return { status: response.status, html: response.html, entries: [] };
        }
        let entries = parseChangelogReaderEntries(response.html);
        if (page === 1 && latestUpdateId && entries[0] && !entries[0].sourceId) {
          entries = [{ ...entries[0], sourceId: latestUpdateId }, ...entries.slice(1)];
        }
        entries = assignEntryDates(entries);
        const paging = assessChangelogFetch({ status: 200, html: response.html, entries });
        if (paging.ok || paging.reason !== "missing-paging-header") {
          return { status: 200, html: response.html, entries };
        }
        return { entries, hasNext: hasNextChangelogPage(response.html, page) };
      },
    });
    if (acceptCollectedPages(collected, "Text-rendered changelog fetch")) {
      console.warn(`Text-rendered fallback returned ${collected.entries.length} entries.`);
      return { ...collected, html: firstHtml };
    }
  } catch (err) {
    if (isFatalChangelogError(err)) throw err;
    console.warn(`Text-rendered fallback failed: ${err.message}`);
  }
  return { html: firstHtml, entries: [], reachedKnown: false, exhausted: false, pagesFetched: 0 };
}

async function fetchLatestSteamUpdateId() {
  const params = new URLSearchParams();
  params.set("itemcount", "1");
  params.set("publishedfileids[0]", PUBLISHED_FILE_ID);
  const resp = await fetch(
    "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
    {
      method: "POST",
      headers: REQUEST_HEADERS,
      body: params,
    }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching published file details`);
  const data = await resp.json();
  const details = data?.response?.publishedfiledetails?.[0];
  return details?.time_updated ? String(details.time_updated) : null;
}

function describeUnexpectedChangelogHtml(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const bodyText = htmlToText(html).replace(/\s+/g, " ").slice(0, 300);
  return [
    `Fetched Steam changelog, but found 0 changelog entries.`,
    title ? `Page title: ${title.trim()}` : null,
    bodyText ? `Page excerpt: ${bodyText}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}


async function fetchGoogleDoc(url) {
  try {
    const resp = await fetch(url, { headers: REQUEST_HEADERS });
    if (!resp.ok) return null;
    return resp.text();
  } catch (err) {
    console.warn(`Could not fetch Google Doc ${url}: ${err.message}`);
    return null;
  }
}

function decodeHtmlEntities(value) {
  return (value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function htmlToText(html) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/●\s*/g, "")
    .trim();
}

function extractFirstImageUrl(html) {
  for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    const url = decodeHtmlEntities(match[1]).trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}

const IMAGE_EXT_BY_CONTENT_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Google Docs' image URLs are served with a CORP header that blocks them from
// being hotlinked/embedded on any other site, so patch banners must be
// downloaded and served from our own origin instead of storing the raw URL.
async function downloadPatchBanner(slug, imageUrl) {
  try {
    const resp = await fetch(imageUrl, { headers: REQUEST_HEADERS });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = resp.headers.get("content-type")?.split(";")[0]?.trim();
    const ext = IMAGE_EXT_BY_CONTENT_TYPE[contentType] || "png";
    const buffer = Buffer.from(await resp.arrayBuffer());
    mkdirSync(PATCH_BANNERS_DIR, { recursive: true });
    writeFileSync(join(PATCH_BANNERS_DIR, `${slug}.${ext}`), buffer);
    return `/patch-banners/${slug}.${ext}`;
  } catch (err) {
    console.warn(`Failed to self-host patch banner image (${imageUrl}): ${err.message}`);
    return null;
  }
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
  const image = extractFirstImageUrl(contentMatch?.[1] || html);
  if (!contentMatch) return { title, image, sections: [] };
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
    const entryRegex = /<p[^>]*>(?:<span[^>]*>)?[●•]\s*(?:<\/span>)?\s*([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = entryRegex.exec(chunk)) !== null) {
      const split = splitChangelogLine(htmlToText(m[1]));
      if (!split) continue;
      section.entries.push({
        kind: classifyPatchNoteKind(split.detail, split.name),
        name: split.name,
        detail: split.detail,
      });
    }

    if (section.entries.length > 0) sections.push(section);
  }

  return { title, image, sections };
}


function collectSourceEntryIds(patch) {
  return new Set(
    (patch.sourceEntries || [])
      .map((entry) => entry.sourceId || null)
      .filter(Boolean)
  );
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

function isEntryRepresented(entry, existingPatches, knownSourceEntryKeys, knownSourceEntryIds) {
  if (entry.sourceId && knownSourceEntryIds.has(entry.sourceId)) return true;
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

function readJsonFile(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

let patchEntityIndex = null;

function entityAliasKeys(value) {
  const key = slugifyName(String(value || ""));
  if (!key) return [];
  const compact = key.replace(/-/g, "");
  return compact && compact !== key ? [key, compact] : [key];
}

function addEntityAlias(byType, record, value) {
  for (const key of entityAliasKeys(value)) {
    const aliases = byType.get(record.type);
    if (!aliases.has(key)) aliases.set(key, []);
    const records = aliases.get(key);
    if (!records.some((existing) => existing.entityKey === record.entityKey)) {
      records.push(record);
    }
  }
}

function addEntityAliases(byType, record, data, fileBase) {
  const aliases = [
    record.name,
    record.slug,
    fileBase,
    data.source?.name,
    data.source?.names?.en,
  ];

  if (record.type === "synergy" && fileBase.startsWith("is_")) {
    aliases.push(fileBase.slice(3).replace(/[_-]+/g, " "));
  }

  if (record.type === "unit") {
    aliases.push(record.name.replace(/^Abyssal\s+/i, ""));
    aliases.push(record.name.replace(/\s+Warrunner$/i, ""));
  }

  for (const alias of aliases) {
    if (alias) addEntityAlias(byType, record, alias);
  }
}

function readEntityRecords({ type, dir }) {
  const records = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const fileBase = file.replace(/\.json$/, "");
    const data = readJsonFile(join(dir, file));
    const name = data.name || data.source?.name || data.source?.names?.en || fileBase;
    const slug = data.slug || slugifyName(name);
    if (!slug) continue;
    records.push({ type, slug, name, fileBase, data, entityKey: `${type}__${slug}` });
  }
  return records;
}

function buildPatchEntityIndex() {
  const byType = new Map([
    ["unit", new Map()],
    ["item", new Map()],
    ["synergy", new Map()],
    ["relic", new Map()],
  ]);
  const byTypeAndSlug = new Map();

  for (const collection of [
    { type: "unit", dir: UNITS_DIR },
    { type: "item", dir: ITEMS_DIR },
    { type: "synergy", dir: SYNERGIES_DIR },
    { type: "relic", dir: RELICS_DIR },
  ]) {
    for (const record of readEntityRecords(collection)) {
      byTypeAndSlug.set(`${record.type}:${record.slug}`, record);
      addEntityAliases(byType, record, record.data, record.fileBase);
    }
  }

  for (const [type, alias, slug] of [
    ["unit", "Underlord", "abyssal-underlord"],
    ["unit", "Centaur", "centaur-warrunner"],
    ["synergy", "Element", "elemental"],
    ["synergy", "Elements", "elemental"],
  ]) {
    const record = byTypeAndSlug.get(`${type}:${slug}`);
    if (record) addEntityAlias(byType, record, alias);
  }

  return { byType };
}

function getPatchEntityIndex() {
  if (!patchEntityIndex) patchEntityIndex = buildPatchEntityIndex();
  return patchEntityIndex;
}

function entryEntityNameCandidates(name) {
  const raw = String(name || "").trim();
  if (!raw) return [];

  const beforeDash = raw.split(/\s+[-\u2013\u2014]\s+/)[0].trim();
  const withoutParens = beforeDash.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  const candidates = [withoutParens, beforeDash, raw]
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .filter((candidate) => !candidate.includes(","));

  return [...new Set(candidates)];
}

function preferredEntityTypesForSection(heading) {
  const normalized = String(heading || "").toLowerCase();
  if (/chess|piece|unit/.test(normalized)) return ["unit", "synergy", "item", "relic"];
  if (/synerg/.test(normalized)) return ["synergy", "unit", "item", "relic"];
  if (/item/.test(normalized)) return ["item", "relic", "unit", "synergy"];
  if (/relic/.test(normalized)) return ["relic", "item", "unit", "synergy"];
  return ["unit", "item", "synergy", "relic"];
}

function lookupEntityRecord(index, type, candidate) {
  const aliases = index.byType.get(type);
  if (!aliases) return null;
  for (const key of entityAliasKeys(candidate)) {
    const matches = aliases.get(key) || [];
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function findEntryEntityRecord(entry, sectionHeading) {
  if (entry.entityKey || entry.entity) return null;

  const index = getPatchEntityIndex();
  const candidates = entryEntityNameCandidates(entry.name);
  const preferredTypes = preferredEntityTypesForSection(sectionHeading);

  for (const type of preferredTypes) {
    for (const candidate of candidates) {
      const record = lookupEntityRecord(index, type, candidate);
      if (record) return record;
    }
  }

  return null;
}

function annotatePatchSections(sections) {
  let linked = 0;
  for (const section of sections || []) {
    for (const entry of section.entries || []) {
      const record = findEntryEntityRecord(entry, section.heading);
      if (!record) continue;
      entry.entityKey = record.entityKey;
      linked += 1;
    }
  }
  return linked;
}

async function annotateExistingPatch(slugOrFile) {
  const file =
    slugOrFile.endsWith(".json") && /[\\/]/.test(slugOrFile)
      ? slugOrFile
      : join(PATCH_NOTES_DIR, slugOrFile.endsWith(".json") ? slugOrFile : `${slugOrFile}.json`);
  const patch = readJsonFile(file);
  const linked = annotatePatchSections(patch.sections || []);
  let imageAdded = false;

  if (!patch.image && /^https:\/\/docs\.google\.com\//i.test(patch.source || "")) {
    console.log(`Fetching Google Doc image: ${patch.source}`);
    const docHtml = await fetchGoogleDoc(patch.source);
    const rawImage = docHtml ? parseGoogleDoc(docHtml).image : null;
    if (rawImage && DRY_RUN) {
      imageAdded = true;
    } else if (rawImage) {
      const slug = basename(file, ".json");
      const hosted = await downloadPatchBanner(slug, rawImage);
      if (hosted) {
        patch.image = hosted;
        imageAdded = true;
      }
    }
  }

  if (DRY_RUN) {
    console.log(
      `[dry-run] Would annotate ${slugOrFile}: ${linked} entity link(s), image ${imageAdded ? "added" : "unchanged"}.`
    );
    console.log(JSON.stringify(patch, null, 2));
    return;
  }

  if (linked > 0 || imageAdded) {
    writeFileSync(file, patchNoteToJson(patch));
  }
  console.log(
    `Annotated ${slugOrFile}: ${linked} entity link(s), image ${imageAdded ? "added" : "unchanged"}.`
  );
}


const NOTE_RUNTIME_KEYS = new Set([
  "file",
  "dirty",
  "slug",
  "sortKey",
  "openedSortKey",
  "closesBugfixRollup",
  "workshop_url",
  "docsUrl",
  "pendingImage",
]);

function loadExistingPatches() {
  const existingPatches = [];
  for (const f of readdirSync(PATCH_NOTES_DIR)) {
    if (!f.endsWith(".json")) continue;
    const data = readJsonFile(join(PATCH_NOTES_DIR, f));
    existingPatches.push({
      ...data,
      slug: f.replace(/\.json$/, ""),
      file: join(PATCH_NOTES_DIR, f),
      sections: data.sections || [],
      absorbedDates: data.absorbedDates || [],
      sourceEntries: data.sourceEntries || [],
      workshop_url: data.workshop_url || data.workshopUrl,
    });
  }
  return existingPatches;
}

function patchDataFromNote(note) {
  const data = {};
  for (const [key, value] of Object.entries(note)) {
    if (NOTE_RUNTIME_KEYS.has(key) || value === undefined) continue;
    data[key] = value;
  }
  return data;
}

function knownEntry(entry, knownSourceEntryIds, knownSourceEntryKeys, existingPatches) {
  if (entry.sourceId && knownSourceEntryIds.has(String(entry.sourceId))) return true;
  if (entry.date && entry.time && knownSourceEntryKeys.has(sourceEntryKey(entry))) return true;
  // Legacy notes have no Steam update id. Stop only when this older,
  // id-less row is already represented.
  if (!entry.sourceId) {
    return isEntryRepresented(entry, existingPatches, knownSourceEntryKeys, knownSourceEntryIds);
  }
  return false;
}

function sourceStamp(entry) {
  const value = Number(entry?.sourceId);
  return Number.isFinite(value) ? value : null;
}

function inRefreshRange(entry, since, until) {
  const stamp = sourceStamp(entry);
  if (stamp == null || until == null) return false;
  if (stamp > until) return false;
  if (since == null) return stamp === until;
  return stamp > since;
}

function pastRefreshRange(entry, since, until) {
  const stamp = sourceStamp(entry);
  if (stamp == null) return false;
  if (since != null) return stamp <= since;
  if (until != null) return stamp < until;
  return false;
}

function blockedChangelogError(err) {
  return /not a usable Steam page|rate-limited|Could not fetch|fetch failed|ECONN|ENOTFOUND|network/i.test(
    err?.message || "",
  );
}

function entriesFromChangelogHtml(html, since, until) {
  const entries = parseChangelogEntries(html);
  const assessment = assessChangelogFetch({ status: 200, html, entries });
  if (!assessment.ok) {
    throw new Error(
      `Changelog file is not a usable Steam page (${assessment.reason}). Refusing to write.`,
    );
  }
  const walkedPast = entries.some((entry) => pastRefreshRange(entry, since, until));
  if (!assessment.lastPage && !walkedPast) {
    throw new Error(
      "Changelog file ended inside the recorded update range. Refusing to write a partial list.",
    );
  }
  return entries.filter((entry) => inRefreshRange(entry, since, until));
}

async function collectRefreshRange(fetchPage, since, until) {
  const matched = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_CHANGELOG_PAGES; page += 1) {
    if (page > 1) await sleep(PAGE_DELAY_MS);
    const result = await fetchPage(page);
    const entries = result.entries || [];
    let assessment = assessChangelogFetch({
      status: result.status ?? 200,
      html: result.html,
      entries,
    });
    if (
      !assessment.ok
      && assessment.reason === "missing-paging-header"
      && entries.length > 0
      && typeof result.hasNext === "boolean"
    ) {
      assessment = { ok: true, lastPage: !result.hasNext, hasNext: result.hasNext };
    }
    if (!assessment.ok) {
      throw new Error(
        `Changelog page ${page} is not a usable Steam page (${assessment.reason}). Refusing to write.`,
      );
    }
    if (entries.length > 0 && entries.every((entry) => sourceStamp(entry) == null)) {
      throw new Error(`Changelog page ${page} has no source ids. Refusing to write.`);
    }
    let walkedPast = false;
    for (const entry of entries) {
      const stamp = sourceStamp(entry);
      const sourceId = stamp == null ? "" : String(entry.sourceId);
      if (sourceId && !seen.has(sourceId) && inRefreshRange(entry, since, until)) {
        seen.add(sourceId);
        matched.push(entry);
      }
      if (pastRefreshRange(entry, since, until)) walkedPast = true;
    }
    if (assessment.lastPage || walkedPast) {
      matched.sort((a, b) => sourceStamp(a) - sourceStamp(b));
      return matched;
    }
  }
  throw new Error(
    `Changelog pagination stopped after ${MAX_CHANGELOG_PAGES} pages before leaving the recorded update range`,
  );
}

function savedExcerpt(patch) {
  const entries = patch.sourceEntries || [];
  if (entries.length === 1) {
    const section = (patch.sections || [])[0];
    const item = section && (section.entries || [])[0];
    const text = [item?.name, item?.detail].filter(Boolean).join(" — ");
    if (text) return text;
  }
  return patch.title || "";
}

function savedRangeEntries(since, until) {
  const matched = [];
  const seen = new Set();
  for (const patch of loadExistingPatches()) {
    for (const entry of patch.sourceEntries || []) {
      const sourceId = String(entry.sourceId || "");
      if (!sourceId || seen.has(sourceId)) continue;
      const shaped = {
        date: entry.date,
        time: entry.time,
        sourceId,
        docsUrl: entry.docsUrl || null,
        content: entry.content || savedExcerpt(patch),
        origin: "saved-patch-notes",
      };
      if (!inRefreshRange(shaped, since, until)) continue;
      seen.add(sourceId);
      matched.push(shaped);
    }
  }
  matched.sort((a, b) => sourceStamp(a) - sourceStamp(b));
  return matched;
}

async function fetchSteamRange(since, until) {
  return collectRefreshRange(async (page) => {
    const url = changelogPageUrl(CHANGELOG_FETCH_URL, page);
    const response = await fetchChangelogResponse(url, `Steam changelog page ${page}`);
    const entries = response.status === 200 ? parseChangelogEntries(response.html) : [];
    return { status: response.status, html: response.html, entries };
  }, since, until);
}

async function fetchReaderRange(since, until) {
  return collectRefreshRange(async (page) => {
    const pageUrl = changelogPageUrl(CHANGELOG_FETCH_URL, page);
    const response = await fetchChangelogResponse(readerUrlFor(pageUrl), `Text-rendered changelog page ${page}`);
    const htmlEntries = response.status === 200 ? parseChangelogEntries(response.html) : [];
    let entries = htmlEntries;
    if (!htmlEntries.length && response.status === 200) {
      entries = assignEntryDates(parseChangelogReaderEntries(response.html));
    }
    const paging = assessChangelogFetch({ status: response.status, html: response.html, entries });
    if (paging.ok || paging.reason !== "missing-paging-header") {
      return { status: response.status, html: response.html, entries };
    }
    return { entries, hasNext: hasNextChangelogPage(response.html, page) };
  }, since, until);
}

// Posts after the previous time_updated and through the current one, including
// posts already saved on disk. This does not stop at a known post and does
// not launch a browser. A missing "Showing X-Y of N entries" header still
// refuses that fetch. When Steam blocks the runner, the reader is next, then
// the matching entries already stored in content/patch-notes.
async function fetchChangelogRange(since, until) {
  if (until == null) throw new Error("--until=<unix seconds> is required");
  if (CHANGELOG_FILE) {
    return entriesFromChangelogHtml(readFileSync(CHANGELOG_FILE, "utf-8"), since, until);
  }

  let blocked = null;
  try {
    return await fetchSteamRange(since, until);
  } catch (err) {
    if (!blockedChangelogError(err)) throw err;
    blocked = err;
    console.warn(`Direct changelog fetch failed: ${err.message}`);
  }

  try {
    const entries = await fetchReaderRange(since, until);
    if (entries.length > 0) {
      console.warn(`Text-rendered fallback returned ${entries.length} entries in the recorded update range.`);
      return entries;
    }
    console.warn("Text-rendered fallback returned no entries in the recorded update range.");
  } catch (err) {
    console.warn(`Text-rendered fallback failed: ${err.message}`);
  }

  const saved = savedRangeEntries(since, until);
  if (saved.length > 0) {
    console.warn(
      `Using ${saved.length} changelog entries already saved in content/patch-notes. A newer post may be missing.`,
    );
    return saved;
  }
  throw blocked || new Error("Could not fetch Steam changelog entries for the recorded update range");
}

function changelogPayload(entries) {
  return entries.map((entry) => {
    const payload = {
      date: entry.date,
      time: entry.time,
      sourceId: entry.sourceId || null,
      docsUrl: entry.docsUrl || null,
      excerpt: String(entry.content || "").slice(0, 500),
      url: entry.sourceId ? `${CHANGELOG_URL}#${entry.sourceId}` : CHANGELOG_URL,
    };
    if (entry.origin) payload.origin = entry.origin;
    return payload;
  });
}

async function emitChangelogEntries() {
  const destination = EMIT_ENTRIES_ARG.split("=").slice(1).join("=");
  if (!destination) throw new Error("--emit-entries=FILE is required");
  let entries;
  if (UNTIL_SECONDS != null) {
    entries = await fetchChangelogRange(SINCE_SECONDS, UNTIL_SECONDS);
  } else if (SINCE_SECONDS != null) {
    throw new Error("--until=<unix seconds> is required with --since");
  } else {
    const existingPatches = loadExistingPatches();
    const knownSourceEntryKeys = new Set(
      existingPatches.flatMap((patch) => [...collectSourceEntryKeys(patch)]),
    );
    const knownSourceEntryIds = new Set(
      existingPatches.flatMap((patch) => [...collectSourceEntryIds(patch)]),
    );
    const isKnown = (entry) => knownEntry(
      entry,
      knownSourceEntryIds,
      knownSourceEntryKeys,
      existingPatches,
    );
    // A caller that does not pass --until still refuses a partial page.
    // Workshop refresh always passes --since and --until.
    ({ entries } = await fetchChangelogWithEntries(isKnown));
  }
  const payload = changelogPayload(entries);
  writeFileSync(destination, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${payload.length} changelog entries to ${destination}`);
}

async function main() {
  if (EMIT_ENTRIES_ARG) {
    await emitChangelogEntries();
    return;
  }

  if (ANNOTATE_PATCH) {
    await annotateExistingPatch(ANNOTATE_PATCH);
    return;
  }

  const existingPatches = loadExistingPatches();
  const knownSourceEntryKeys = new Set(
    existingPatches.flatMap((patch) => [...collectSourceEntryKeys(patch)])
  );
  const knownSourceEntryIds = new Set(
    existingPatches.flatMap((patch) => [...collectSourceEntryIds(patch)])
  );
  const isKnown = (entry) => knownEntry(
    entry,
    knownSourceEntryIds,
    knownSourceEntryKeys,
    existingPatches,
  );

  console.log("Fetching Steam Workshop changelog...");
  const { html, entries, reachedKnown } = await fetchChangelogWithEntries(isKnown);

  console.log(`Found ${entries.length} changelog entr${entries.length === 1 ? "y" : "ies"} newer than the saved notes.`);

  if (entries.length === 0) {
    if (reachedKnown) {
      console.log("No new patches found.");
      return;
    }
    const latestUpdateId = await fetchLatestSteamUpdateId();
    if (latestUpdateId && knownSourceEntryIds.has(String(latestUpdateId))) {
      console.warn(
        `Steam changelog returned 0 entries, but latest update ${latestUpdateId} is already represented; no-op.`
      );
      return;
    }
    throw new Error(
      [
        describeUnexpectedChangelogHtml(html),
        latestUpdateId
          ? `Latest Steam update id ${latestUpdateId} is not represented in local patch data.`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const fresh = entries.filter((entry) => entry.date && !isKnown(entry));
  if (fresh.length === 0) {
    console.log("No new patches found.");
    return;
  }

  const notes = applyIncomingEntries(existingPatches, fresh, { changelogUrl: CHANGELOG_URL });
  const dirty = notes.filter((note) => note.dirty);
  if (dirty.length === 0) {
    console.log("No new patches found.");
    return;
  }

  console.log(`${dirty.length} patch note(s) to write`);
  for (const note of dirty) {
    await applyGoogleDocOverride(note);
    const linkedEntities = annotatePatchSections(note.sections);
    if (linkedEntities > 0) {
      console.log(`Linked ${linkedEntities} patch entr${linkedEntities === 1 ? "y" : "ies"} to game entities.`);
    }
    // A balance or hotfix note still needs a VPK entity sync. Notices and
    // bugfix rollups do not change chess data, so they do not show the
    // pending badge.
    if (note.category === "notice" || note.rollup === "bugfixes") {
      delete note.entitiesSynced;
      delete note.entitiesSyncedAt;
    } else {
      note.entitiesSynced = false;
      delete note.entitiesSyncedAt;
    }
    const slug = note.slug || `${note.date}-${slugifyName(note.title) || "rebalance-patch"}`;
    note.slug = slug;
    if (note.pendingImage && !note.image && !DRY_RUN) {
      note.image = await downloadPatchBanner(slug, note.pendingImage);
    }
    delete note.pendingImage;
    const filePath = note.file || join(PATCH_NOTES_DIR, `${slug}.json`);
    const patchData = patchDataFromNote(note);

    if (DRY_RUN) {
      console.log(`\n[dry-run] Would write ${slug}.json:`);
      console.log(JSON.stringify(patchData, null, 2));
    } else {
      writeFileSync(filePath, patchNoteToJson(patchData));
      console.log(`Wrote ${slug}.json`);
    }
  }
}

async function applyGoogleDocOverride(note) {
  if (note.file) return;
  const docsUrl = (note.sourceEntries || []).map((entry) => entry.docsUrl).find(Boolean)
    || (/^https:\/\/docs\.google\.com\//i.test(note.source || "") ? note.source : null);
  if (!docsUrl) return;
  console.log(`Fetching Google Doc: ${docsUrl}`);
  const docHtml = await fetchGoogleDoc(docsUrl);
  if (!docHtml) return;
  const parsed = parseGoogleDoc(docHtml);
  if (parsed.sections.length === 0) return;
  note.title = parsed.title || note.title;
  note.sections = parsed.sections;
  note.source = docsUrl;
  note.workshopUrl = note.workshopUrl || CHANGELOG_URL;
  note.pendingImage = parsed.image || undefined;
  if (note.date && parsed.title) {
    note.slug = `${note.date}-${slugifyName(parsed.title) || note.slug?.split("-").slice(3).join("-") || "rebalance-patch"}`;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
