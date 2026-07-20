#!/usr/bin/env node
// Fuzzy-matches a cached transcript (see fetch-transcript.mjs) against this
// repo's canonical game data (content/game/{units,items,relics,synergies})
// so ASR-garbled names ("Lago" -> Largo, "lo" -> Lucid Star, etc.) can be
// resolved to real slugs.
//
// Outputs only entity names + mention counts (a factual index), never the
// underlying transcript prose, into cache/<videoId>.matches.json.
//
// Usage:
//   node scripts/build-guides/match-entities.mjs <videoId> [more videoIds...]

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");
const CONTENT_DIR = path.join(__dirname, "..", "..", "content", "game");

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

async function loadEntities(subdir, kind) {
  const dir = path.join(CONTENT_DIR, subdir);
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const entities = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(await readFile(path.join(dir, file), "utf-8"));
    const name = data.name || data.source?.names?.en || data.source?.name;
    if (!name) continue;
    entities.push({ kind, slug: data.slug || file.replace(/\.json$/, ""), name });
  }
  return entities;
}

async function loadAliases() {
  try {
    const raw = JSON.parse(
      await readFile(path.join(CONTENT_DIR, "aliases.json"), "utf-8"),
    );
    return Object.entries(raw).map(([alias, canonical]) => ({ alias, canonical }));
  } catch {
    return [];
  }
}

function ngrams(words, n) {
  const out = [];
  for (let i = 0; i + n <= words.length; i += 1) {
    out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}

function countMatches(entityNorm, transcriptWords) {
  const entityWordCount = entityNorm.split(" ").length;
  const candidates = ngrams(transcriptWords, entityWordCount);
  let count = 0;
  // Short names (e.g. "Io") are indistinguishable from common filler words
  // under fuzzy matching — require an exact hit for them.
  if (entityNorm.length <= 4) {
    for (const candidate of candidates) {
      if (candidate === entityNorm) count += 1;
    }
    return count;
  }
  for (const candidate of candidates) {
    if (candidate === entityNorm) {
      count += 1;
      continue;
    }
    // allow small ASR-level edit distance, scaled to name length
    const maxDist = Math.max(1, Math.floor(entityNorm.length * 0.2));
    if (levenshtein(candidate, entityNorm) <= maxDist) count += 1;
  }
  return count;
}

async function matchOne(videoId) {
  const transcriptPath = path.join(CACHE_DIR, `${videoId}.txt`);
  const text = await readFile(transcriptPath, "utf-8");
  const transcriptWords = normalize(text).split(" ");

  const [units, items, relics, synergies, aliases] = await Promise.all([
    loadEntities("units", "unit"),
    loadEntities("items", "item"),
    loadEntities("relics", "relic"),
    loadEntities("synergies", "synergy"),
    loadAliases(),
  ]);
  const entities = [...units, ...items, ...relics, ...synergies];

  const results = [];
  for (const entity of entities) {
    const count = countMatches(normalize(entity.name), transcriptWords);
    if (count > 0) results.push({ ...entity, mentions: count });
  }

  // aliases can surface entities whose canonical name diverges a lot from
  // common speech (kept separate since they map alias -> canonical name,
  // not slug -> canonical name)
  for (const { alias, canonical } of aliases) {
    const count = countMatches(normalize(alias), transcriptWords);
    if (count > 0) {
      const already = results.find((r) => normalize(r.name) === normalize(canonical));
      if (!already) results.push({ kind: "alias", slug: null, name: canonical, mentions: count });
    }
  }

  results.sort((a, b) => b.mentions - a.mentions);

  const outPath = path.join(CACHE_DIR, `${videoId}.matches.json`);
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(outPath, JSON.stringify(results, null, 2), "utf-8"),
  );

  console.log(`\n${videoId} — ${results.length} candidate entities matched:`);
  for (const r of results.slice(0, 40)) {
    console.log(`  ${String(r.mentions).padStart(3)}x  [${r.kind}]  ${r.name}`);
  }
  if (results.length > 40) console.log(`  ... +${results.length - 40} more (see ${outPath})`);
}

async function main() {
  const videoIds = process.argv.slice(2);
  if (videoIds.length === 0) {
    console.error("Usage: node scripts/build-guides/match-entities.mjs <videoId> [more...]");
    process.exit(1);
  }
  for (const id of videoIds) {
    await matchOne(id);
  }
}

main();
