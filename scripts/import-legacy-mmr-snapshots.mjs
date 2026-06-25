#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, "web", ".env.local");
const CONFLICT_TARGET =
  "steam_id,season,snapshot_date,mmr,chicken_count,queen_rank";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
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

const envFile = readEnvFile(ENV_PATH);

function env(name, source = envFile) {
  return process.env[name] ?? source[name] ?? null;
}

function argValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((value) => value === name || value.startsWith(prefix));
  if (!arg) return null;
  return arg === name ? "true" : arg.slice(prefix.length);
}

function intOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function isoOrNull(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function toSnapshotRow(row) {
  const snapshottedAt = isoOrNull(row.snapshotted_at);
  if (!row.steam_id || !snapshottedAt) return null;
  return {
    steam_id: String(row.steam_id),
    season: row.season ?? null,
    mmr: intOrNull(row.mmr),
    chicken_count: intOrNull(row.chicken_count),
    queen_rank: intOrNull(row.queen_rank),
    snapshotted_at: snapshottedAt,
    snapshot_date: snapshottedAt.slice(0, 10),
  };
}

function uniqueRows(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = [
      row.steam_id,
      row.season ?? "",
      row.snapshot_date,
      row.mmr ?? "",
      row.chicken_count ?? "",
      row.queen_rank ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

class SupabaseRest {
  constructor(url, key) {
    this.base = `${url.replace(/\/$/, "")}/rest/v1`;
    this.key = key;
  }

  async request(path, { method = "GET", query, body, headers = {} } = {}) {
    const url = new URL(`${this.base}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${method} ${url.pathname}${url.search} failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  selectSnapshots({ limit, offset, steamId, since, until }) {
    return this.request("mmr_snapshots", {
      query: {
        select: "*",
        order: "snapshotted_at.asc,id.asc",
        limit,
        offset,
        ...(steamId ? { steam_id: `eq.${steamId}` } : {}),
        ...(since ? { snapshotted_at: `gte.${since}` } : {}),
        ...(until ? { snapshotted_at: `lt.${until}` } : {}),
      },
      headers: { Accept: "application/json" },
    });
  }

  insertSnapshots(rows) {
    return this.request("mmr_snapshots", {
      method: "POST",
      query: { on_conflict: CONFLICT_TARGET },
      body: rows,
      headers: {
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
    });
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pageSize = Math.max(1, Math.min(1000, Number(argValue("--page-size") ?? 1000)));
  const steamId = argValue("--steam-id");
  const since = isoOrNull(argValue("--since"));
  const until = isoOrNull(argValue("--until"));
  const sourceEnvPath = argValue("--from-env-file");
  const sourceEnv = sourceEnvPath
    ? readEnvFile(path.resolve(ROOT, sourceEnvPath))
    : {};

  const sourceUrl =
    argValue("--from-url") ?? sourceEnv.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const sourceKey =
    argValue("--from-key") ?? sourceEnv.SUPABASE_SERVICE_ROLE_KEY ?? null;
  const targetUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const targetKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!sourceUrl || !sourceKey) {
    throw new Error(
      "Missing source database. Pass --from-env-file=<path> containing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --from-url and --from-key."
    );
  }
  if (!targetUrl || !targetKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const source = new SupabaseRest(sourceUrl, sourceKey);
  const target = new SupabaseRest(targetUrl, targetKey);
  const summary = {
    apply,
    scanned: 0,
    prepared: 0,
    skipped: 0,
    attempted: 0,
  };

  for (let offset = 0; ; offset += pageSize) {
    const page = await source.selectSnapshots({
      limit: pageSize,
      offset,
      steamId,
      since,
      until,
    });
    if (!page?.length) break;

    summary.scanned += page.length;
    const rows = uniqueRows(page.map(toSnapshotRow).filter(Boolean));
    summary.prepared += rows.length;
    summary.skipped += page.length - rows.length;

    if (apply && rows.length > 0) {
      await target.insertSnapshots(rows);
      summary.attempted += rows.length;
    }

    console.log(JSON.stringify({ ...summary, last_offset: offset }));
    if (page.length < pageSize) break;
  }

  console.log(
    apply
      ? `Import attempted ${summary.attempted} rows. Existing rows were ignored by the daily snapshot conflict key.`
      : "Dry run only. Re-run with --apply to write rows."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
