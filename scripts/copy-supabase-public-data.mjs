#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envLocalPath = path.join(repoRoot, "web", ".env.local");
const targetEnvLocalPath = path.join(repoRoot, "web", ".env.tokyo.local");

const TABLES = [
  { name: "users", conflict: ["steam_id"], deleteColumn: "steam_id" },
  { name: "player_seasons", conflict: ["steam_id", "season"], deleteColumn: "steam_id" },
  { name: "matches", conflict: ["match_id"], deleteColumn: "match_id" },
  { name: "match_players", conflict: ["id"], deleteColumn: "id" },
  { name: "match_timelines", conflict: ["match_id"], deleteColumn: "match_id" },
  { name: "lineup_snapshots", conflict: ["id"], deleteColumn: "id" },
  { name: "mmr_snapshots", conflict: ["id"], deleteColumn: "id" },
  { name: "site_status", conflict: ["id"], deleteColumn: "id" },
];

const args = new Set(process.argv.slice(2));
const replace = args.has("--replace");
const dryRun = args.has("--dry-run");
const pageSize = Number(process.env.SUPABASE_COPY_PAGE_SIZE || 1000);

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const values = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }

  return values;
}

function required(name, value) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
}

const localEnv = loadDotEnv(envLocalPath);
const targetEnv = loadDotEnv(targetEnvLocalPath);
const sourceUrl = required(
  "source NEXT_PUBLIC_SUPABASE_URL in web/.env.local",
  process.env.SOURCE_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL,
);
const sourceKey = required(
  "source SUPABASE_SERVICE_ROLE_KEY in web/.env.local",
  process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY,
);
const targetUrl = required(
  "TARGET_SUPABASE_URL",
  process.env.TARGET_SUPABASE_URL ||
    targetEnv.TARGET_SUPABASE_URL ||
    "https://ismxtcfkuwpvfyuojnaa.supabase.co",
);
const targetKey = required(
  "TARGET_SUPABASE_SERVICE_ROLE_KEY",
  process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY ||
    targetEnv.TARGET_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.TOKYO_SUPABASE_SERVICE_ROLE_KEY,
);

const source = createClient(sourceUrl, sourceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const target = createClient(targetUrl, targetKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function countRows(client, table) {
  const { count, error } = await client
    .from(table)
    .select("*", { head: true, count: "exact" });
  if (error) throw new Error(`${table}: count failed: ${error.message}`);
  return count ?? 0;
}

async function fetchPage(table, from, to) {
  const { data, error } = await source.from(table).select("*").range(from, to);
  if (error) throw new Error(`${table}: read failed: ${error.message}`);
  return data ?? [];
}

async function deleteTargetTable(table) {
  const { error } = await target.from(table.name).delete().not(table.deleteColumn, "is", null);
  if (error) throw new Error(`${table.name}: delete failed: ${error.message}`);
}

async function upsertRows(table, rows) {
  if (rows.length === 0) return;
  const { error } = await target
    .from(table.name)
    .upsert(rows, { onConflict: table.conflict.join(",") });
  if (error) throw new Error(`${table.name}: upsert failed: ${error.message}`);
}

function rowConflictKey(table, row) {
  return table.conflict.map((column) => String(row[column])).join("\u001f");
}

function dedupeRows(table, rows) {
  const byKey = new Map();
  for (const row of rows) {
    byKey.set(rowConflictKey(table, row), row);
  }
  return [...byKey.values()];
}

async function copyTable(table) {
  const sourceCount = await countRows(source, table.name);
  console.log(`${table.name}: source rows ${sourceCount}`);

  let copied = 0;
  for (let from = 0; from < sourceCount; from += pageSize) {
    const to = Math.min(from + pageSize - 1, sourceCount - 1);
    const rows = dedupeRows(table, await fetchPage(table.name, from, to));
    if (!dryRun) await upsertRows(table, rows);
    copied += rows.length;
    console.log(`${table.name}: ${copied}/${sourceCount}`);
  }

  const targetCount = await countRows(target, table.name);
  console.log(`${table.name}: target rows ${targetCount}`);
  return { table: table.name, sourceCount, targetCount };
}

async function main() {
  console.log(`Source: ${sourceUrl}`);
  console.log(`Target: ${targetUrl}`);
  console.log(`Mode: ${replace ? "replace target tables first" : "upsert only"}${dryRun ? " (dry run)" : ""}`);

  if (replace) {
    for (const table of [...TABLES].reverse()) {
      if (dryRun) {
        console.log(`${table.name}: would clear target`);
      } else {
        await deleteTargetTable(table);
        console.log(`${table.name}: cleared target`);
      }
    }
  }

  const results = [];
  for (const table of TABLES) {
    results.push(await copyTable(table));
  }

  console.log("\nSummary");
  for (const result of results) {
    const ok = result.sourceCount === result.targetCount ? "OK" : "MISMATCH";
    console.log(`${result.table}: source=${result.sourceCount} target=${result.targetCount} ${ok}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
