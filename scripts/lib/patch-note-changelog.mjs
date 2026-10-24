import { createHash } from "node:crypto";

import { slugifyName } from "../../shared/slugify.mjs";
import { classifyPatchNoteKind, isChangelogNotice } from "./patch-note-kind.mjs";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const BULLET_RE = /^(?:[●•·▪◦*]\s*|-\s*)/;
const PATCH_TITLE_RE = /^(?:rebalance|minor balance|balance) patch\b/i;
// A Workshop headline is rendered in a local timezone (Steam defaults to
// Pacific). The matching UTC midnight can sit up to ~31h away from the
// update timestamp, so keep a little slack past that.
const TIMESTAMP_MATCH_MS = 40 * 60 * 60 * 1000;

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function changelogPageUrl(base, page) {
  const url = new URL(base);
  if (page > 1) url.searchParams.set("p", String(page));
  else url.searchParams.delete("p");
  return url.toString();
}

export function parseChangelogPaging(html) {
  const match = String(html || "").match(/Showing\s+([\d,]+)\s*-\s*([\d,]+)\s+of\s+([\d,]+)\s+entries/i);
  if (!match) return null;
  const start = Number(match[1].replace(/,/g, ""));
  const end = Number(match[2].replace(/,/g, ""));
  const total = Number(match[3].replace(/,/g, ""));
  if (![start, end, total].every((value) => Number.isInteger(value) && value >= 0)) return null;
  if (end < start || total < end) return null;
  return { start, end, total };
}

// The paging header wins. A "next" link is only a hint for markdown fallbacks
// that have no "Showing X-Y of N entries" line, including links that close on ")".
export function hasNextChangelogPage(html, page) {
  const paging = parseChangelogPaging(html);
  if (paging) return paging.end !== paging.total;
  return new RegExp(`[?&](?:amp;)?p=${page + 1}(?=&|["'\\s)]|$)`).test(String(html || ""));
}

export function assessChangelogFetch({ status = 200, html, entries } = {}) {
  if (status === 429) return { ok: false, reason: "rate-limited" };
  if (status !== 200) return { ok: false, reason: `http-${status}` };
  const paging = parseChangelogPaging(html);
  if (!paging) return { ok: false, reason: "missing-paging-header" };
  const lastPage = paging.end === paging.total;
  const parsedCount = Array.isArray(entries) ? entries.length : 0;
  // A page with no posts is a rate-limit shell or a parse failure unless the
  // header itself says this is the last page (Y == N).
  if (!lastPage && parsedCount === 0) return { ok: false, reason: "empty-page" };
  return { ok: true, paging, lastPage, hasNext: !lastPage };
}

export function takeEntriesUntilKnown(entries, isKnown) {
  const fresh = [];
  for (const entry of entries || []) {
    if (isKnown(entry)) return { fresh, reachedKnown: true };
    fresh.push(entry);
  }
  return { fresh, reachedKnown: false };
}

export async function collectChangelogPages({ fetchPage, isKnown, maxPages = 30 }) {
  if (typeof fetchPage !== "function") throw new Error("fetchPage is required");
  if (typeof isKnown !== "function") throw new Error("isKnown is required");

  const entries = [];
  let pagesFetched = 0;
  let reachedKnown = false;
  let exhausted = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    pagesFetched += 1;
    const pageEntries = Array.isArray(result) ? result : result?.entries || [];
    let assessment;
    if (result && (result.html != null || result.status != null)) {
      assessment = assessChangelogFetch({
        status: result.status ?? 200,
        html: result.html,
        entries: pageEntries,
      });
    } else if (result?.lastPage === true) {
      assessment = { ok: true, lastPage: true, hasNext: false };
    } else if (typeof result?.hasNext === "boolean" && pageEntries.length > 0) {
      assessment = { ok: true, lastPage: false, hasNext: result.hasNext };
    } else {
      assessment = { ok: false, reason: pageEntries.length === 0 ? "empty-page" : "missing-paging-header" };
    }
    if (!assessment.ok) {
      throw new Error(
        `Changelog page ${page} is not a usable Steam page (${assessment.reason}). Refusing to write.`,
      );
    }

    const taken = takeEntriesUntilKnown(pageEntries, isKnown);
    entries.push(...taken.fresh);
    if (taken.reachedKnown) {
      reachedKnown = true;
      break;
    }
    if (assessment.lastPage) {
      exhausted = true;
      break;
    }
    if (!assessment.hasNext) {
      throw new Error(
        `Changelog page ${page} ended before a known post without Showing Y of N. Refusing to write.`,
      );
    }
    if (page === maxPages) {
      throw new Error(
        `Changelog pagination stopped after ${maxPages} pages before reaching a known entry`,
      );
    }
  }

  return { entries, pagesFetched, reachedKnown, exhausted };
}

function monthIndex(month) {
  return MONTHS.indexOf(String(month || "").toLowerCase().slice(0, 3));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function yearClosestToTimestamp(stampSeconds, monthIdx, dayNum) {
  const instant = stampSeconds * 1000;
  const utcYear = new Date(instant).getUTCFullYear();
  let bestYear = null;
  let bestDelta = Infinity;
  for (const year of [utcYear - 1, utcYear, utcYear + 1]) {
    const midnight = Date.UTC(year, monthIdx, dayNum);
    const delta = Math.abs(midnight - instant);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestYear = year;
    }
  }
  return bestDelta <= TIMESTAMP_MATCH_MS ? bestYear : null;
}

function yearFromNewerDate(monthIdx, dayNum, newerIsoDate) {
  const match = String(newerIsoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const newerMonth = Number(match[2]) - 1;
  const newerDay = Number(match[3]);
  if (monthIdx > newerMonth || (monthIdx === newerMonth && dayNum > newerDay)) return year - 1;
  return year;
}

// Year comes from the entry's own Steam timestamp (the changelog <p id>, a
// unix time) or, failing that, from a newer entry already dated on the same
// page. It does not consult the current clock, so a December headline keeps
// its December year when the scrape runs in January.
export function changelogIsoDate({ month, day, sourceId, newerIsoDate } = {}) {
  const monthIdx = monthIndex(month);
  const dayNum = Number(day);
  if (monthIdx < 0 || !Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) return null;

  const stamp = Number(sourceId);
  let year = null;
  if (Number.isFinite(stamp) && stamp >= 1_000_000_000 && stamp < 10_000_000_000) {
    year = yearClosestToTimestamp(stamp, monthIdx, dayNum);
  }
  if (year == null) year = yearFromNewerDate(monthIdx, dayNum, newerIsoDate);
  if (year == null) return null;
  return `${year}-${pad(monthIdx + 1)}-${pad(dayNum)}`;
}

export function assignEntryDates(entries) {
  const dated = [];
  let newerIsoDate = null;
  for (const entry of entries || []) {
    const date = entry.date || changelogIsoDate({
      month: entry.month,
      day: entry.day,
      sourceId: entry.sourceId,
      newerIsoDate,
    });
    if (!date) continue;
    dated.push({ ...entry, date });
    newerIsoDate = date;
  }
  return dated;
}

function normalizeContent(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function entryContentHash(entry) {
  return createHash("sha256")
    .update(normalizeContent(entry?.content))
    .digest("hex")
    .slice(0, 16);
}

export function sourceEntryRecord(entry) {
  return {
    sourceId: entry.sourceId || undefined,
    date: entry.date,
    time: entry.time,
    docsUrl: entry.docsUrl || undefined,
    contentHash: entryContentHash(entry),
  };
}

function cleanupPlainText(value) {
  return decodeHtmlEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/%5B\/img%5D|\[\/img\]/gi, "")
    .replace(/\s*\[[a-z0-9.-]+\.[a-z]{2,}\]/gi, "")
    .replace(/([a-z])\.([A-Z])/g, "$1. $2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripChangelogBullet(line) {
  return String(line || "").trim().replace(BULLET_RE, "").trim();
}

export function isGenericBugfixText(value) {
  const text = stripChangelogBullet(cleanupPlainText(value))
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return /^(?:fix bugs?|fixed bugs?|bug ?fixes?)(?: and test)?$/.test(text);
}

function isSkippableLine(line) {
  const text = stripChangelogBullet(line);
  if (!text) return true;
  if (/^click the title link\b/i.test(text)) return true;
  if (/^discuss this update\b/i.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/\.(?:png|jpe?g|gif|webp)(?:\b|%5B|\[)/i.test(text) && /^https?:\/\//i.test(text.replace(/^[^h]*/i, ""))) {
    return true;
  }
  if (/^https?:\/\/\S+$/i.test(text.replace(/\s+/g, ""))) return true;
  if (/\.(?:png|jpe?g|gif|webp)/i.test(text) && text.split(/\s+/).length <= 3) return true;
  return false;
}

function nextNonEmpty(lines, index) {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].trim()) return lines[cursor];
  }
  return "";
}

function isStandaloneTitle(line, following) {
  if (BULLET_RE.test(line.trim())) return false;
  const text = stripChangelogBullet(line);
  if (!text || text.includes(":")) return false;
  if (PATCH_TITLE_RE.test(text)) return true;
  if (!following || !BULLET_RE.test(following.trim())) return false;
  if (text.length > 90 || /[.!]$/.test(text)) return false;
  return true;
}

function displayPatchTitle(title) {
  const cleaned = cleanupPlainText(stripChangelogBullet(title)).replace(/\s+/g, " ").trim();
  if (PATCH_TITLE_RE.test(cleaned)) return cleaned.replace(/\s+\d+$/, "").trim();
  return cleaned;
}

function contentColonIndex(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== ":") continue;
    if (text[index + 1] === "/" && text[index + 2] === "/") continue;
    return index;
  }
  return -1;
}

function sentenceCase(value) {
  return String(value || "").replace(/^([a-z])/, (letter) => letter.toUpperCase());
}

function firstSentenceOutsideParens(text) {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "（") depth += 1;
    else if (char === ")" || char === "）") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[.!?]/.test(char) && text[index + 1] === " " && index >= 11) {
      const name = text.slice(0, index + 1);
      if (name.includes("（") && !name.includes("）")) return null;
      if ((name.match(/\(/g) || []).length !== (name.match(/\)/g) || []).length) return null;
      return name;
    }
  }
  return null;
}

export function splitChangelogLine(line) {
  const cleaned = cleanupPlainText(stripChangelogBullet(line)).replace(/\s+/g, " ").trim();
  if (!cleaned || isSkippableLine(cleaned)) return null;
  if (isGenericBugfixText(cleaned)) return { name: "Fix bug", detail: "Fix bug" };

  const colon = contentColonIndex(cleaned);
  if (colon > 0) {
    const name = sentenceCase(cleaned.slice(0, colon).trim());
    const detail = cleaned.slice(colon + 1).trim();
    if (name && detail && !/^https?$/i.test(name)) return { name, detail };
  }

  const removed = cleaned.match(/^(.+?)\s+removed$/i);
  if (removed && removed[1].trim().length > 1 && removed[1].trim().length <= 40) {
    return { name: sentenceCase(removed[1].trim()), detail: "Removed" };
  }

  const display = sentenceCase(cleaned);
  if (display.length > 80) {
    const sentence = firstSentenceOutsideParens(display);
    const rest = sentence ? display.slice(sentence.length).trim() : "";
    // The remainder is its own detail. Keeping the full paragraph as the
    // detail repeats the first sentence next to the name, and the page then
    // hides that detail and drops the tail.
    if (sentence && rest) return { name: sentence, detail: rest };
  }

  return { name: display, detail: display };
}

export function parseChangelogBody(content) {
  const lines = cleanupPlainText(content).split(/\n/);
  let title = null;
  const entries = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw || isSkippableLine(raw)) continue;
    if (isStandaloneTitle(raw, nextNonEmpty(lines, index))) {
      if (!title) title = displayPatchTitle(raw);
      continue;
    }
    const split = splitChangelogLine(raw);
    if (!split) continue;
    entries.push({
      kind: classifyPatchNoteKind(split.detail, split.name),
      name: split.name,
      detail: split.detail,
    });
  }

  return { title, entries: dedupeEntries(entries) };
}

function dedupeEntries(entries) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const key = `${entry.kind}|${entry.name}|${entry.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function entryText(entry) {
  return `${entry?.name || ""}\n${entry?.detail || ""}`;
}

function isGenericHotfixEntry(entry) {
  return isGenericBugfixText(entry?.detail) && (isGenericBugfixText(entry?.name) || entry?.name === entry?.detail);
}

function hasStatChange(text) {
  return /\b(?:increased|decreased|reduced|lowered|raised|improved|reworked|downgraded|upgraded)\b/i.test(text)
    && /\b(?:from|to|by)\b/i.test(text);
}

function isNoticeEntry(entry) {
  return isChangelogNotice(entryText(entry));
}

function isBalanceEntry(entry) {
  if (isGenericHotfixEntry(entry)) return false;
  const text = entryText(entry);
  if (isNoticeEntry(entry) && !hasStatChange(text)) return false;
  if (entry?.detail && /^removed$/i.test(entry.detail)) return true;
  if (hasStatChange(text)) return true;
  if (/\bnew\s+(?:t\d\s+)?(?:item|relic|unit|chess|piece)\b/i.test(text)) return true;
  if (/\bclass changed\b/i.test(text)) return true;
  return false;
}

export function classifyParsedPost(title, entries) {
  if (!entries?.length) return "skip";
  if (title && PATCH_TITLE_RE.test(title)) return "patch";
  if (entries.some(isBalanceEntry)) return "patch";
  if (entries.every(isGenericHotfixEntry)) return "hotfix";
  if (entries.some(isNoticeEntry) && !entries.some(isBalanceEntry)) return "notice";
  if (entries.every((entry) => isGenericHotfixEntry(entry) || entry.kind === "fix")) return "hotfix";
  return "minor";
}

export function classifyChangelogPost(content) {
  const parsed = parseChangelogBody(content);
  return classifyParsedPost(parsed.title, parsed.entries);
}

function inferNoticeTitle(entries) {
  const text = entries.map(entryText).join("\n");
  if (/drodo notice|hosted locally|server restrictions/i.test(text)) return "Hosting Notice";
  if (/attempting to reopen/i.test(text)) return "Ranked Mode Reopening";
  if (/rank(?:ed)?\s*mode closed|closed tempoparily|closed temporarily/i.test(text)) return "Ranked Mode Closed";
  if (/xiaoheihe|cannot launch games inside/i.test(text)) return "Arcade Maintenance";
  if (/battle pass/i.test(text)) return "Battle Pass";
  if (/pass priorities/i.test(text)) return "Pass Priorities";
  if (/kicked off/i.test(text)) return "Season Start";
  return "Notice";
}

export function titleForChangelogPost(category, explicitTitle, entries = []) {
  if (category === "patch") {
    return explicitTitle ? displayPatchTitle(explicitTitle) : "Rebalance Patch";
  }
  if (explicitTitle && !PATCH_TITLE_RE.test(explicitTitle)) return explicitTitle;
  if (category === "hotfix") return "Hotfix";
  if (category === "minor") {
    if (entries.length === 1 && entries[0]?.name) return entries[0].name;
    return "Minor Patch";
  }
  if (category === "notice") return inferNoticeTitle(entries);
  return "Rebalance Patch";
}

function timeToMinutes(time) {
  const match = String(time || "").match(/(\d+):(\d+)\s*([ap]m)/i);
  if (!match) return 0;
  let hours = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "pm") hours += 12;
  return hours * 60 + Number(match[2]);
}

function sectionsFor(category, entries) {
  const fixes = entries.filter((entry) => entry.kind === "fix" && !isNoticeEntry(entry));
  const rest = entries.filter((entry) => !fixes.includes(entry));
  if (category === "hotfix") return [{ heading: "Hotfix", entries }];
  if (category === "notice" && fixes.length > 0 && rest.length > 0) {
    return [
      { heading: "Notice", entries: rest },
      { heading: "Bug Fixes", entries: fixes },
    ];
  }
  if (category === "notice") return [{ heading: "Notice", entries }];
  return [{ heading: "Changes", entries }];
}

export function buildPatchFromDay(dayEntries, { changelogUrl } = {}) {
  const ordered = [...(dayEntries || [])].sort((a, b) => {
    const byTime = timeToMinutes(a.time) - timeToMinutes(b.time);
    if (byTime !== 0) return byTime;
    return String(a.sourceId || "").localeCompare(String(b.sourceId || ""));
  });
  const parts = ordered
    .map((entry) => parseChangelogBody(entry.content))
    .filter((part) => part.entries.length > 0 || part.title);
  const entries = dedupeEntries(parts.flatMap((part) => part.entries));
  const explicitTitle = parts.map((part) => part.title).find(Boolean) || null;
  const category = classifyParsedPost(explicitTitle, entries);
  if (category === "skip") return null;

  const docsUrl = ordered.find((entry) => entry.docsUrl)?.docsUrl || null;
  return {
    date: ordered.find((entry) => entry.date)?.date,
    title: titleForChangelogPost(category, explicitTitle, entries),
    category,
    source: docsUrl || changelogUrl,
    workshopUrl: docsUrl ? changelogUrl : undefined,
    docsUrl,
    sourceEntries: ordered.filter((entry) => normalizeContent(entry.content)).map(sourceEntryRecord),
    sections: sectionsFor(category, entries),
  };
}

const BUGFIX_ROLLUP_TITLE = "Fixed a number of bugs";
const BUGFIX_ENTRY_NAME = "Workshop bugfixes";
const MAX_LISTED_BUGFIX_DATES = 4;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatShortDate(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(iso || "");
  return `${SHORT_MONTHS[Number(match[2]) - 1]} ${Number(match[3])}`;
}

function entrySortKey(entry) {
  return `${entry.date || ""}#${String(timeToMinutes(entry.time)).padStart(4, "0")}#${entry.sourceId || ""}`;
}

function emptyContentHash() {
  return entryContentHash({ content: "" });
}

export function isGenericBugfixPost(content) {
  const parsed = parseChangelogBody(content);
  return parsed.entries.length > 0 && parsed.entries.every(isGenericHotfixEntry);
}

export function noteClosesBugfixRollup(note) {
  if (!note || note.rollup === "bugfixes") return false;
  // Category survives a save. The in-memory flag does not, and a balance post
  // merged into a same-day notice used to keep the old title, so the next
  // hourly run treated the patch as still open.
  if (note.category === "patch") return true;
  if (note.closesBugfixRollup === true) return true;
  if (note.closesBugfixRollup === false) return false;
  const title = String(note.title || "");
  if (/^fixed a number of bugs$/i.test(title)) return false;
  if (/^(hotfix|minor patch)$/i.test(title)) return false;
  if (note.category === "hotfix" || note.category === "minor" || note.category === "notice") return false;
  if (/notice|reopening|maintenance|battle pass|pass priorities|ranked mode|hosting/i.test(title)) return false;
  return true;
}

function cloneNote(note) {
  return {
    ...note,
    sourceEntries: [...(note.sourceEntries || [])],
    sections: (note.sections || []).map((section) => ({
      ...section,
      entries: [...(section.entries || [])],
    })),
    dirty: false,
  };
}

function noteHasSource(note, entry) {
  if (entry.sourceId && (note.sourceEntries || []).some((item) => String(item.sourceId) === String(entry.sourceId))) {
    return true;
  }
  if (!entry.date || !entry.time) return false;
  const key = `${entry.date}|${entry.time}|${entryContentHash(entry)}`;
  return (note.sourceEntries || []).some((item) => `${item.date}|${item.time}|${item.contentHash}` === key);
}

function pushSource(note, entry) {
  if (noteHasSource(note, entry)) return;
  note.sourceEntries.push(sourceEntryRecord(entry));
  note.dirty = true;
}

function formatBugfixDateList(dates) {
  const listed = dates.map(formatShortDate);
  if (listed.length <= MAX_LISTED_BUGFIX_DATES) return listed.join(", ");
  const shown = listed.slice(0, MAX_LISTED_BUGFIX_DATES - 1);
  const rest = listed.length - shown.length;
  return `${shown.join(", ")}, and ${rest} more`;
}

function bugfixDetail(sourceEntries) {
  const real = (sourceEntries || []).filter((item) => item.contentHash !== emptyContentHash());
  const dates = [...new Set(real.map((item) => item.date).filter(Boolean))].sort();
  if (dates.length === 0) return "";
  const posts = `${real.length} Workshop post${real.length === 1 ? "" : "s"}`;
  if (dates.length === 1) return `${posts} on ${formatShortDate(dates[0])}.`;
  const listed = dates.map(formatShortDate);
  return `${posts} from ${listed[0]} through ${listed.at(-1)} (${formatBugfixDateList(dates)}).`;
}

function refreshBugfixSummary(note) {
  const detail = bugfixDetail(note.sourceEntries);
  note.sections = detail
    ? [{
      heading: "Bug Fixes",
      entries: [{ kind: "fix", name: BUGFIX_ENTRY_NAME, detail }],
    }]
    : [];
}

function sourceSortKey(item) {
  return `${item?.date || ""}#${String(timeToMinutes(item?.time)).padStart(4, "0")}#${item?.sourceId || ""}`;
}

function closeKey(note) {
  if (note.sortKey) return note.sortKey;
  const keys = (note.sourceEntries || []).map(sourceSortKey).filter((key) => !key.startsWith("#"));
  if (keys.length > 0) return keys.sort().at(-1);
  return `${note.date || ""}#9999#`;
}

function openedKey(note) {
  if (note.openedSortKey) return note.openedSortKey;
  const keys = (note.sourceEntries || []).map(sourceSortKey).filter((key) => !key.startsWith("#"));
  if (keys.length > 0) return keys.sort()[0];
  return `${note.openedOn || note.date || ""}#0000#`;
}

function openBugfixRollup(notes, beforeKey) {
  let lastClose = "";
  for (const note of notes) {
    if (!noteClosesBugfixRollup(note)) continue;
    const key = closeKey(note);
    if (key < beforeKey && key > lastClose) lastClose = key;
  }
  const open = notes.filter((note) => {
    if (note.rollup !== "bugfixes") return false;
    const opened = openedKey(note);
    return opened > lastClose;
  });
  open.sort((left, right) => (left.openedSortKey || "").localeCompare(right.openedSortKey || ""));
  return open.at(-1) || null;
}

function newestVisibleNote(notes, entry) {
  const dated = notes.filter((note) => (note.sections || []).length > 0 && (note.date || "") <= (entry.date || "9999"));
  dated.sort((left, right) => (right.date || "").localeCompare(left.date || "") || closeKey(right).localeCompare(closeKey(left)));
  return dated[0] || null;
}

function mergeSections(existing, incoming) {
  const sections = existing.map((section) => ({
    ...section,
    entries: [...(section.entries || [])],
  }));
  for (const section of incoming || []) {
    let host = sections.find((item) => item.heading === section.heading);
    if (!host) {
      host = { heading: section.heading, entries: [] };
      sections.push(host);
    }
    for (const entry of section.entries || []) {
      if (isGenericHotfixEntry(entry)) continue;
      if (host.entries.some((item) => item.name === entry.name && item.detail === entry.detail)) continue;
      host.entries.push(entry);
    }
  }
  return sections.filter((section) => section.entries.length > 0);
}

function findRepeatNotice(notes, entry) {
  const parsed = parseChangelogBody(entry.content);
  if (classifyParsedPost(parsed.title, parsed.entries) !== "notice") return null;
  const hash = entryContentHash(entry);
  if (!hash || hash === emptyContentHash()) return null;
  return notes.find((note) => (
    note.category === "notice" || /notice|ranked mode|maintenance|battle pass|pass priorities|hosting/i.test(note.title || "")
  ) && (note.sourceEntries || []).some((item) => item.contentHash === hash)) || null;
}

function appendBugfix(notes, entry, changelogUrl) {
  const key = entrySortKey(entry);
  let rollup = openBugfixRollup(notes, key);
  if (!rollup) {
    rollup = {
      rollup: "bugfixes",
      category: "hotfix",
      closesBugfixRollup: false,
      title: BUGFIX_ROLLUP_TITLE,
      openedOn: entry.date,
      openedSortKey: key,
      date: entry.date,
      sortKey: key,
      slug: `${entry.date}-fixed-a-number-of-bugs`,
      source: changelogUrl,
      entitiesSynced: false,
      sourceEntries: [],
      sections: [],
      dirty: true,
    };
    notes.push(rollup);
  }
  pushSource(rollup, entry);
  if ((entry.date || "") > (rollup.date || "")) rollup.date = entry.date;
  rollup.sortKey = key;
  refreshBugfixSummary(rollup);
}

function mergeSubstantive(notes, entry, changelogUrl) {
  const built = buildPatchFromDay([entry], { changelogUrl });
  if (!built) {
    const host = newestVisibleNote(notes, entry);
    if (host) pushSource(host, entry);
    return;
  }
  const sameDay = notes.find((note) => note.date === entry.date && note.rollup !== "bugfixes");
  if (sameDay) {
    const incomingSections = sameDay.category === "notice"
      ? built.sections.map((section) => (
        section.heading === "Hotfix" ? { ...section, heading: "Bug Fixes" } : section
      ))
      : built.sections;
    sameDay.sections = mergeSections(sameDay.sections, incomingSections);
    pushSource(sameDay, entry);
    if (built.category === "patch") {
      sameDay.category = "patch";
      sameDay.closesBugfixRollup = true;
      if (!/rebalance patch|balance patch/i.test(sameDay.title || "")) {
        sameDay.title = built.title || "Rebalance Patch";
      }
    } else if (!sameDay.category) {
      sameDay.category = built.category;
      sameDay.closesBugfixRollup = false;
    }
    const key = entrySortKey(entry);
    if (key > (sameDay.sortKey || "")) sameDay.sortKey = key;
    sameDay.dirty = true;
    return;
  }
  const slug = `${built.date}-${slugifyName(built.title) || "rebalance-patch"}`;
  const sameSlug = notes.find((note) => note.slug === slug);
  if (sameSlug) {
    sameSlug.sections = mergeSections(sameSlug.sections, built.sections);
    pushSource(sameSlug, entry);
    if (built.category === "patch") {
      sameSlug.category = "patch";
      sameSlug.closesBugfixRollup = true;
      if (!/rebalance patch|balance patch/i.test(sameSlug.title || "")) {
        sameSlug.title = built.title || "Rebalance Patch";
      }
    }
    sameSlug.dirty = true;
    return;
  }
  notes.push({
    ...built,
    slug,
    category: built.category,
    closesBugfixRollup: built.category === "patch",
    openedOn: built.date,
    openedSortKey: entrySortKey(entry),
    sortKey: entrySortKey(entry),
    entitiesSynced: false,
    dirty: true,
  });
}

// Fold incoming Workshop posts into the notes a scheduled run should publish.
// Generic bugfix posts join one open rollup until a balance patch. Identical
// notices keep a single copy. An empty body records its Steam id and adds no
// line. A later post on a day that already has a note updates that note.
export function applyIncomingEntries(notes, entries, { changelogUrl } = {}) {
  const state = (notes || []).map(cloneNote);
  const ordered = [...(entries || [])]
    .filter((entry) => entry?.date)
    .sort((left, right) => entrySortKey(left).localeCompare(entrySortKey(right)));

  for (const entry of ordered) {
    if (state.some((note) => noteHasSource(note, entry))) continue;
    if (!normalizeContent(entry.content)) {
      const host = openBugfixRollup(state, entrySortKey(entry)) || newestVisibleNote(state, entry);
      if (host) pushSource(host, entry);
      continue;
    }
    if (isGenericBugfixPost(entry.content)) {
      appendBugfix(state, entry, changelogUrl);
      continue;
    }
    const repeat = findRepeatNotice(state, entry);
    if (repeat) {
      pushSource(repeat, entry);
      continue;
    }
    mergeSubstantive(state, entry, changelogUrl);
  }

  return state;
}

function headlineParts(block) {
  const match = block.match(/Update:\s*(?:(\d+)\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d+))\s*@\s*([\d:]+[ap]m)/i);
  if (!match) return null;
  return {
    day: match[1] || match[4],
    month: match[2] || match[3],
    time: match[5].toLowerCase(),
  };
}

function docsUrlFromHtml(rawHtml) {
  const filtered = rawHtml.match(/href="[^"]*linkfilter\/\?u=(https?%3A%2F%2Fdocs\.google\.com%2F[^"&]+)"/i);
  if (filtered) return decodeURIComponent(filtered[1]);
  const direct = rawHtml.match(/href="(https:\/\/docs\.google\.com\/document\/d\/[^"]+\/pub)"/i);
  return direct ? direct[1] : null;
}

function decodeSteamHref(attrs) {
  const match = String(attrs || "").match(/href="([^"]+)"/i);
  if (!match) return "";
  let href = decodeHtmlEntities(match[1]);
  const filtered = href.match(/[?&]u=([^&]+)/i);
  if (filtered) {
    try {
      href = decodeURIComponent(filtered[1]);
    } catch {
      href = filtered[1];
    }
  }
  return href.replace(/%5B\/img%5D|\[\/img\]/gi, "");
}

const KNOWN_NOTICE_FRAGMENTS = [
  ["launch", /due to maintenance of the dota\s*2 arcade system, you cannot launch games inside dota\s*2 for now\.?\s*download xiaoheihe to play\.?/gi],
  ["recruit", /if you cannot see any model in (?:the )?recruit panel, pls enhance your dota\s*2 video settings slightly\.?/gi],
  ["register", /if you cannot register within the app, complete quick registration (?:at|on) (?:this site|the xiaoheihe site|https?:\/\/\S+)\.?/gi],
  ["download", /download (?:the )?xiaoheihe pc client\b[\s\S]{0,300}?browser may fail to download\.?\)?/gi],
  ["download", /\(?right-click this link\b[\s\S]{0,220}?browser may fail to download\.?\)?/gi],
  ["download", /download (?:the )?xiaoheihe pc client\b(?:\s*\(https?:\/\/[^)]+\))?/gi],
];

// Steam's editor uses fullwidth parentheses and non-breaking hyphens in the
// download warning. Fold those to ASCII before matching the known sentences.
function normalizeNoticePunctuation(text) {
  return String(text || "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\uFF08/g, "(")
    .replace(/\uFF09/g, ")");
}

// Replace only the known Xiaoheihe sentences, even when Steam glues two of
// them onto one line. Everything else in the post is kept.
function polishKnownNotices(text, links) {
  const client = links.find((url) => /dota\.xiaoheihe\.cn/i.test(url)) || "";
  const site = links.find((url) => /xiaoheihe\.cn/i.test(url) && !/dota\.xiaoheihe\.cn/i.test(url)) || "";
  const found = { download: false, launch: false, register: false, recruit: false };
  const extra = [];
  for (const raw of String(text || "").split("\n")) {
    let rest = normalizeNoticePunctuation(raw).replace(/\s+/g, " ").trim();
    if (!rest) continue;
    for (const [key, pattern] of KNOWN_NOTICE_FRAGMENTS) {
      pattern.lastIndex = 0;
      if (!pattern.test(rest)) continue;
      found[key] = true;
      pattern.lastIndex = 0;
      rest = rest.replace(pattern, " ");
    }
    rest = rest.replace(/\s+/g, " ").replace(/^[.\s()]+|[.\s()]+$/g, "").trim();
    if (rest && !/^https?:\/\/\S+$/i.test(rest)) extra.push(rest);
  }
  if (!found.download && !found.launch && !found.register && !found.recruit) return text;
  const clientUrl = client || "https://dota.xiaoheihe.cn/";
  const siteUrl = site || "https://www.xiaoheihe.cn/";
  const polished = [];
  if (found.launch) {
    polished.push("Due to maintenance of the DOTA2 Arcade system, you cannot launch games inside DOTA2 for now. Download Xiaoheihe to play.");
  }
  if (found.download) {
    polished.push(`Download the Xiaoheihe PC client. Open ${clientUrl} in your system browser. The built-in Dota 2 browser may fail.`);
  }
  if (found.register) {
    polished.push(`If you cannot register within the app, complete quick registration on the Xiaoheihe site. The site is ${siteUrl}.`);
  }
  if (found.recruit) {
    polished.push("If you cannot see any model in recruit panel, pls enhance your dota2 video settings slightly.");
  }
  return [...polished, ...extra].join("\n");
}

function plainTextFromHtml(rawHtml) {
  const links = [];
  const withLinks = rawHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, inner) => {
      const href = decodeSteamHref(attrs);
      const label = decodeHtmlEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      if (href) links.push(href);
      if (href && /\.(?:png|jpe?g|gif|webp)(?:$|\?|\[)/i.test(href)) return "";
      if (href && label && !label.includes(href) && label.length <= 80) return `${label} (${href})`;
      return label;
    })
    .replace(/<[^>]+>/g, "");
  return polishKnownNotices(cleanupPlainText(withLinks), links);
}

export function parseChangelogEntries(html) {
  const pending = [];
  for (const block of String(html || "").split(/changeLogCtn/)) {
    const headline = headlineParts(block);
    if (!headline) continue;
    const contentMatch = block.match(/<p\s+id="([^"]*)">([\s\S]*?)<\/p>/i);
    if (!contentMatch) continue;
    const content = plainTextFromHtml(contentMatch[2]);
    // An empty body still carries a Steam id. Callers record the id and do
    // not publish a note for it.
    pending.push({
      ...headline,
      content,
      docsUrl: docsUrlFromHtml(contentMatch[2]),
      sourceId: contentMatch[1].trim() || null,
    });
  }
  return assignEntryDates(pending);
}

function docsUrlFromReaderLine(line) {
  const filtered = line.match(/\[([^\]]+)\]\((https:\/\/steamcommunity\.com\/linkfilter\/\?u=([^)]+))\)/i);
  if (filtered && /docs\.google\.com/i.test(filtered[3])) {
    return { text: filtered[1].trim(), docsUrl: decodeURIComponent(filtered[3]) };
  }
  const direct = line.match(/\[([^\]]+)\]\((https:\/\/docs\.google\.com\/document\/d\/[^)]+\/pub)\)/i);
  if (direct) return { text: direct[1].trim(), docsUrl: direct[2] };
  return null;
}

export function parseChangelogReaderEntries(markdown) {
  const source = String(markdown || "");
  const updateRegex = /^Update:\s*(?:(\d+)\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d+))\s+@\s*([\d:]+[ap]m)\s*$/gim;
  const matches = [...source.matchAll(updateRegex)];
  const pending = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const lines = source.slice(start, end).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let docsUrl = null;
    const contentLines = [];
    for (const line of lines) {
      if (
        line.startsWith("![") ||
        /^Title:/i.test(line) ||
        /^URL Source:/i.test(line) ||
        /^Published Time:/i.test(line) ||
        /^Markdown Content:/i.test(line) ||
        /^Click the title link/i.test(line) ||
        /^Discuss this update/i.test(line)
      ) {
        continue;
      }
      const docs = docsUrlFromReaderLine(line);
      if (docs) {
        docsUrl = docs.docsUrl;
        if (docs.text) contentLines.push(docs.text);
        continue;
      }
      contentLines.push(line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
    }
    const content = cleanupPlainText(contentLines.join("\n"));
    if (!normalizeContent(content)) continue;
    pending.push({
      day: match[1] || match[4],
      month: match[2] || match[3],
      time: match[5].toLowerCase(),
      content,
      docsUrl,
      sourceId: null,
    });
  }

  // Dates are resolved by the caller after the newest Steam update id is
  // attached. Doing it here would drop a January-scraped December entry
  // whenever the reader markdown has no per-entry timestamp.
  return pending;
}

export function parseChangelogPayload(payload) {
  if (/changeLogCtn/i.test(payload) && /<p\s+id=/i.test(payload)) {
    const htmlEntries = parseChangelogEntries(payload);
    if (htmlEntries.length > 0) return htmlEntries;
  }
  return assignEntryDates(parseChangelogReaderEntries(payload));
}
