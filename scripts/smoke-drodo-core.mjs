import assert from "node:assert/strict";
import {
  EMPTY_DRODO_PROFILE_ERROR,
  fetchDrodoProfileBatch,
  normalizeDrodoSteamIds,
  summarizeDrodoResults,
} from "../shared/drodo-core.mjs";

assert.deepEqual(normalizeDrodoSteamIds(["1", 1, "", null, undefined, "2"]), [
  "1",
  "2",
]);

const persisted = [];
const markedMissing = [];

const results = await fetchDrodoProfileBatch(
  ["111", "111", "222", "333"],
  {
    fetch: async (url) => {
      assert.equal(
        url,
        "http://autochess.ppbizon.com/courier/get/@111,222,333"
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
  ]
);

assert.deepEqual(markedMissing, ["222", "333"]);
assert.deepEqual(persisted, [
  {
    steamId: "111",
    mmr: 1200,
    seasonRows: 1,
    pollMode: "adaptive",
    changedFromPrev: true,
  },
]);
assert.deepEqual(summarizeDrodoResults(results), {
  ok: 1,
  missing: 2,
  upstream_error: 0,
});

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
