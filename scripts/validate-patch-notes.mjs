#!/usr/bin/env node
/**
 * Validate patch-note labels, optionally against the newest saved VScript diff.
 *
 * Local pipeline (Steam Workshop item 1613886175 must already exist):
 *   npm run patch-notes:local
 *
 * Direct usage:
 *   node scripts/validate-patch-notes.mjs [patch.json]
 *     [--diff path/to/vscripts.diff | --diff-latest]
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyPatchNoteKind,
  PATCH_STAT_TERMS,
} from "./lib/patch-note-kind.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const PATCH_DIR = join(REPO_ROOT, "content", "patch-notes");
const DIFF_DIR = join(REPO_ROOT, "data", "vscript_diffs");

function patchEntries(patch) {
  return (patch.sections || []).flatMap((section) =>
    (section.entries || []).map((entry) => ({
      section: section.heading || "Unlabelled section",
      entry,
    })),
  );
}

export function validatePatchDocument(patch) {
  const mismatches = [];

  for (const { section, entry } of patchEntries(patch)) {
    const expected = classifyPatchNoteKind(entry.detail);
    if (entry.kind !== expected) {
      mismatches.push({
        section,
        name: entry.name,
        detail: entry.detail,
        actual: entry.kind,
        expected,
      });
    }
  }

  return { mismatches };
}

function normalizedWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function diffChunks(diffText) {
  const chunks = String(diffText || "").split(/(?=^diff --git )/m).filter(Boolean);
  return chunks.length > 0 ? chunks : [String(diffText || "")];
}

function statAppearsInDiff(stat, text) {
  const haystack = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return stat.key
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

export function crossCheckPatchAgainstDiff(patch, diffText) {
  const chunks = diffChunks(diffText);

  return patchEntries(patch).map(({ section, entry }) => {
    const entityWords = normalizedWords(entry.name).filter(
      (word) => !["ability", "item", "synergy"].includes(word),
    );
    const matchingChunks = chunks.filter((chunk) => {
      const normalizedChunk = chunk.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      return entityWords.some((word) => normalizedChunk.includes(word));
    });
    const relevantText = matchingChunks.join("\n");
    const matchedStats = PATCH_STAT_TERMS
      .filter(({ pattern }) => pattern.test(entry.detail || ""))
      .filter((stat) => statAppearsInDiff(stat, relevantText))
      .map(({ key }) => key);

    return {
      section,
      name: entry.name,
      matchedName: matchingChunks.length > 0,
      matchedStats: [...new Set(matchedStats)],
    };
  });
}

function newestJsonFile(directory) {
  const candidates = readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const path = join(directory, file);
      const patch = JSON.parse(readFileSync(path, "utf8"));
      return { path, date: patch.date || "" };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.path.localeCompare(a.path));
  if (candidates.length === 0) throw new Error(`No patch JSON files found in ${directory}`);
  return candidates[0].path;
}

function newestDiffFile(directory) {
  if (!existsSync(directory)) return null;
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".diff"))
    .sort()
    .reverse();
  return files[0] ? join(directory, files[0]) : null;
}

function parseArguments(argv) {
  let patchPath = null;
  let diffPath = null;
  let useLatestDiff = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--diff") {
      diffPath = argv[++index];
      if (!diffPath) throw new Error("--diff requires a file path");
    } else if (arg.startsWith("--diff=")) {
      diffPath = arg.slice("--diff=".length);
    } else if (arg === "--diff-latest") {
      useLatestDiff = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!patchPath) {
      patchPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return { patchPath, diffPath, useLatestDiff, help: false };
}

function printUsage() {
  console.log(
    "Usage: node scripts/validate-patch-notes.mjs [patch.json] " +
      "[--diff path/to/vscripts.diff | --diff-latest]",
  );
}

export function run(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    printUsage();
    return 0;
  }

  const patchPath = resolve(args.patchPath || newestJsonFile(PATCH_DIR));
  const patch = JSON.parse(readFileSync(patchPath, "utf8"));
  const { mismatches } = validatePatchDocument(patch);

  console.log(`Patch: ${patch.date || "unknown date"} — ${patch.title || basename(patchPath)}`);
  console.log(`File: ${patchPath}`);
  if (mismatches.length === 0) {
    console.log(`Labels: OK (${patchEntries(patch).length} entries checked)`);
  } else {
    console.error(`Labels: ${mismatches.length} mismatch(es)`);
    for (const mismatch of mismatches) {
      console.error(
        `  [${mismatch.section}] ${mismatch.name}: expected ${mismatch.expected}, ` +
          `found ${mismatch.actual}\n    ${mismatch.detail}`,
      );
    }
  }

  const diffPath = args.diffPath
    ? resolve(args.diffPath)
    : args.useLatestDiff
      ? newestDiffFile(DIFF_DIR)
      : null;
  if (args.useLatestDiff && !diffPath) {
    console.warn(`VScript diff: none found in ${DIFF_DIR}; skipping best-effort cross-check`);
  } else if (diffPath) {
    const checks = crossCheckPatchAgainstDiff(patch, readFileSync(diffPath, "utf8"));
    const nameMatches = checks.filter((check) => check.matchedName);
    const statMatches = checks.filter((check) => check.matchedStats.length > 0);
    console.log(`VScript diff: ${diffPath}`);
    console.log(
      `Cross-check: ${nameMatches.length}/${checks.length} names and ` +
        `${statMatches.length}/${checks.length} stat references found`,
    );
    for (const check of checks.filter((item) => !item.matchedName)) {
      console.warn(`  Unmapped (non-fatal): [${check.section}] ${check.name}`);
    }
  }

  return mismatches.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`Patch-note validation failed: ${error.message}`);
    process.exitCode = 2;
  }
}
