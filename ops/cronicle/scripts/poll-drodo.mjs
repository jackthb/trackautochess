#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

const repoModuleUrl = (...segments) =>
  process.env.DAC_REPO_ROOT
    ? pathToFileURL(path.join(process.env.DAC_REPO_ROOT, ...segments)).href
    : new URL(`../../../${segments.join("/")}`, import.meta.url).href;

const drodoCoreUrl = repoModuleUrl("shared", "drodo-core.mjs");
const supabaseRestUrl = repoModuleUrl("scripts", "lib", "supabase-rest.mjs");

const { SupabaseRest } = await import(supabaseRestUrl);

const {
  activePollOrFilter,
  DRODO_BACKGROUND_POLL_ENABLED,
  fetchDrodoProfileBatch,
  drodoProfileToUserPayload,
  isQueenProfile,
  nextPollSchedule,
  pollSnapshotFromRow,
  profileChanged,
  recentSignInCutoff,
  summarizeDrodoResults,
} = await import(drodoCoreUrl);

const DEFAULT_BATCH_SIZE = 200;
// Single-ID courier calls are about 1.3–2.6s. At concurrency 4 this stays
// inside the full-sweep job's 3600s timeout, with room for Supabase writes.
const DEFAULT_ALL_BATCH_SIZE = 2000;

function argValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((value) => value === name || value.startsWith(prefix));
  if (!arg) return null;
  return arg === name ? "true" : arg.slice(prefix.length);
}

function mode() {
  const value = argValue("--mode") ?? process.env.DRODO_POLL_MODE ?? "active";
  if (value === "active" || value === "all") return value;
  throw new Error(`Invalid --mode: ${value}. Expected active or all.`);
}

function batchSize(selectedMode) {
  const fallback = selectedMode === "all" ? DEFAULT_ALL_BATCH_SIZE : DEFAULT_BATCH_SIZE;
  const raw =
    argValue("--batch-size") ??
    (selectedMode === "all" ? process.env.DRODO_POLL_ALL_BATCH_SIZE : undefined) ??
    process.env.DRODO_POLL_BATCH_SIZE;
  const parsed = raw ? Number(raw) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function flagEnabled(name, envName) {
  const raw = argValue(name) ?? process.env[envName] ?? "false";
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rowSteamId(row) {
  return String(row.steam_id);
}

function activeSyncFilter(recentSignInCutoff) {
  return activePollOrFilter(recentSignInCutoff);
}

async function loadActiveIds(supabase, limit) {
  const now = new Date();
  const recentSignIn = recentSignInCutoff(now);
  const activeFilter = activeSyncFilter(recentSignIn);

  const dueUsers = await supabase.select("users", {
    select: "steam_id::text",
    or: `(${activeFilter})`,
    next_poll_at: `lte.${now.toISOString()}`,
    drodo_last_fetched_at: "not.is.null",
    order: "next_poll_at.asc",
    limit,
  });

  const unseededUsers = await supabase.select("users", {
    select: "steam_id::text",
    or: `(${activeFilter})`,
    drodo_last_fetched_at: "is.null",
    order: "queen_ladder_last_seen_at.desc.nullslast,steam_signed_in_at.desc.nullslast",
    limit,
  });

  const ids = (dueUsers ?? []).map(rowSteamId);
  const seen = new Set(ids);
  const seeded = (unseededUsers ?? [])
    .map(rowSteamId)
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  return { ids, seeded };
}

async function loadAllIds(supabase, limit, { seasonSweep = false } = {}) {
  const ids = [];
  const now = new Date();

  for (let offset = 0; ids.length < limit; offset += 1000) {
    const pageLimit = Math.min(1000, limit - ids.length);
    const query = {
      select: "steam_id::text,steam_signed_in_at,queen_ladder_rank,queen_ladder_last_seen_at",
      drodo_profile_missing: "eq.false",
      drodo_last_fetched_at: "not.is.null",
      order: "drodo_last_fetched_at.asc",
      limit: pageLimit,
      offset,
    };
    if (!seasonSweep) query.next_poll_at = `lte.${now.toISOString()}`;
    const rows = await supabase.select("users", query);
    if (!rows?.length) break;
    ids.push(...rows.map(rowSteamId));
    if (rows.length < pageLimit) break;
  }
  return ids;
}

async function loadPollSnapshots(steamIds, supabase) {
  if (steamIds.length === 0) return new Map();
  const rows = await supabase.select("users", {
    select: "steam_id::text,drodo_mmr,drodo_max_mmr,drodo_season,drodo_season_games,drodo_chicken_count,queen_ladder_rank,queen_ladder_last_seen_at,poll_interval_seconds",
    steam_id: `in.(${steamIds.join(",")})`,
  });
  return new Map((rows ?? []).map((row) => [rowSteamId(row), pollSnapshotFromRow(row)]));
}

async function markDrodoMissing(steamId, supabase) {
  const fetchedAt = new Date().toISOString();
  const schedule = nextPollSchedule({
    mode: "adaptive",
    changed: false,
    prevIntervalSeconds: null,
    missing: true,
  });
  const existingRows = await supabase.select("users", {
    select:
      "drodo_mmr,drodo_max_mmr,drodo_season,drodo_season_games,drodo_chicken_count,queen_ladder_rank,queen_ladder_last_seen_at,drodo_profile_missing",
    steam_id: `eq.${steamId}`,
  });
  const existing = existingRows?.[0] ?? null;
  const hasKnown =
    existing &&
    !existing.drodo_profile_missing &&
    (existing.drodo_mmr != null ||
      existing.drodo_max_mmr != null ||
      existing.drodo_season != null ||
      existing.drodo_season_games != null ||
      (typeof existing.drodo_chicken_count === "number" &&
        existing.drodo_chicken_count > 0) ||
      existing.queen_ladder_rank != null ||
      existing.queen_ladder_last_seen_at != null);
  if (hasKnown) {
    await supabase.upsert(
      "users",
      {
        steam_id: String(steamId),
        drodo_last_fetched_at: fetchedAt,
        drodo_profile_missing: false,
        next_poll_at: schedule.next_poll_at,
        poll_interval_seconds: schedule.poll_interval_seconds,
      },
      "steam_id"
    );
    return fetchedAt;
  }
  await supabase.upsert(
    "users",
    {
      steam_id: String(steamId),
      drodo_mmr: null,
      drodo_max_mmr: null,
      drodo_mmr_level: null,
      drodo_season: null,
      drodo_season_games: null,
      drodo_candy: null,
      drodo_chicken_count: 0,
      drodo_raw_data: null,
      drodo_last_fetched_at: fetchedAt,
      drodo_profile_missing: true,
      next_poll_at: schedule.next_poll_at,
      poll_interval_seconds: schedule.poll_interval_seconds,
    },
    "steam_id"
  );
  return fetchedAt;
}

async function persistDrodoProfile(profile, seasonRows, supabase, options) {
  const changed = profileChanged(options.prevSnapshot ?? null, profile);
  const queen = isQueenProfile(profile, options.prevSnapshot);
  const schedule = nextPollSchedule({
    mode: options.pollMode,
    changed,
    prevIntervalSeconds: options.prevSnapshot?.poll_interval_seconds ?? null,
    hot: options.hotPoll || queen,
    fixedHot: queen,
  });
  const userPayload = {
    ...drodoProfileToUserPayload(profile),
    next_poll_at: schedule.next_poll_at,
    poll_interval_seconds: schedule.poll_interval_seconds,
  };
  await supabase.upsert(
    "users",
    userPayload,
    "steam_id"
  );

  if (options.snapshotOnSuccess) {
    const snapshottedAt = new Date().toISOString();
    await supabase.upsert(
      "mmr_snapshots",
      {
        steam_id: profile.steam_id,
        mmr: profile.mmr,
        season: profile.season,
        chicken_count: profile.chicken_count,
        queen_rank: profile.queen_rank,
        snapshotted_at: snapshottedAt,
        snapshot_date: snapshottedAt.slice(0, 10),
      },
      "steam_id,season,snapshot_date,mmr,chicken_count,queen_rank"
    );
    await supabase.rpc("sync_player_season_queen_ranks", {
      p_steam_id: profile.steam_id,
    });
  }

  if (seasonRows.length > 0) {
    const existingSeasons = await supabase.select("player_seasons", {
      select: "season,chicken_count",
      steam_id: `eq.${profile.steam_id}`,
    });
    const existingChickenCounts = new Map(
      (existingSeasons ?? []).map((row) => [row.season, row.chicken_count])
    );
    const mergedRows = seasonRows.map((row) => ({
      ...row,
      chicken_count: row.chicken_count ?? existingChickenCounts.get(row.season) ?? null,
    }));
    await supabase.upsert("player_seasons", mergedRows, "steam_id,season");
  }
}

async function fetchAndCacheDrodoBatch(steamIds, supabase, options = {}) {
  return fetchDrodoProfileBatch(
    steamIds,
    {
      loadPollSnapshots: (ids) => loadPollSnapshots(ids, supabase),
      markMissing: (steamId) => markDrodoMissing(steamId, supabase),
      persistProfile: (profile, seasonRows, persistOptions) =>
        persistDrodoProfile(profile, seasonRows, supabase, persistOptions),
    },
    options
  );
}

async function pingHealthcheck(suffix = "", body) {
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

async function main() {
  // The shared flag is the product switch. DRODO_LIVE_FETCH_ENABLED=1 still
  // forces a run when that flag is off. Cronicle job JSON ships disabled;
  // enabling the job in Cronicle is what actually starts the schedule.
  if (
    !DRODO_BACKGROUND_POLL_ENABLED &&
    process.env.DRODO_LIVE_FETCH_ENABLED !== "1"
  ) {
    const output = {
      mode: mode(),
      disabled: true,
      reason:
        "Drodo background poll is off (DRODO_BACKGROUND_POLL_ENABLED). Set DRODO_LIVE_FETCH_ENABLED=1 to force one run.",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      polled: 0,
      ok: 0,
      missing: 0,
      upstream_error: 0,
    };
    console.log(JSON.stringify(output));
    await pingHealthcheck("", JSON.stringify(output));
    return;
  }

  const selectedMode = mode();
  const limit = batchSize(selectedMode);
  const seasonSweep = flagEnabled("--season-sweep", "DRODO_POLL_SEASON_SWEEP");
  const supabase = new SupabaseRest(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  await pingHealthcheck("/start");

  const startedAt = new Date().toISOString();
  let results = [];
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
    const ids = await loadAllIds(supabase, limit, { seasonSweep });
    results = await fetchAndCacheDrodoBatch(ids, supabase, {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
    });
  }

  const output = {
    mode: selectedMode,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    season_sweep: selectedMode === "all" ? seasonSweep : false,
    polled: results.length,
    seeded,
    ...summarizeDrodoResults(results),
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
