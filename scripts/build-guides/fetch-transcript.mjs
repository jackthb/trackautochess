#!/usr/bin/env node
// Fetches YouTube caption transcripts for build-guide videos into a local,
// gitignored cache (see .gitignore: "third-party video transcripts, not
// ours to host" — same rationale as data/vscripts/).
//
// Usage:
//   node scripts/build-guides/fetch-transcript.mjs <youtube-url-or-id> [more...]

import { YoutubeTranscript } from "youtube-transcript";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");

function extractVideoId(input) {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.slice(1);
    }
    const v = url.searchParams.get("v");
    if (v) return v;
    const shortsMatch = url.pathname.match(/\/shorts\/([\w-]{11})/);
    if (shortsMatch) return shortsMatch[1];
  } catch {
    // not a URL
  }
  throw new Error(`Could not extract a video ID from "${input}"`);
}

async function fetchOne(rawInput) {
  const videoId = extractVideoId(rawInput);
  const outFile = path.join(CACHE_DIR, `${videoId}.txt`);
  const metaFile = path.join(CACHE_DIR, `${videoId}.meta.json`);

  const segments = await YoutubeTranscript.fetchTranscript(videoId);
  const text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(outFile, text, "utf-8");
  await writeFile(
    metaFile,
    JSON.stringify(
      {
        videoId,
        sourceUrl: rawInput.startsWith("http")
          ? rawInput
          : `https://www.youtube.com/watch?v=${videoId}`,
        fetchedAt: new Date().toISOString(),
        segmentCount: segments.length,
        wordCount,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`✓ ${videoId}: ${segments.length} segments, ~${wordCount} words -> cache/${videoId}.txt`);
  return videoId;
}

async function main() {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error("Usage: node scripts/build-guides/fetch-transcript.mjs <youtube-url-or-id> [more...]");
    process.exit(1);
  }

  const results = [];
  for (const input of inputs) {
    try {
      results.push(await fetchOne(input));
    } catch (err) {
      console.error(`✗ ${input}: ${err.message}`);
    }
  }

  console.log(`\nDone. ${results.length}/${inputs.length} fetched.`);
  if (results.length) {
    console.log(`Next: node scripts/build-guides/match-entities.mjs ${results.join(" ")}`);
  }
}

main();
