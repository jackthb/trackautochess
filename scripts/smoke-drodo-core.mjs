import assert from "node:assert/strict";
import {
  activePollOrFilter,
  buildDrodoProfile,
  currentSeason,
  inactivePollCutoff,
  extractAllSeasons,
  hasDrodoStats,
  isActivePollUser,
  EMPTY_DRODO_PROFILE_ERROR,
  fetchDrodoProfileBatch,
  normalizeDrodoSteamIds,
  POLL_ACTIVE_INTERVAL_SECONDS,
  POLL_INACTIVE_INTERVAL_SECONDS,
  QUEENS_REFRESH_COOLDOWN_MS,
  recentSignInCutoff,
  summarizeDrodoResults,
} from "../shared/drodo-core.mjs";

assert.deepEqual(normalizeDrodoSteamIds(["1", 1, "", null, undefined, "2"]), [
  "1",
  "2",
]);

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

const persisted = [];
const markedMissing = [];

const results = await fetchDrodoProfileBatch(
  ["111", "111", "222", "333", "444"],
  {
    fetch: async (url) => {
      assert.equal(
        url,
        "http://autochess.ppbizon.com/courier/get/@111,222,333,444"
      );
      return {
        ok: true,
        json: async () => ({
          err: 0,
          user_info: {
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
          },
        }),
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
  { pollMode: "adaptive", snapshotOnSuccess: true }
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
  { pollMode: "reset", snapshotOnSuccess: true }
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

console.log("Drodo core smoke passed");
