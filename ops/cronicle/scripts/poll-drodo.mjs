#!/usr/bin/env node

const DRODO_BASE = "http://autochess.ppbizon.com";
const DRODO_COURIER_BATCH_SIZE = 200;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_ALL_BATCH_SIZE = 10000;
const RECENT_SIGN_IN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const POLL_MIN_INTERVAL_SECONDS = 10 * 60;
const POLL_MAX_INTERVAL_SECONDS = 7 * 24 * 60 * 60;
const POLL_BACKOFF_FACTOR = 1.5;
const HOT_POLL_MAX_INTERVAL_SECONDS = 30 * 60;
const HOT_POLL_BACKOFF_FACTOR = 1.15;
const EMPTY_DRODO_PROFILE_ERROR =
  "Steam account has no Dota Auto Chess MMR or stats.";

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function steamIdValue(steamId) {
  return String(steamId);
}

function numberFromDrodoData(data, key) {
  const value = data[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueFromDrodoData(data, keys) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function lastWinFromDrodoData(data) {
  return valueFromDrodoData(data, [
    "last_win_at",
    "last_win_date",
    "last_win_time",
    "last_top1_at",
    "last_top1_date",
    "last_top1_time",
    "top1_at",
    "top1_date",
    "top1_time",
    "last_chicken_at",
    "last_chicken_date",
    "last_chicken_time",
  ]);
}

function lastTop3FromDrodoData(data) {
  return valueFromDrodoData(data, [
    "last_top3_at",
    "last_top3_date",
    "last_top3_time",
    "top3_at",
    "top3_date",
    "top3_time",
  ]);
}

function currentSeason(data) {
  let max = 0;
  let season = "";
  for (const key of Object.keys(data)) {
    const match = key.match(/^mmr_s(\d+)$/);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (n > max) {
      max = n;
      season = `s${n}`;
    }
  }
  return season || null;
}

function extractAllSeasons(steamId, data, currentSeasonKey) {
  const now = new Date().toISOString();
  const seasons = [];
  for (const key of Object.keys(data)) {
    const match = key.match(/^mmr_s(\d+)$/);
    if (!match) continue;
    const n = match[1];
    const seasonKey = `s${n}`;
    seasons.push({
      steam_id: steamIdValue(steamId),
      season: seasonKey,
      mmr: Number(data[`mmr_s${n}`]) || null,
      max_mmr: Number(data[`max_mmr_s${n}`]) || null,
      games_played: Number(data[`match_s${n}`]) || null,
      chicken_count:
        seasonKey === currentSeasonKey ? (Number(data.chicken_count) || null) : null,
      fetched_at: now,
    });
  }
  return seasons.sort((a, b) => Number(a.season.slice(1)) - Number(b.season.slice(1)));
}

function buildDrodoProfile(steamId, drodoData) {
  const season = currentSeason(drodoData);
  const mmrKey = season ? `mmr_${season}` : null;
  const maxMmrKey = season ? `max_mmr_${season}` : null;
  const matchKey = season ? `match_${season}` : null;
  const profile = {
    steam_id: steamIdValue(steamId),
    mmr: mmrKey ? Number(drodoData[mmrKey]) || null : null,
    max_mmr: maxMmrKey ? Number(drodoData[maxMmrKey]) || null : null,
    mmr_level: Number(drodoData.mmr_level) || null,
    queen_rank: numberFromDrodoData(drodoData, "queen_rank"),
    last_win_at: lastWinFromDrodoData(drodoData),
    last_top3_at: lastTop3FromDrodoData(drodoData),
    season,
    season_games: matchKey ? Number(drodoData[matchKey]) || null : null,
    candy: Number(drodoData.candy) || null,
    chicken_count: Number(drodoData.chicken_count) || 0,
    raw_data: drodoData,
    fetched_at: new Date().toISOString(),
  };
  return { profile, seasonRows: extractAllSeasons(steamId, drodoData, season) };
}

function hasDrodoStats(profile, seasonRows) {
  if (
    profile.mmr != null ||
    profile.max_mmr != null ||
    profile.season_games != null ||
    profile.chicken_count > 0
  ) {
    return true;
  }
  return seasonRows.some((row) => row.mmr != null || row.max_mmr != null || row.games_played != null);
}

function drodoProfileToUserPayload(profile) {
  return {
    steam_id: profile.steam_id,
    drodo_mmr: profile.mmr,
    drodo_max_mmr: profile.max_mmr,
    drodo_mmr_level: profile.mmr_level,
    drodo_season: profile.season,
    drodo_season_games: profile.season_games,
    drodo_candy: profile.candy,
    drodo_chicken_count: profile.chicken_count,
    drodo_raw_data: profile.raw_data,
    drodo_last_fetched_at: profile.fetched_at,
    drodo_profile_missing: false,
  };
}

function clampInterval(seconds, max = POLL_MAX_INTERVAL_SECONDS) {
  if (!Number.isFinite(seconds) || seconds < POLL_MIN_INTERVAL_SECONDS) {
    return POLL_MIN_INTERVAL_SECONDS;
  }
  if (seconds > max) return max;
  return Math.round(seconds);
}

function nextPollSchedule({ mode, changed, prevIntervalSeconds, missing = false, hot = false }) {
  const maxInterval = hot ? HOT_POLL_MAX_INTERVAL_SECONDS : POLL_MAX_INTERVAL_SECONDS;
  const backoffFactor = hot ? HOT_POLL_BACKOFF_FACTOR : POLL_BACKOFF_FACTOR;
  let intervalSeconds;
  if (missing) {
    intervalSeconds = maxInterval;
  } else if (mode === "reset" || changed) {
    intervalSeconds = POLL_MIN_INTERVAL_SECONDS;
  } else {
    const prev = prevIntervalSeconds ?? POLL_MIN_INTERVAL_SECONDS;
    intervalSeconds = clampInterval(prev * backoffFactor, maxInterval);
  }
  intervalSeconds = clampInterval(intervalSeconds, maxInterval);
  return {
    next_poll_at: new Date(Date.now() + intervalSeconds * 1000).toISOString(),
    poll_interval_seconds: intervalSeconds,
  };
}

function pollSnapshotFromRow(row) {
  return {
    drodo_mmr: row.drodo_mmr,
    drodo_season_games: row.drodo_season_games,
    drodo_chicken_count: row.drodo_chicken_count,
    queen_rank: row.drodo_raw_data ? numberFromDrodoData(row.drodo_raw_data, "queen_rank") : null,
    queen_ladder_last_seen_at: row.queen_ladder_last_seen_at,
    poll_interval_seconds: row.poll_interval_seconds,
  };
}

function isQueenProfile(profile, prev) {
  return (
    profile.queen_rank != null ||
    prev?.queen_rank != null ||
    prev?.queen_ladder_last_seen_at != null
  );
}

function profileChanged(prev, next) {
  if (!prev) return true;
  return (
    prev.drodo_mmr !== next.mmr ||
    prev.drodo_season_games !== next.season_games ||
    prev.drodo_chicken_count !== next.chicken_count ||
    prev.queen_rank !== next.queen_rank
  );
}

class SupabaseRest {
  constructor(url, key) {
    this.base = `${url.replace(/\/$/, "")}/rest/v1`;
    this.key = key;
  }

  async request(path, { method = "GET", query, body, headers = {} } = {}) {
    const url = new URL(`${this.base}/${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
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
      const text = await response.text();
      throw new Error(`${method} ${url.pathname}${url.search} failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  select(table, query) {
    return this.request(table, { query });
  }

  upsert(table, rows, onConflict) {
    return this.request(table, {
      method: "POST",
      query: { on_conflict: onConflict },
      body: rows,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
  }

  patch(table, query, body) {
    return this.request(table, {
      method: "PATCH",
      query,
      body,
      headers: { Prefer: "return=minimal" },
    });
  }

  delete(table, query) {
    return this.request(table, {
      method: "DELETE",
      query,
      headers: { Prefer: "return=minimal" },
    });
  }
}

function rowSteamId(row) {
  return String(row.steam_id);
}

async function loadActiveIds(supabase, limit) {
  const now = new Date();
  const recentSignInCutoff = new Date(now.getTime() - RECENT_SIGN_IN_WINDOW_MS).toISOString();
  const activeSyncFilter = `steam_signed_in_at.gte.${recentSignInCutoff},queen_ladder_last_seen_at.not.is.null,drodo_raw_data->>queen_rank.not.is.null`;

  const dueUsers = await supabase.select("users", {
    select: "steam_id::text",
    or: `(${activeSyncFilter})`,
    next_poll_at: `lte.${now.toISOString()}`,
    drodo_last_fetched_at: "not.is.null",
    order: "next_poll_at.asc",
    limit,
  });

  const unseededUsers = await supabase.select("users", {
    select: "steam_id::text",
    or: `(${activeSyncFilter})`,
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

async function loadAllIds(supabase, limit) {
  const ids = [];
  for (let offset = 0; ids.length < limit; offset += 1000) {
    const pageLimit = Math.min(1000, limit - ids.length);
    const rows = await supabase.select("users", {
      select: "steam_id::text,steam_signed_in_at,queen_ladder_last_seen_at,drodo_raw_data",
      drodo_profile_missing: "eq.false",
      drodo_last_fetched_at: "not.is.null",
      order: "drodo_last_fetched_at.asc",
      limit: pageLimit,
      offset,
    });
    if (!rows?.length) break;
    ids.push(...rows.map(rowSteamId));
    if (rows.length < pageLimit) break;
  }
  return ids;
}

async function loadPollSnapshots(steamIds, supabase) {
  if (steamIds.length === 0) return new Map();
  const rows = await supabase.select("users", {
    select: "steam_id::text,drodo_mmr,drodo_season_games,drodo_chicken_count,drodo_raw_data,queen_ladder_last_seen_at,poll_interval_seconds",
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
  await supabase.upsert(
    "users",
    {
      steam_id: steamIdValue(steamId),
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
  });
  const userPayload = {
    ...drodoProfileToUserPayload(profile),
    next_poll_at: schedule.next_poll_at,
    poll_interval_seconds: schedule.poll_interval_seconds,
  };
  if (queen) {
    userPayload.queen_ladder_last_seen_at = profile.fetched_at;
  }

  await supabase.upsert(
    "users",
    userPayload,
    "steam_id"
  );

  if (options.snapshotOnSuccess) {
    await supabase.upsert(
      "mmr_snapshots",
      {
        steam_id: profile.steam_id,
        mmr: profile.mmr,
        season: profile.season,
        chicken_count: profile.chicken_count,
        queen_rank: profile.queen_rank,
        snapshotted_at: new Date().toISOString(),
      },
      "steam_id,season,mmr,chicken_count,queen_rank"
    );
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
  const ids = [...new Set(steamIds.map(String).filter(Boolean))];
  if (ids.length === 0) return [];

  if (ids.length > DRODO_COURIER_BATCH_SIZE) {
    const results = [];
    for (let i = 0; i < ids.length; i += DRODO_COURIER_BATCH_SIZE) {
      results.push(
        ...(await fetchAndCacheDrodoBatch(ids.slice(i, i + DRODO_COURIER_BATCH_SIZE), supabase, options))
      );
    }
    return results;
  }

  const pollMode = options.pollMode ?? "reset";
  const prevSnapshots = pollMode === "adaptive" ? await loadPollSnapshots(ids, supabase) : new Map();

  let payload;
  try {
    const response = await fetch(`${DRODO_BASE}/courier/get/@${ids.join(",")}`);
    if (!response.ok) {
      return ids.map((steamId) => ({
        steam_id: steamId,
        ok: false,
        kind: "upstream_error",
        status: response.status,
        error: "Drodo API error",
      }));
    }
    payload = await response.json();
  } catch {
    return ids.map((steamId) => ({
      steam_id: steamId,
      ok: false,
      kind: "upstream_error",
      error: "Failed to reach Drodo API",
    }));
  }

  const results = [];
  for (const steamId of ids) {
    const drodoData = payload.user_info?.[steamId];
    if (payload.err !== 0 || !drodoData) {
      const fetchedAt = await markDrodoMissing(steamId, supabase);
      results.push({
        steam_id: steamId,
        ok: false,
        kind: "missing",
        error: "Player not found on Drodo",
        fetchedAt,
      });
      continue;
    }

    const { profile, seasonRows } = buildDrodoProfile(steamId, drodoData);
    if (!hasDrodoStats(profile, seasonRows)) {
      const fetchedAt = await markDrodoMissing(steamId, supabase);
      results.push({
        steam_id: steamId,
        ok: false,
        kind: "missing",
        error: EMPTY_DRODO_PROFILE_ERROR,
        fetchedAt,
      });
      continue;
    }

    await persistDrodoProfile(profile, seasonRows, supabase, {
      snapshotOnSuccess: options.snapshotOnSuccess,
      pollMode,
      hotPoll: options.hotPoll,
      prevSnapshot: prevSnapshots.get(steamId) ?? null,
    });
    results.push({ steam_id: steamId, ok: true, profile, seasonRows });
  }
  return results;
}

function summarize(results) {
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
  const selectedMode = mode();
  const limit = batchSize(selectedMode);
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
    const ids = await loadAllIds(supabase, limit);
    results = await fetchAndCacheDrodoBatch(ids, supabase, {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
    });
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
