#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCli = path.join(repoRoot, "node_modules", ".bin", "supabase.CMD");
const sourceRef = process.env.SOURCE_SUPABASE_PROJECT_REF || "xkfxykorskdltcmvgihh";
const targetRef = process.env.TARGET_SUPABASE_PROJECT_REF || "ismxtcfkuwpvfyuojnaa";
const generatorSql = path.join(repoRoot, "scripts", "generate-supabase-public-copy.sql");
const tempDir = path.join(repoRoot, "supabase", ".temp");
const outputSql = path.join(tempDir, "public-data-copy.sql");

function runSupabase(args, options = {}) {
  const command = [supabaseCli, ...args].map((arg) => `"${String(arg).replaceAll('"', '\\"')}"`).join(" ");
  return childProcess.execSync(command, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function parseFirstJsonObject(output) {
  const start = output.indexOf("{");
  if (start === -1) throw new Error("Supabase CLI output did not include JSON");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < output.length; index += 1) {
    const char = output[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(output.slice(start, index + 1));
      }
    }
  }

  throw new Error("Supabase CLI JSON output was incomplete");
}

function generateSql() {
  console.log(`Linking source ${sourceRef}`);
  runSupabase(["link", "--project-ref", sourceRef], { stdio: "inherit" });

  console.log("Generating exact public data SQL from source");
  const output = runSupabase(["db", "query", "--linked", "--file", generatorSql, "--output", "json"]);
  const parsed = parseFirstJsonObject(output);
  const rows = parsed.rows ?? [];

  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(outputSql, `${rows.map((row) => row.stmt).join("\n")}\n`, "utf8");

  console.log(`Wrote ${rows.length} SQL statements to ${path.relative(repoRoot, outputSql)}`);
  return rows.map((row) => row.stmt).filter((stmt) => stmt !== "begin;" && stmt !== "commit;");
}

function chunkStatements(statements, maxBytes = 700 * 1024) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;

  for (const statement of statements) {
    const statementBytes = Buffer.byteLength(`${statement}\n`, "utf8");
    if (current.length > 0 && currentBytes + statementBytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(statement);
    currentBytes += statementBytes;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function applySql(statements) {
  console.log(`Linking target ${targetRef}`);
  runSupabase(["link", "--project-ref", targetRef], { stdio: "inherit" });

  const chunks = chunkStatements(statements);
  console.log(`Applying exact public data SQL to target in ${chunks.length} chunks`);

  chunks.forEach((chunk, index) => {
    const chunkPath = path.join(
      tempDir,
      `public-data-copy-${String(index + 1).padStart(3, "0")}.sql`,
    );
    fs.writeFileSync(chunkPath, `${chunk.join("\n")}\n`, "utf8");
    console.log(`Applying chunk ${index + 1}/${chunks.length}`);
    runSupabase(["db", "query", "--linked", "--file", chunkPath], { stdio: "inherit" });
  });
}

function verifyTarget() {
  const verifySql =
    "select 'users' as table_name, count(*)::bigint as rows from public.users " +
    "union all select 'player_seasons', count(*) from public.player_seasons " +
    "union all select 'matches', count(*) from public.matches " +
    "union all select 'match_players', count(*) from public.match_players " +
    "union all select 'match_timelines', count(*) from public.match_timelines " +
    "union all select 'lineup_snapshots', count(*) from public.lineup_snapshots " +
    "union all select 'mmr_snapshots', count(*) from public.mmr_snapshots " +
    "union all select 'site_status', count(*) from public.site_status " +
    "order by table_name;";

  const output = runSupabase(["db", "query", "--linked", verifySql, "--output", "json"]);
  const parsed = parseFirstJsonObject(output);

  console.log("Target counts");
  for (const row of parsed.rows ?? []) {
    console.log(`${row.table_name}: ${row.rows}`);
  }
}

const statements = generateSql();
applySql(statements);
verifyTarget();
