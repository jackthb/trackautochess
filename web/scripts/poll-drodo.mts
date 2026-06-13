import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchAndCacheDrodoBatch } from "../lib/drodo";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_ALL_BATCH_SIZE = 10000;
const RECENT_SIGN_IN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

interface DueUser {
  steam_id: string;
}

interface ActiveUser extends DueUser {
  steam_signed_in_at: string | null;
  queen_ladder_last_seen_at: string | null;
  drodo_queen_rank: number | null;
}

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((value) => value === name || value.startsWith(prefix));
  if (!arg) return null;
  return arg === name ? "true" : arg.slice(prefix.length);
}

function mode(): "active" | "all" {
  const value = argValue("--mode") ?? process.env.DRODO_POLL_MODE ?? "active";
  if (value === "active" || value === "all") return value;
  throw new Error(`Invalid --mode: ${value}. Expected active or all.`);
}

function batchSize(selectedMode: "active" | "all"): number {
  const fallback = selectedMode === "all" ? DEFAULT_ALL_BATCH_SIZE : DEFAULT_BATCH_SIZE;
  const raw =
    argValue("--batch-size") ??
    (selectedMode === "all" ? process.env.DRODO_POLL_ALL_BATCH_SIZE : undefined) ??
    process.env.DRODO_POLL_BATCH_SIZE;
  const parsed = raw ? Number(raw) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function pingHealthcheck(suffix = "", body?: unknown) {
  const base = process.env.HEALTHCHECK_URL;
  if (!base) return;
  try {
    await fetch(`${base}${suffix}`, {
      method: body == null ? "GET" : "POST",
      body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      headers: body == null ? undefined : { "Content-Type": "application/json" },
    });
  } catch {
    // Do not fail the poll because the observer failed.
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// This script writes Queen stats from outside the Next server, so it cannot
// call revalidatePath itself; ping the public revalidate endpoint instead so
// /queens rebuilds without waiting out its ISR window.
async function pingQueensRevalidate() {
  const url =
    process.env.QUEENS_REVALIDATE_URL ??
    "https://www.trackautochess.com/api/revalidate/queens";
  try {
    await fetch(url, { method: "POST" });
  } catch {
    // Best effort: the page's ISR window still applies.
  }
}

async function loadActiveIds(supabase: SupabaseClient, limit: number): Promise<{
  ids: string[];
  seeded: string[];
}> {
  const now = new Date();
  const recentSignInCutoff = new Date(now.getTime() - RECENT_SIGN_IN_WINDOW_MS).toISOString();
  const activeSyncFilter = `steam_signed_in_at.gte.${recentSignInCutoff},queen_ladder_last_seen_at.not.is.null,drodo_queen_rank.not.is.null`;

  const { data: dueUsers, error: dueError } = await supabase
    .from("users")
    .select("steam_id::text")
    .or(activeSyncFilter)
    .lte("next_poll_at", now.toISOString())
    .not("drodo_last_fetched_at", "is", null)
    .order("next_poll_at", { ascending: true })
    .limit(limit);
  if (dueError) throw dueError;

  const { data: unseededUsers, error: unseededError } = await supabase
    .from("users")
    .select("steam_id::text")
    .or(activeSyncFilter)
    .is("drodo_last_fetched_at", null)
    .order("queen_ladder_last_seen_at", { ascending: false, nullsFirst: false })
    .order("steam_signed_in_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (unseededError) throw unseededError;

  const ids = ((dueUsers ?? []) as unknown as DueUser[]).map((row) => String(row.steam_id));
  const seen = new Set(ids);
  const seeded = ((unseededUsers ?? []) as unknown as DueUser[])
    .map((row) => String(row.steam_id))
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  return { ids, seeded };
}

async function loadAllIds(supabase: SupabaseClient, limit: number): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ids.length < limit; from += 1000) {
    const to = from + Math.min(999, limit - ids.length - 1);
    const { data, error } = await supabase
      .from("users")
      .select("steam_id::text, steam_signed_in_at, queen_ladder_last_seen_at, drodo_queen_rank")
      .eq("drodo_profile_missing", false)
      .not("drodo_last_fetched_at", "is", null)
      .order("drodo_last_fetched_at", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as unknown as ActiveUser[];
    if (rows.length === 0) break;
    ids.push(...rows.map((row) => String(row.steam_id)));
    if (rows.length < to - from + 1) break;
  }
  return ids;
}

function summarize(results: Awaited<ReturnType<typeof fetchAndCacheDrodoBatch>>) {
  return results.reduce(
    (summary, result) => {
      if (result.ok) summary.ok += 1;
      else if (result.kind === "missing") summary.missing += 1;
      else summary.upstream_error += 1;
      return summary;
    },
    { ok: 0, missing: 0, upstream_error: 0 }
  );
}

async function main() {
  const selectedMode = mode();
  const limit = batchSize(selectedMode);
  const supabase: SupabaseClient = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  await pingHealthcheck("/start");

  const startedAt = new Date().toISOString();
  let results: Awaited<ReturnType<typeof fetchAndCacheDrodoBatch>> = [];
  let seeded = 0;

  if (selectedMode === "active") {
    const active = await loadActiveIds(supabase, limit);
    seeded = active.seeded.length;
    const repolled = await fetchAndCacheDrodoBatch(active.ids, supabase, {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
      hotPoll: true,
    });
    const seededResults = await fetchAndCacheDrodoBatch(active.seeded, supabase, {
      snapshotOnSuccess: true,
      pollMode: "reset",
      hotPoll: true,
    });
    results = [...repolled, ...seededResults];
  } else {
    const ids = await loadAllIds(supabase, limit);
    results = await fetchAndCacheDrodoBatch(ids, supabase, {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
    });
  }

  if (results.some((result) => result.ok)) {
    await pingQueensRevalidate();
  }

  const output = {
    mode: selectedMode,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    polled: results.length,
    seeded,
    ...summarize(results),
  };
  console.log(JSON.stringify(output, null, 2));
  await pingHealthcheck("", output);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  await pingHealthcheck("/fail", message);
  process.exit(1);
});
