import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activePollOrFilter,
  buildDrodoProfile,
  currentSeason,
  inactivePollCutoff,
  extractAllSeasons,
  hasDrodoStats,
  isActivePollUser,
  isQueenProfile,
  EMPTY_DRODO_PROFILE_ERROR,
  fetchDrodoProfileBatch,
  normalizeDrodoSteamIds,
  preserveOmittedDrodoFields,
  DRODO_BACKGROUND_POLL_ENABLED,
  DRODO_BASE,
  DRODO_COURIER_CONCURRENCY,
  DRODO_COURIER_PACE_MS,
  DRODO_MMR_ENABLED,
  POLL_ACTIVE_INTERVAL_SECONDS,
  POLL_INACTIVE_INTERVAL_SECONDS,
  QUEENS_REFRESH_COOLDOWN_MS,
  recentSignInCutoff,
  summarizeDrodoResults,
} from "../shared/drodo-core.mjs";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../shared/fixtures/drodo"
);
const drodoFixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8"));

assert.deepEqual(normalizeDrodoSteamIds(["1", 1, "", null, undefined, "2"]), [
  "1",
  "2",
]);

assert.equal(DRODO_BASE, "http://autochess.ppbizon.com");
assert.equal(DRODO_COURIER_CONCURRENCY, 4);
assert.equal(DRODO_COURIER_PACE_MS, 250);
assert.equal(DRODO_MMR_ENABLED, true);
assert.equal(DRODO_BACKGROUND_POLL_ENABLED, true);
assert.equal(POLL_ACTIVE_INTERVAL_SECONDS, 24 * 60 * 60);
assert.equal(POLL_INACTIVE_INTERVAL_SECONDS, 7 * 24 * 60 * 60);
assert.equal(QUEENS_REFRESH_COOLDOWN_MS, 5 * 60 * 1000);

const policyNow = new Date("2026-06-16T12:00:00.000Z");
const policyCutoff = recentSignInCutoff(policyNow);
assert.equal(policyCutoff, "2026-06-02T12:00:00.000Z");
assert.equal(
  activePollOrFilter(policyCutoff),
  "steam_signed_in_at.gte.2026-06-02T12:00:00.000Z"
);
assert.equal(
  isActivePollUser(
    { steam_signed_in_at: "2026-06-10T00:00:00.000Z", queen_ladder_rank: null },
    policyCutoff
  ),
  true
);
assert.equal(
  isActivePollUser(
    { steam_signed_in_at: null, queen_ladder_rank: 42 },
    policyCutoff
  ),
  false
);
assert.equal(
  isActivePollUser(
    { steam_signed_in_at: "2026-05-01T00:00:00.000Z", queen_ladder_rank: null },
    policyCutoff
  ),
  false
);
assert.equal(inactivePollCutoff(policyNow), "2026-06-09T12:00:00.000Z");

const rolloverData = {
  mmr_s43: "8120",
  max_mmr_s43: "8450",
  match_s43: "215",
  max_mmr_s44: "0",
  match_s44: "0",
  chicken_count: "0",
};
const rolloverProfile = buildDrodoProfile("444", rolloverData);
assert.equal(currentSeason(rolloverData), "s44");
assert.deepEqual(
  extractAllSeasons("444", rolloverData, "s44").map((row) => ({
    season: row.season,
    mmr: row.mmr,
    max_mmr: row.max_mmr,
    games_played: row.games_played,
    chicken_count: row.chicken_count,
  })),
  [
    {
      season: "s43",
      mmr: 8120,
      max_mmr: 8450,
      games_played: 215,
      chicken_count: null,
    },
    {
      season: "s44",
      mmr: null,
      max_mmr: null,
      games_played: null,
      chicken_count: null,
    },
  ]
);
assert.equal(rolloverProfile.profile.season, "s44");
assert.equal(rolloverProfile.profile.mmr, null);
assert.equal(rolloverProfile.profile.season_games, null);
assert.equal(
  hasDrodoStats(rolloverProfile.profile, rolloverProfile.seasonRows),
  true
);
assert.equal(
  hasDrodoStats(
    { mmr: null, max_mmr: null, season_games: null, chicken_count: 0 },
    []
  ),
  false
);

// Rank-only payloads are real profiles. The courier stopped returning season
// MMR; if these counted as "missing" every refreshed profile would blank out.
assert.equal(
  hasDrodoStats(
    { mmr: null, max_mmr: null, mmr_level: 32, season_games: null, chicken_count: 0 },
    []
  ),
  true
);
assert.equal(
  hasDrodoStats(
    { mmr: null, max_mmr: null, queen_rank: 14, season_games: null, chicken_count: 0 },
    []
  ),
  true
);

// A payload that omits mmr_level must not wipe the cached rank.
assert.equal(
  preserveOmittedDrodoFields(
    { drodo_mmr: 3200, drodo_mmr_level: 33, drodo_season: "s21" },
    { mmr: null, max_mmr: null, mmr_level: null, season: null, season_games: null, queen_rank: null }
  ).mmr_level,
  33
);
assert.equal(
  preserveOmittedDrodoFields(
    { drodo_mmr_level: 33 },
    { mmr_level: 34, mmr: null, max_mmr: null, season: null, season_games: null, queen_rank: null }
  ).mmr_level,
  34,
  "a fresh mmr_level always wins over the cached one"
);

const persisted = [];
const markedMissing = [];
const fetchedUrls = [];

const results = await fetchDrodoProfileBatch(
  ["111", "111", "222", "333", "444"],
  {
    fetch: async (url) => {
      fetchedUrls.push(String(url));
      assert.equal(String(url).includes(","), false);
      const steamId = String(url).split("@").at(-1);
      const keyed = {
        111: {
          mmr_s1: "1200",
          max_mmr_s1: "1300",
          match_s1: "10",
          chicken_count: "2",
          queen_rank: "42",
        },
        222: {},
        444: {
          max_mmr_s2: "0",
          match_s2: "0",
          chicken_count: "0",
        },
      };
      const drodoData = keyed[steamId];
      return {
        ok: true,
        json: async () =>
          drodoData
            ? { err: 0, user_info: { [steamId]: drodoData } }
            : { err: 0, user_info: {} },
      };
    },
    loadPollSnapshots: async () =>
      new Map([
        [
          "111",
          {
            drodo_mmr: 1100,
            drodo_season_games: 9,
            drodo_chicken_count: 1,
            queen_rank: null,
            queen_ladder_last_seen_at: null,
            poll_interval_seconds: 600,
          },
        ],
      ]),
    markMissing: async (steamId) => {
      markedMissing.push(steamId);
      return `missing-${steamId}`;
    },
    persistProfile: async (profile, seasonRows, options) => {
      persisted.push({
        steamId: profile.steam_id,
        mmr: profile.mmr,
        season: profile.season,
        seasonRows: seasonRows.length,
        pollMode: options.pollMode,
        changedFromPrev: options.prevSnapshot?.drodo_mmr !== profile.mmr,
      });
    },
  },
  { pollMode: "adaptive", snapshotOnSuccess: true, paceMs: 0 }
);

assert.deepEqual(
  results.map((result) => ({
    steamId: result.steam_id,
    ok: result.ok,
    kind: result.ok ? "ok" : result.kind,
    error: result.ok ? null : result.error,
    fetchedAt: result.ok ? null : result.fetchedAt,
  })),
  [
    { steamId: "111", ok: true, kind: "ok", error: null, fetchedAt: null },
    {
      steamId: "222",
      ok: false,
      kind: "missing",
      error: EMPTY_DRODO_PROFILE_ERROR,
      fetchedAt: "missing-222",
    },
    {
      steamId: "333",
      ok: false,
      kind: "missing",
      error: "Player not found on Drodo",
      fetchedAt: "missing-333",
    },
    { steamId: "444", ok: true, kind: "ok", error: null, fetchedAt: null },
  ]
);

assert.deepEqual(
  [...fetchedUrls].sort(),
  [
    "http://autochess.ppbizon.com/courier/get/@111",
    "http://autochess.ppbizon.com/courier/get/@222",
    "http://autochess.ppbizon.com/courier/get/@333",
    "http://autochess.ppbizon.com/courier/get/@444",
  ]
);
assert.deepEqual(markedMissing, ["222", "333"]);
assert.deepEqual(persisted, [
  {
    steamId: "111",
    mmr: 1200,
    season: "s1",
    seasonRows: 1,
    pollMode: "adaptive",
    changedFromPrev: true,
  },
  {
    steamId: "444",
    mmr: null,
    season: "s2",
    seasonRows: 1,
    pollMode: "adaptive",
    changedFromPrev: true,
  },
]);
assert.deepEqual(summarizeDrodoResults(results), {
  ok: 2,
  missing: 2,
  upstream_error: 0,
});

// Drodo currently omits season MMR keys for many accounts while still returning
// chicken_count / mmr_level. A refresh must not wipe the cached MMR.
const omitMmrPersisted = [];
const omitMmrResults = await fetchDrodoProfileBatch(
  ["555"],
  {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        err: 0,
        user_info: {
          555: {
            chicken_count: "4",
            candy: "100",
            mmr_level: "18",
            award_season_mmr_level: "22",
          },
        },
      }),
    }),
    loadPollSnapshots: async () =>
      new Map([
        [
          "555",
          {
            drodo_mmr: 1713,
            drodo_max_mmr: 1995,
            drodo_season: "s44",
            drodo_season_games: 40,
            drodo_chicken_count: 3,
            queen_rank: null,
            queen_ladder_last_seen_at: null,
            poll_interval_seconds: 86400,
          },
        ],
      ]),
    markMissing: async () => {
      throw new Error("omit-MMR profile should not be marked missing");
    },
    persistProfile: async (profile, _seasonRows, options) => {
      omitMmrPersisted.push({
        mmr: profile.mmr,
        max_mmr: profile.max_mmr,
        season: profile.season,
        season_games: profile.season_games,
        chicken_count: profile.chicken_count,
        mmr_level: profile.mmr_level,
        changedFromPrev: options.prevSnapshot?.drodo_mmr !== profile.mmr,
      });
    },
  },
  { pollMode: "reset", snapshotOnSuccess: true, paceMs: 0 }
);
assert.equal(omitMmrResults[0]?.ok, true);
assert.deepEqual(omitMmrPersisted, [
  {
    mmr: 1713,
    max_mmr: 1995,
    season: "s44",
    season_games: 40,
    chicken_count: 4,
    mmr_level: 18,
    changedFromPrev: false,
  },
]);

const upstreamResults = await fetchDrodoProfileBatch(["999"], {
  fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  markMissing: async () => {
    throw new Error("markMissing should not run for upstream errors");
  },
  persistProfile: async () => {
    throw new Error("persistProfile should not run for upstream errors");
  },
});

assert.deepEqual(upstreamResults, [
  {
    steam_id: "999",
    ok: false,
    kind: "upstream_error",
    status: 503,
    error: "Drodo API error",
  },
]);

const queenFixture = drodoFixture("queen-76561198839665680.json");
const kingFixture = drodoFixture("king-76561198414820633.json");
const missingRankFixture = drodoFixture("missing-queen-rank-76561198022169086.json");
const batchErrorFixture = drodoFixture("batch-err-1200.json");

function seasonSummary(built) {
  return {
    season: built.profile.season,
    mmr: built.profile.mmr,
    max_mmr: built.profile.max_mmr,
    season_games: built.profile.season_games,
    queen_rank: built.profile.queen_rank,
    mmr_level: built.profile.mmr_level,
    seasons: built.seasonRows.map((row) => ({
      season: row.season,
      mmr: row.mmr,
      max_mmr: row.max_mmr,
      games_played: row.games_played,
    })),
  };
}

const queenBuilt = buildDrodoProfile(
  queenFixture.steam_id,
  queenFixture.user_info
);
assert.deepEqual(seasonSummary(queenBuilt), {
  season: "s45",
  mmr: 12718,
  max_mmr: 12718,
  season_games: 324,
  queen_rank: 11,
  mmr_level: 38,
  seasons: [
    { season: "s44", mmr: 4406, max_mmr: 4670, games_played: 170 },
    { season: "s45", mmr: 12718, max_mmr: 12718, games_played: 324 },
  ],
});
assert.equal(typeof queenFixture.user_info.mmr_s45, "number");
assert.equal(typeof queenFixture.user_info.max_mmr_s45, "string");
assert.equal(typeof queenFixture.user_info.match_s45, "string");
assert.equal(isQueenProfile(queenBuilt.profile, null), true);

const kingBuilt = buildDrodoProfile(kingFixture.steam_id, kingFixture.user_info);
assert.equal(kingFixture.user_info.queen_rank, -1);
assert.equal(kingFixture.user_info.mmr_level, 37);
assert.equal(kingBuilt.profile.queen_rank, null);
assert.equal(kingBuilt.profile.season, "s45");
assert.equal(kingBuilt.profile.mmr, 3379);
assert.equal(kingBuilt.profile.max_mmr, 3381);
assert.equal(kingBuilt.profile.season_games, 20);
assert.equal(isQueenProfile(kingBuilt.profile, null), false);
assert.equal(isQueenProfile({ queen_rank: 0 }, null), false);
assert.equal(isQueenProfile({ queen_rank: -1 }, { queen_rank: -1 }), false);

const missingRankBuilt = buildDrodoProfile(
  missingRankFixture.steam_id,
  missingRankFixture.user_info
);
assert.equal(
  Object.prototype.hasOwnProperty.call(missingRankFixture.user_info, "queen_rank"),
  false
);
assert.equal(missingRankBuilt.profile.queen_rank, null);
assert.equal(missingRankBuilt.profile.season, "s45");
assert.equal(missingRankBuilt.profile.mmr, null);
assert.equal(
  missingRankBuilt.seasonRows.find((row) => row.season === "s44")?.mmr,
  1810
);
assert.equal(isQueenProfile(missingRankBuilt.profile, null), false);
assert.equal(
  preserveOmittedDrodoFields(
    { queen_rank: 14, drodo_mmr: 1000 },
    missingRankBuilt.profile
  ).queen_rank,
  14,
  "an omitted queen_rank keeps the cached ladder place"
);
assert.equal(
  preserveOmittedDrodoFields(
    { queen_rank: 14 },
    kingBuilt.profile
  ).queen_rank,
  null,
  "an explicit -1 clears a cached queen rank"
);

const flatMarkedMissing = [];
const flatPersisted = [];
const flatUrls = [];
const flatResults = await fetchDrodoProfileBatch(
  [queenFixture.steam_id, kingFixture.steam_id, missingRankFixture.steam_id],
  {
    fetch: async (url) => {
      flatUrls.push(String(url));
      const steamId = decodeURIComponent(String(url).split("@").at(-1));
      const body = {
        [queenFixture.steam_id]: queenFixture,
        [kingFixture.steam_id]: kingFixture,
        [missingRankFixture.steam_id]: missingRankFixture,
      }[steamId];
      return { ok: true, json: async () => body };
    },
    markMissing: async (steamId) => {
      flatMarkedMissing.push(steamId);
      return `missing-${steamId}`;
    },
    persistProfile: async (profile) => {
      flatPersisted.push({
        steamId: profile.steam_id,
        mmr: profile.mmr,
        queen_rank: profile.queen_rank,
        season: profile.season,
      });
    },
  },
  { paceMs: 0 }
);
assert.deepEqual(flatMarkedMissing, []);
assert.equal(flatUrls.some((url) => url.includes(",")), false);
assert.deepEqual(
  flatPersisted,
  [
    { steamId: queenFixture.steam_id, mmr: 12718, queen_rank: 11, season: "s45" },
    { steamId: kingFixture.steam_id, mmr: 3379, queen_rank: null, season: "s45" },
    {
      steamId: missingRankFixture.steam_id,
      mmr: null,
      queen_rank: null,
      season: "s45",
    },
  ]
);
assert.deepEqual(
  flatResults.map((result) => result.ok),
  [true, true, true]
);

let inFlight = 0;
let maxInFlight = 0;
await fetchDrodoProfileBatch(
  ["1", "2", "3", "4"],
  {
    fetch: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return {
        ok: true,
        json: async () => ({
          err: 0,
          user_info: { mmr_level: 10, mmr_s1: "100" },
        }),
      };
    },
    markMissing: async () => {
      throw new Error("concurrency probe should persist");
    },
    persistProfile: async () => {},
  },
  { concurrency: 2, paceMs: 0 }
);
assert.equal(maxInFlight, 2);

const batchErrorMarked = [];
const batchErrorUrls = [];
const batchErrorResults = await fetchDrodoProfileBatch(
  ["76561198839665680", "76561198840403868"],
  {
    fetch: async (url) => {
      batchErrorUrls.push(String(url));
      return { ok: true, status: 200, json: async () => batchErrorFixture };
    },
    markMissing: async (steamId) => {
      batchErrorMarked.push(steamId);
      return "missing";
    },
    persistProfile: async () => {
      throw new Error("err 1200 must not persist a profile");
    },
  },
  { paceMs: 0 }
);
assert.deepEqual(batchErrorFixture, {
  err: 1200,
  msg: "系统错误",
  err_msg: "invalid",
});
assert.equal(batchErrorUrls.some((url) => url.includes(",")), false);
assert.deepEqual(batchErrorMarked, []);
assert.deepEqual(
  batchErrorResults.map((result) => ({
    steamId: result.steam_id,
    ok: result.ok,
    kind: result.kind,
    error: result.error,
  })),
  [
    {
      steamId: "76561198839665680",
      ok: false,
      kind: "upstream_error",
      error: "Drodo API error 1200: invalid",
    },
    {
      steamId: "76561198840403868",
      ok: false,
      kind: "upstream_error",
      error: "Drodo API error 1200: invalid",
    },
  ]
);

console.log("Drodo core smoke passed");
