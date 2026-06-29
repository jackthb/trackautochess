#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_BUCKET = "diagnostic-logs";
const DEFAULT_OUT_DIR = path.join(ROOT, ".local", "nettable-dump-export");
const DEFAULT_PAGE_SIZE = 1000;
const DUMP_PATH_RE = /(^|\/)nettable-dumps\/.+\.json$/i;

function usage() {
  return `Download raw nettable dump logs from Supabase Storage and extract local outputs.

Usage:
  node scripts/download-nettable-dumps.mjs [options]

Options:
  --env-file=<path>       Load Supabase credentials from an env file.
                          Defaults to web/.env.local if it exists.
  --supabase-url=<url>    Supabase project URL. Also reads SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.
  --service-key=<key>     Supabase key. Also reads SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY,
                          SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY.
  --bucket=<name>         Storage bucket. Default: diagnostic-logs.
  --prefix=<path>         Storage prefix to scan. Default: bucket root.
  --steam-id=<id>         Shortcut for --prefix=<id>/nettable-dumps.
  --out=<path>            Output directory. Default: .local/nettable-dump-export/<timestamp>.
  --page-size=<n>         Supabase Storage list page size. Default: 1000.
  --max-objects=<n>       Stop after downloading n matching dump objects.
  --since=<iso-date>      Only include objects created/captured at or after this date.
  --until=<iso-date>      Only include objects created/captured before this date.
  --dry-run               List matching objects without downloading.
  --from-dir=<path>       Parse existing local dump JSON files instead of downloading.
  --no-raw                Do not store raw downloaded dump files.
  --concurrency=<n>       Parallel download concurrency. Default: 20.
  --delete                Delete each object from Supabase Storage after successful parse.
  --help                  Show this help.

Outputs:
  raw/<bucket>/<path>.json                 Raw downloaded dumps, unless --no-raw is set.
  rows/nettable_rows.jsonl                 Every row with source metadata.
  tables/<table>.jsonl                     Every row split by nettable name.
  parsed/<source>.parsed.json              Per-dump table -> key -> raw object.
  parsed/all_latest_by_table.json          Latest observed table -> key -> raw object across all dumps.
  manifest.json                            Summary, counts, and any per-object errors.
`;
}

function readEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
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

function argValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((value) => value === name || value.startsWith(prefix));
  if (!arg) return null;
  return arg === name ? "true" : arg.slice(prefix.length);
}

function hasArg(name) {
  return process.argv.slice(2).includes(name);
}

function envValue(names, envFile = {}) {
  for (const name of names) {
    const value = process.env[name] ?? envFile[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function intOption(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = argValue(name);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function isoOrNull(value, name) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    throw new Error(`${name} must be a valid date`);
  }
  return new Date(time).toISOString();
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function trimSlashes(value) {
  return String(value ?? "").replace(/^\/+|\/+$/g, "");
}

function joinStoragePath(...parts) {
  return parts
    .map(trimSlashes)
    .filter(Boolean)
    .join("/");
}

function encodeStoragePath(value) {
  return trimSlashes(value)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function safeJoin(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside ${resolvedRoot}: ${resolved}`);
  }
  return resolved;
}

function storagePathToSegments(storagePath) {
  return trimSlashes(storagePath)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[<>:"\\|?*\x00-\x1f]/g, "_"));
}

function sanitizeFileStem(value) {
  const clean = String(value || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || "unknown";
}

function sourceStem(sourcePath) {
  const parsed = path.parse(trimSlashes(sourcePath).replaceAll("\\", "/"));
  const parent = sanitizeFileStem(parsed.dir.replaceAll("/", "_"));
  return sanitizeFileStem([parent, parsed.name].filter(Boolean).join("_"));
}

function isLikelyFolderEntry(item) {
  if (!item || typeof item !== "object") return false;
  if (item.id) return false;
  if (item.metadata && Object.keys(item.metadata).length > 0) return false;
  return true;
}

function isDumpPath(value) {
  return DUMP_PATH_RE.test(trimSlashes(value));
}

function withinDateRange(value, since, until) {
  if (!since && !until) return true;
  if (!value) return true;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return true;
  if (since && time < new Date(since).getTime()) return false;
  if (until && time >= new Date(until).getTime()) return false;
  return true;
}

class SupabaseStorageRest {
  constructor(url, key, bucket) {
    this.base = `${url.replace(/\/+$/, "")}/storage/v1`;
    this.key = key;
    this.bucket = bucket;
  }

  async request(url, { method = "GET", body } = {}) {
    const response = await fetch(url, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${method} ${url} failed: ${response.status} ${text}`.trim());
    }
    return response;
  }

  async list(prefix, { limit, offset }) {
    const url = `${this.base}/object/list/${encodeURIComponent(this.bucket)}`;
    const response = await this.request(url, {
      method: "POST",
      body: {
        prefix: trimSlashes(prefix),
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      },
    });
    const text = await response.text();
    return text ? JSON.parse(text) : [];
  }

  async download(objectPath) {
    const url = `${this.base}/object/${encodeURIComponent(this.bucket)}/${encodeStoragePath(
      objectPath
    )}`;
    const response = await this.request(url);
    return Buffer.from(await response.arrayBuffer());
  }

  async deleteBatch(paths) {
    const url = `${this.base}/object/${encodeURIComponent(this.bucket)}`;
    await this.request(url, { method: "DELETE", body: { prefixes: paths } });
  }
}

async function listDumpObjects(storage, { prefix, pageSize, maxObjects, since, until }) {
  const initialPrefix = trimSlashes(prefix);
  const queue = [initialPrefix];
  const seenPrefixes = new Set();
  const seenObjects = new Set();
  const objects = [];

  while (queue.length > 0 && objects.length < maxObjects) {
    const currentPrefix = queue.shift();
    if (seenPrefixes.has(currentPrefix)) continue;
    seenPrefixes.add(currentPrefix);

    for (let offset = 0; objects.length < maxObjects; offset += pageSize) {
      const page = await storage.list(currentPrefix, { limit: pageSize, offset });
      if (!Array.isArray(page) || page.length === 0) break;

      for (const item of page) {
        const itemName = typeof item?.name === "string" ? item.name : "";
        if (!itemName || itemName === ".emptyFolderPlaceholder") continue;
        const itemPath = itemName.startsWith(`${currentPrefix}/`) || itemName === currentPrefix
          ? trimSlashes(itemName)
          : joinStoragePath(currentPrefix, itemName);

        if (isLikelyFolderEntry(item)) {
          queue.push(itemPath);
          continue;
        }
        if (!isDumpPath(itemPath) || seenObjects.has(itemPath)) continue;
        if (!withinDateRange(item.created_at ?? item.updated_at, since, until)) continue;
        seenObjects.add(itemPath);
        objects.push({
          path: itemPath,
          created_at: item.created_at ?? null,
          updated_at: item.updated_at ?? null,
          size: item.metadata?.size ?? null,
        });
        if (objects.length >= maxObjects) break;
      }

      if (page.length < pageSize) break;
    }
  }

  objects.sort((a, b) => a.path.localeCompare(b.path));
  return objects;
}

function parseDump(buffer, sourcePath) {
  const payload = JSON.parse(buffer.toString("utf8"));
  const rows = Array.isArray(payload) ? payload : payload.rows;
  if (!Array.isArray(rows)) {
    throw new Error(`${sourcePath} does not contain a rows array`);
  }
  const capturedAt = typeof payload.captured_at === "string" ? payload.captured_at : null;
  const kind = typeof payload.kind === "string" ? payload.kind : null;
  const tables = Array.isArray(payload.tables) ? payload.tables.filter((value) => typeof value === "string") : [];
  return { payload, rows, capturedAt, kind, tables };
}

function parsedFromRows(rows) {
  const parsed = {};
  for (const row of rows) {
    const tableName = typeof row?.table_name === "string" ? row.table_name : null;
    const key = typeof row?.key === "string" ? row.key : null;
    if (!tableName || !key) continue;
    parsed[tableName] ??= {};
    parsed[tableName][key] = row.raw ?? null;
  }
  return parsed;
}

function mergeLatestByTable(target, parsed) {
  for (const [tableName, entries] of Object.entries(parsed)) {
    target[tableName] ??= {};
    for (const [key, raw] of Object.entries(entries)) {
      target[tableName][key] = raw;
    }
  }
}

function countRows(summary, rows) {
  for (const row of rows) {
    const tableName = typeof row?.table_name === "string" ? row.table_name : "unknown";
    const key = typeof row?.key === "string" ? row.key : "unknown";
    const table = (summary.tables[tableName] ??= { rows: 0, keys: {} });
    table.rows += 1;
    table.keys[key] = (table.keys[key] ?? 0) + 1;
  }
}

function openTableStream(streams, outputDir, tableName) {
  if (streams.has(tableName)) return streams.get(tableName);
  const filePath = safeJoin(outputDir, "tables", `${sanitizeFileStem(tableName)}.jsonl`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stream = fs.createWriteStream(filePath, { flags: "a" });
  streams.set(tableName, stream);
  return stream;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeRawDump(outputDir, bucket, objectPath, buffer) {
  const filePath = safeJoin(outputDir, "raw", bucket, ...storagePathToSegments(objectPath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function localJsonFiles(root) {
  const out = [];
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        out.push(entryPath);
      }
    }
  }
  out.sort();
  return out.map((filePath) => ({
    path: path.relative(path.resolve(root), filePath).replaceAll("\\", "/"),
    filePath,
    created_at: null,
    updated_at: null,
    size: fs.statSync(filePath).size,
  }));
}

async function closeStreams(streams) {
  await Promise.all(
    [...streams.values()].map(
      (stream) =>
        new Promise((resolve, reject) => {
          stream.once("error", reject);
          stream.end(resolve);
        })
    )
  );
}

async function processObjects({ objects, outputDir, bucket, storage, fromDir, keepRaw, since, until, concurrency, deleteAfterParse }) {
  const rowsPath = safeJoin(outputDir, "rows", "nettable_rows.jsonl");
  fs.mkdirSync(path.dirname(rowsPath), { recursive: true });
  const rowsStream = fs.createWriteStream(rowsPath, { flags: "a" });
  const tableStreams = new Map();
  const latestByTable = {};
  const summary = {
    generated_at: new Date().toISOString(),
    source: fromDir ? { kind: "local", directory: path.resolve(fromDir) } : { kind: "supabase_storage", bucket },
    output_dir: path.resolve(outputDir),
    scanned_objects: objects.length,
    downloaded_objects: 0,
    parsed_objects: 0,
    total_rows: 0,
    tables: {},
    errors: [],
    files: {
      rows: path.relative(outputDir, rowsPath).replaceAll("\\", "/"),
      tables_dir: "tables",
      parsed_dir: "parsed",
      latest_by_table: "parsed/all_latest_by_table.json",
    },
  };

  async function processOne(object) {
    let buffer;
    try {
      buffer = fromDir ? fs.readFileSync(object.filePath) : await storage.download(object.path);
      summary.downloaded_objects += 1;
      if (keepRaw && !fromDir) {
        writeRawDump(outputDir, bucket, object.path, buffer);
      }

      const dump = parseDump(buffer, object.path);
      if (!withinDateRange(dump.capturedAt ?? object.created_at, since, until)) return;
      const parsed = parsedFromRows(dump.rows);
      mergeLatestByTable(latestByTable, parsed);

      const parsedPath = safeJoin(outputDir, "parsed", `${sourceStem(object.path)}.parsed.json`);
      writeJson(parsedPath, {
        source_path: object.path,
        captured_at: dump.capturedAt,
        kind: dump.kind,
        tables: Object.keys(parsed).sort(),
        parsed,
      });

      for (const row of dump.rows) {
        const tableName = typeof row?.table_name === "string" ? row.table_name : "unknown";
        const record = {
          source_path: object.path,
          source_created_at: object.created_at,
          dump_captured_at: dump.capturedAt,
          ...row,
        };
        const line = `${JSON.stringify(record)}\n`;
        rowsStream.write(line);
        openTableStream(tableStreams, outputDir, tableName).write(line);
      }

      countRows(summary, dump.rows);
      summary.parsed_objects += 1;
      summary.total_rows += dump.rows.length;

      if (deleteAfterParse && !fromDir) {
        await storage.deleteBatch([object.path]);
        summary.deleted_objects = (summary.deleted_objects ?? 0) + 1;
      }

      console.log(
        JSON.stringify({
          parsed: summary.parsed_objects,
          rows: summary.total_rows,
          source_path: object.path,
        })
      );
    } catch (error) {
      summary.errors.push({
        path: object.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    let idx = 0;
    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= objects.length) break;
        await processOne(objects[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, objects.length) }, worker));
  } finally {
    await closeStreams(new Map([["rows", rowsStream], ...tableStreams]));
  }

  writeJson(safeJoin(outputDir, "parsed", "all_latest_by_table.json"), latestByTable);
  writeJson(safeJoin(outputDir, "manifest.json"), summary);
  return summary;
}

async function main() {
  if (hasArg("--help")) {
    console.log(usage());
    return;
  }

  const fromDir = argValue("--from-dir");
  const envPath = argValue("--env-file") ?? path.join(ROOT, "web", ".env.local");
  const envFile = readEnvFile(envPath);
  const bucket = argValue("--bucket") ?? envValue(["SUPABASE_STORAGE_BUCKET"], envFile) ?? DEFAULT_BUCKET;
  const pageSize = intOption("--page-size", DEFAULT_PAGE_SIZE, { min: 1, max: 1000 });
  const maxObjects = intOption("--max-objects", Number.MAX_SAFE_INTEGER);
  const since = isoOrNull(argValue("--since"), "--since");
  const until = isoOrNull(argValue("--until"), "--until");
  const concurrency = intOption("--concurrency", 20, { min: 1, max: 100 });
  const deleteAfterParse = hasArg("--delete");
  const dryRun = hasArg("--dry-run");
  const keepRaw = !hasArg("--no-raw");
  const steamId = argValue("--steam-id");
  const prefix = steamId ? `${steamId}/nettable-dumps` : argValue("--prefix") ?? "";
  const outputDir = path.resolve(
    argValue("--out") ?? path.join(DEFAULT_OUT_DIR, timestampForPath())
  );

  if (fromDir) {
    const objects = localJsonFiles(fromDir)
      .filter((object) => isDumpPath(object.path) || !object.path.includes("/"))
      .slice(0, maxObjects);
    if (dryRun) {
      console.log(JSON.stringify({ source: "local", directory: path.resolve(fromDir), objects }, null, 2));
      return;
    }
    const summary = await processObjects({
      objects,
      outputDir,
      bucket,
      fromDir,
      keepRaw: false,
      since,
      until,
    });
    console.log(`Parsed ${summary.parsed_objects} local dumps into ${summary.output_dir}`);
    return;
  }

  const supabaseUrl =
    argValue("--supabase-url") ??
    envValue(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"], envFile);
  const serviceKey =
    argValue("--service-key") ??
    envValue(
      [
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ],
      envFile
    );

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing Supabase credentials. Provide --supabase-url and --service-key, set env vars, or pass --env-file=<path>."
    );
  }

  const storage = new SupabaseStorageRest(supabaseUrl, serviceKey, bucket);
  const objects = await listDumpObjects(storage, {
    prefix,
    pageSize,
    maxObjects,
    since,
    until,
  });

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          source: "supabase_storage",
          bucket,
          prefix,
          matching_objects: objects.length,
          objects,
        },
        null,
        2
      )
    );
    return;
  }

  const summary = await processObjects({
    objects,
    outputDir,
    bucket,
    storage,
    keepRaw,
    since,
    until,
    concurrency,
    deleteAfterParse,
  });
  console.log(`Exported ${summary.parsed_objects} dumps and ${summary.total_rows} rows to ${summary.output_dir}`);
  if (summary.errors.length > 0) {
    console.error(`${summary.errors.length} object(s) failed; see manifest.json`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
