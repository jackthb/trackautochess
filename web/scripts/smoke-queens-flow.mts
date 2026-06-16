import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextQueensRefreshDelayMs } from "../app/queens/refreshTiming";
import { fetchAndCacheDrodoBatch } from "../lib/drodo";
import { readThroughDrodoProfile } from "../lib/drodoReadThrough";
import { refreshDisplayedQueens } from "../lib/queensRefresh";

const STEAM_ID = "76561198000000001";
const CUSTOM_URL = "smokequeen";

type QueryResult<T> = { data: T; error: null };

interface QueryCall {
  table: string;
  op: "select" | "upsert";
  payload?: unknown;
}

interface SmokeState {
  rows: Record<string, unknown>[];
  calls: QueryCall[];
  lockGranted: boolean;
}

class FakeQueryBuilder {
  private selected = "";

  constructor(
    private readonly table: string,
    private readonly state: SmokeState
  ) {}

  select(columns?: string) {
    this.selected = columns ?? "";
    return this;
  }

  filter() {
    return this;
  }

  not() {
    return this;
  }

  or() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  maybeSingle(): Promise<QueryResult<Record<string, unknown> | null>> {
    this.state.calls.push({ table: this.table, op: "select" });
    if (this.table === "users") {
      return Promise.resolve({ data: this.state.rows[0] ?? null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  upsert(payload: unknown): Promise<QueryResult<null>> {
    this.state.calls.push({ table: this.table, op: "upsert", payload });
    return Promise.resolve({ data: null, error: null });
  }

  then<TResult1 = QueryResult<Record<string, unknown>[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult<Record<string, unknown>[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private result(): QueryResult<Record<string, unknown>[]> {
    this.state.calls.push({ table: this.table, op: "select" });
    if (this.table === "users") {
      return { data: this.state.rows, error: null };
    }
    if (this.table === "player_seasons" && this.selected.includes("chicken_count")) {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }
}

function fakeSupabase(
  rows: Record<string, unknown>[],
  options: { lockGranted?: boolean } = {}
): SupabaseClient {
  const state: SmokeState = {
    rows,
    calls: [],
    lockGranted: options.lockGranted ?? true,
  };
  return {
    __state: state,
    rpc: async () => ({ data: state.lockGranted, error: null }),
    from: (table: string) => new FakeQueryBuilder(table, state),
  } as unknown as SupabaseClient;
}

function supabaseState(client: SupabaseClient): SmokeState {
  return (client as unknown as { __state: SmokeState }).__state;
}

function drodoPayload(queenRank: number) {
  return {
    err: 0,
    user_info: {
      [STEAM_ID]: {
        mmr_s26: 4120,
        max_mmr_s26: 4200,
        match_s26: 88,
        mmr_level: 38,
        queen_rank: queenRank,
        chicken_count: 12,
        candy: 0,
      },
    },
  };
}

function mockDrodoFetch(queenRank: number) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    assert.match(String(url), /autochess\.ppbizon\.com\/courier\/get/);
    return new Response(JSON.stringify(drodoPayload(queenRank)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function queenRow(overrides: Record<string, unknown> = {}) {
  return {
    steam_id: STEAM_ID,
    name: "Smoke Queen",
    custom_url: CUSTOM_URL,
    avatar_url: null,
    stream_link: null,
    drodo_mmr: 4000,
    drodo_max_mmr: 4200,
    drodo_mmr_level: 38,
    drodo_season: "s26",
    drodo_season_games: 87,
    drodo_candy: 0,
    drodo_chicken_count: 11,
    drodo_raw_data: { queen_rank: 9 },
    drodo_last_fetched_at: new Date(0).toISOString(),
    drodo_profile_missing: false,
    queen_ladder_rank: 9,
    queen_ladder_season: "s26",
    queen_ladder_last_seen_at: new Date(0).toISOString(),
    poll_interval_seconds: 3600,
    ...overrides,
  };
}

async function smokeReadThroughProfileLock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("read-through lock smoke must not call Drodo");
  }) as typeof fetch;
  const supabase = fakeSupabase([queenRow()], { lockGranted: false });

  try {
    const result = await readThroughDrodoProfile({
      steamId: STEAM_ID,
      supabase,
      forceRefresh: true,
    });

    assert.equal(result.kind, "profile");
    if (result.kind === "profile") {
      assert.equal(result.source, "stale");
      assert.equal(result.payload.mmr, 4000);
      assert.equal(result.payload.refresh_pending, true);
    }

    const state = supabaseState(supabase);
    assert.equal(
      state.calls.some((call) => call.table === "users" && call.op === "upsert"),
      false,
      "a locked read-through refresh must not write a duplicate profile"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function smokeDrodoPersistenceCallback() {
  const restoreFetch = mockDrodoFetch(7);
  const supabase = fakeSupabase([queenRow()]);
  const changedProfiles: string[] = [];

  try {
    const results = await fetchAndCacheDrodoBatch([STEAM_ID], supabase, {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
      hotPoll: true,
      onQueenChange: (profile) => {
        changedProfiles.push(`${profile.steam_id}:${profile.queen_rank}`);
      },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.ok, true);
    assert.deepEqual(changedProfiles, [`${STEAM_ID}:7`]);

    const state = supabaseState(supabase);
    const userUpsert = state.calls.find(
      (call) => call.table === "users" && call.op === "upsert"
    );
    assert.ok(userUpsert, "fresh Queen profile must be persisted to users");
    assert.equal(
      "drodo_queen_rank" in (userUpsert.payload as Record<string, unknown>),
      false,
      "Drodo profile refreshes must not write the removed Queen rank column"
    );
    assert.equal(
      "queen_ladder_last_seen_at" in (userUpsert.payload as Record<string, unknown>),
      false,
      "Drodo profile refreshes must not overwrite captured ladder timestamps"
    );

    const snapshotUpsert = state.calls.find(
      (call) => call.table === "mmr_snapshots" && call.op === "upsert"
    );
    assert.ok(
      snapshotUpsert,
      "successful profile refresh must snapshot MMR/Queen rank history"
    );
    assert.equal(
      (snapshotUpsert.payload as Record<string, unknown>).queen_rank,
      7,
      "Queen profile refreshes must persist the reported Queen rank into history"
    );
  } finally {
    restoreFetch();
  }
}

async function smokeDisplayedQueensRefreshTarget() {
  const restoreFetch = mockDrodoFetch(6);
  const supabase = fakeSupabase([queenRow()]);
  const targets: Array<{ steam_id: string; custom_url?: string | null }> = [];

  try {
    const summary = await refreshDisplayedQueens(supabase, {
      floorMs: 0,
      lockTtlMs: 1,
      onQueenChange: (target) => {
        targets.push(target);
      },
    });

    assert.equal(summary.polled, 1);
    assert.equal(summary.ok, 1);
    assert.equal(summary.changed, 1);
    assert.match(summary.checked_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(targets, [{ steam_id: STEAM_ID, custom_url: CUSTOM_URL }]);
  } finally {
    restoreFetch();
  }
}

function smokeQueensRefreshTiming() {
  const cooldownMs = 5 * 60 * 1000;
  const nowMs = Date.UTC(2026, 5, 13, 12, 0, 0);

  assert.equal(nextQueensRefreshDelayMs(null, cooldownMs, nowMs), 0);
  assert.equal(
    nextQueensRefreshDelayMs(new Date(nowMs - cooldownMs - 1).toISOString(), cooldownMs, nowMs),
    0
  );
  assert.equal(
    nextQueensRefreshDelayMs(new Date(nowMs).toISOString(), cooldownMs, nowMs),
    cooldownMs
  );
}

smokeQueensRefreshTiming();
await smokeReadThroughProfileLock();
await smokeDrodoPersistenceCallback();
await smokeDisplayedQueensRefreshTarget();

console.log("Queens refresh smoke passed");
