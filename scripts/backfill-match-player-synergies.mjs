#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, "web", ".env.local");
const UNITS_PATH = path.join(ROOT, "data", "units_full.json");
const ALIASES_PATH = path.join(ROOT, "data", "aliases.json");
const SYNERGIES_PATH = path.join(ROOT, "data", "synergies.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readEnv(filePath) {
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function canonicalUnitName(entry) {
  return String(entry || "")
    .replace(/\(\d+\)$/, "")
    .trim();
}

function buildLookups() {
  const units = readJson(UNITS_PATH);
  const aliases = readJson(ALIASES_PATH);
  const synergyData = readJson(SYNERGIES_PATH);

  const unitSynergies = new Map();
  for (const [name, info] of Object.entries(units)) {
    unitSynergies.set(name, Array.isArray(info.synergies) ? info.synergies : []);
  }
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (unitSynergies.has(canonical)) {
      unitSynergies.set(alias, unitSynergies.get(canonical));
    }
  }

  const minTierByName = new Map();
  for (const info of Object.values(synergyData)) {
    if (!info || typeof info !== "object" || !info.name) continue;
    const tiers = Array.isArray(info.tiers) ? info.tiers : [];
    const nums = tiers.map((tier) => Number(tier)).filter(Number.isFinite);
    if (nums.length > 0) minTierByName.set(info.name, Math.min(...nums));
  }

  return { unitSynergies, minTierByName };
}

function computeSynergies(lineup, lookups) {
  if (!lineup) return "";
  const counts = new Map();
  const seenUnitNames = new Set();
  for (const entry of String(lineup).split("|")) {
    const name = canonicalUnitName(entry);
    if (!name || seenUnitNames.has(name)) continue;
    seenUnitNames.add(name);
    for (const synergy of lookups.unitSynergies.get(name) || []) {
      counts.set(synergy, (counts.get(synergy) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([name, count]) => {
      const minTier = lookups.minTierByName.get(name);
      return minTier == null ? count > 1 : count >= minTier;
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name}:${count}`)
    .join("|");
}

async function supabaseFetch(url, key, route, init = {}) {
  const resp = await fetch(`${url.replace(/\/$/, "")}${route}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${route} failed: ${resp.status} ${body}`);
  }
  if (resp.status === 204) return null;
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

async function loadRows(url, key) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const route =
      "/rest/v1/match_players" +
      "?select=id,match_id,placement,chess_lineup,synergies" +
      "&order=id.asc" +
      `&limit=${pageSize}&offset=${offset}`;
    const page = await supabaseFetch(url, key, route, {
      headers: { Accept: "application/json" },
    });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const onlyMatchArg = process.argv.find((arg) => arg.startsWith("--match-id="));
  const onlyMatchId = onlyMatchArg ? onlyMatchArg.slice("--match-id=".length) : null;

  const env = readEnv(ENV_PATH);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in web/.env.local");
  }

  const lookups = buildLookups();
  const rows = await loadRows(url, key);
  const changes = rows
    .filter((row) => !onlyMatchId || row.match_id === onlyMatchId)
    .map((row) => ({
      ...row,
      computed: computeSynergies(row.chess_lineup, lookups),
    }))
    .filter((row) => (row.synergies || "") !== row.computed);

  console.log(
    `${apply ? "Applying" : "Dry run"}: ${changes.length} of ${rows.length} match_players rows need synergy updates.`
  );
  for (const row of changes.slice(0, 20)) {
    console.log(
      `#${row.id} match=${row.match_id} place=${row.placement}: ${row.synergies || "(empty)"} -> ${row.computed || "(empty)"}`
    );
  }
  if (changes.length > 20) {
    console.log(`... ${changes.length - 20} more`);
  }

  if (!apply) {
    console.log("Run again with --apply to write updates.");
    return;
  }

  for (const row of changes) {
    await supabaseFetch(url, key, `/rest/v1/match_players?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ synergies: row.computed || null }),
    });
  }
  console.log(`Updated ${changes.length} match_players rows.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
