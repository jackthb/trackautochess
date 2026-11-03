// Source of truth for Drodo polling logic. Run `npm run build:drodo-core` after editing.
const DRODO_BASE_VALUE = "http://autochess.ppbizon.com";
// `/courier/get/@id1,id2` returns HTTP 200 `{"err":1200,"err_msg":"invalid"}`.
// Every lookup is one Steam ID. Keep a few calls in flight, and space their
// starts so a poll of hundreds of players does not burst the upstream.
const DRODO_COURIER_CONCURRENCY_VALUE = 4;
const DRODO_COURIER_PACE_MS_VALUE = 250;
/** Season MMR is on the public courier again (verified 2026-10-24). */
const DRODO_MMR_ENABLED_VALUE = true;
/** Background poll runs when the Cronicle job is enabled. The job definitions still ship disabled. */
const DRODO_BACKGROUND_POLL_ENABLED_VALUE = true;

const DRODO_FRESH_TTL_MS_VALUE = 24 * 60 * 60 * 1000;
const DRODO_MISSING_TTL_MS_VALUE = 7 * 24 * 60 * 60 * 1000;
const EMPTY_DRODO_PROFILE_ERROR_VALUE =
  "Steam account has no Dota Auto Chess MMR or stats.";

const POLL_ACTIVE_INTERVAL_SECONDS_VALUE = 24 * 60 * 60;
/** Background poll cadence for users outside the active (recent Steam sign-in) cohort. */
const POLL_INACTIVE_INTERVAL_SECONDS_VALUE = 7 * 24 * 60 * 60;
const POLL_MIN_INTERVAL_SECONDS_VALUE = POLL_ACTIVE_INTERVAL_SECONDS_VALUE;
const POLL_MAX_INTERVAL_SECONDS_VALUE = POLL_INACTIVE_INTERVAL_SECONDS_VALUE;
const POLL_BACKOFF_FACTOR_VALUE = 1.5;
const HOT_POLL_MAX_INTERVAL_SECONDS_VALUE = POLL_ACTIVE_INTERVAL_SECONDS_VALUE;
const ACTIVE_SIGN_IN_WINDOW_MS_VALUE = 14 * 24 * 60 * 60 * 1000;
const QUEENS_REFRESH_COOLDOWN_MS_VALUE = 5 * 60 * 1000;
const QUEENS_VIEW_REFRESH_COOLDOWN_MS_VALUE = QUEENS_REFRESH_COOLDOWN_MS_VALUE;
const SEASON_FIELD_KEY_VALUE = /^(?:mmr|max_mmr|match)_s(\d+)$/;

function recentSignInCutoffValue(now: Date = new Date()): string {
  return new Date(now.getTime() - ACTIVE_SIGN_IN_WINDOW_MS_VALUE).toISOString();
}

function activePollOrFilterValue(cutoffIso: string): string {
  // Queen ladder rank does not define the active cohort. Active means a recent
  // Steam sign-in; everyone else stays on the weekly cadence. The public board
  // itself is still the in-game ladder capture.
  return `steam_signed_in_at.gte.${cutoffIso}`;
}

function isActivePollUserValue(user: { steam_signed_in_at?: string | null; queen_ladder_rank?: number | null } | null | undefined, cutoffIso: string): boolean {
  if (!user) return false;
  return user.steam_signed_in_at != null && user.steam_signed_in_at >= cutoffIso;
}

function inactivePollCutoffValue(now: Date = new Date()): string {
  return new Date(now.getTime() - POLL_INACTIVE_INTERVAL_SECONDS_VALUE * 1000).toISOString();
}

function steamIdValue(steamId: unknown): string {
  return String(steamId);
}

function seasonNumbersValue(data: Record<string, unknown>): number[] {
  const seasons = new Set<number>();
  for (const key of Object.keys(data)) {
    const match = key.match(SEASON_FIELD_KEY_VALUE);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > 0) seasons.add(n);
  }
  return [...seasons].sort((a, b) => a - b);
}

function currentSeasonValue(data: Record<string, unknown>): string | null {
  const latest = seasonNumbersValue(data).at(-1);
  return latest ? `s${latest}` : null;
}

function extractAllSeasonsValue(steamId: string, data: Record<string, unknown>, currentSeasonKey: string | null): SeasonSnapshotRow[] {
  const now = new Date().toISOString();
  const seasons = [];
  for (const n of seasonNumbersValue(data)) {
    const seasonKey = `s${n}`;
    seasons.push({
      steam_id: steamIdValue(steamId),
      season: seasonKey,
      mmr: positiveNumberFromDrodoDataValue(data, `mmr_s${n}`),
      max_mmr: positiveNumberFromDrodoDataValue(data, `max_mmr_s${n}`),
      games_played: positiveNumberFromDrodoDataValue(data, `match_s${n}`),
      chicken_count:
        seasonKey === currentSeasonKey
          ? positiveNumberFromDrodoDataValue(data, "chicken_count")
          : null,
      fetched_at: now,
    });
  }
  return seasons.sort((a, b) => Number(a.season.slice(1)) - Number(b.season.slice(1)));
}

function numberFromDrodoDataValue(data: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!data) return null;
  const value = data[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveNumberFromDrodoDataValue(data: Record<string, unknown>, key: string): number | null {
  const value = numberFromDrodoDataValue(data, key);
  return value !== null && value > 0 ? value : null;
}

/** `0`, negatives, and Drodo's non-Queen sentinel `-1` are not a ladder place. */
function queenRankFromDrodoDataValue(data: Record<string, unknown> | null | undefined): number | null {
  const value = numberFromDrodoDataValue(data, "queen_rank");
  if (value === null || value <= 0) return null;
  return value;
}

function drodoQueenRankExplicitValue(data: Record<string, unknown> | null | undefined): boolean {
  return !!data && Object.prototype.hasOwnProperty.call(data, "queen_rank");
}

function valueFromDrodoDataValue(data: Record<string, unknown> | null | undefined, keys: string[]): string | number | null {
  if (!data) return null;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function lastWinFromDrodoDataValue(data: Record<string, unknown>): string | number | null {
  return valueFromDrodoDataValue(data, [
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

function lastTop3FromDrodoDataValue(data: Record<string, unknown>): string | number | null {
  return valueFromDrodoDataValue(data, [
    "last_top3_at",
    "last_top3_date",
    "last_top3_time",
    "top3_at",
    "top3_date",
    "top3_time",
  ]);
}

function buildDrodoProfileValue(steamId: string, drodoData: Record<string, unknown>) {
  const season = currentSeasonValue(drodoData);
  const mmrKey = season ? `mmr_${season}` : null;
  const maxMmrKey = season ? `max_mmr_${season}` : null;
  const matchKey = season ? `match_${season}` : null;
  const profile = {
    steam_id: steamIdValue(steamId),
    mmr: mmrKey ? positiveNumberFromDrodoDataValue(drodoData, mmrKey) : null,
    max_mmr: maxMmrKey ? positiveNumberFromDrodoDataValue(drodoData, maxMmrKey) : null,
    mmr_level: positiveNumberFromDrodoDataValue(drodoData, "mmr_level"),
    queen_rank: queenRankFromDrodoDataValue(drodoData),
    last_win_at: lastWinFromDrodoDataValue(drodoData),
    last_top3_at: lastTop3FromDrodoDataValue(drodoData),
    season,
    season_games: matchKey ? positiveNumberFromDrodoDataValue(drodoData, matchKey) : null,
    candy: positiveNumberFromDrodoDataValue(drodoData, "candy"),
    chicken_count: Number(drodoData.chicken_count) || 0,
    raw_data: drodoData,
    fetched_at: new Date().toISOString(),
  };
  return { profile, seasonRows: extractAllSeasonsValue(steamId, drodoData, season) };
}

type DrodoStatsLike = Partial<
  Pick<
    DrodoProfileRow,
    "mmr" | "max_mmr" | "mmr_level" | "queen_rank" | "season_games" | "chicken_count"
  >
>;

function numericField(record: object | null | undefined, key: string): number | null {
  if (!record || !(key in record)) return null;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasPositiveNumericField(record: object | null | undefined, key: string): boolean {
  const value = numericField(record, key);
  return value !== null && value > 0;
}

function hasDrodoStatsValue(profile: DrodoStatsLike | null | undefined, seasonRows: Pick<SeasonSnapshotRow, "mmr" | "max_mmr" | "games_played">[] = []): boolean {
  if (!profile) return false;
  if (
    hasPositiveNumericField(profile, "mmr") ||
    hasPositiveNumericField(profile, "max_mmr") ||
    hasPositiveNumericField(profile, "season_games") ||
    hasPositiveNumericField(profile, "chicken_count")
  ) {
    return true;
  }
  // A profile can still be real when season MMR is absent: mmr_level is the
  // broad tier, and a positive queen_rank is a ladder place. Marking either
  // "missing" would blank a rank the page can render.
  if (
    hasPositiveNumericField(profile, "mmr_level") ||
    hasPositiveNumericField(profile, "queen_rank")
  ) {
    return true;
  }
  // During season rollover Drodo can expose a new season key before any settled
  // MMR, peak MMR, or match count exists. That is still a real Auto Chess
  // profile; do not mark it missing and hide historical seasons.
  if (seasonRows.length > 0) return true;
  return false;
}

function drodoProfileToUserPayloadValue(profile: DrodoProfileRow): DrodoUserPayload {
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

function clampIntervalValue(seconds: number, max: number = POLL_MAX_INTERVAL_SECONDS_VALUE): number {
  if (!Number.isFinite(seconds) || seconds < POLL_MIN_INTERVAL_SECONDS_VALUE) {
    return POLL_MIN_INTERVAL_SECONDS_VALUE;
  }
  if (seconds > max) return max;
  return Math.round(seconds);
}

function nextPollScheduleValue({ mode, changed, prevIntervalSeconds, missing = false, hot = false, fixedHot = false }: { mode: "reset" | "adaptive"; changed: boolean; prevIntervalSeconds: number | null; missing?: boolean; hot?: boolean; fixedHot?: boolean }, now: Date = new Date()) {
  const maxInterval = hot || fixedHot ? HOT_POLL_MAX_INTERVAL_SECONDS_VALUE : POLL_MAX_INTERVAL_SECONDS_VALUE;
  let intervalSeconds;
  if (missing) {
    intervalSeconds = maxInterval;
  } else if (fixedHot) {
    // Queens count as active for the simple daily background policy. The
    // visible Queen board has its own five-minute refresh path.
    intervalSeconds = maxInterval;
  } else if (mode === "reset" || changed) {
    intervalSeconds = POLL_MIN_INTERVAL_SECONDS_VALUE;
  } else {
    const prev = prevIntervalSeconds ?? POLL_MIN_INTERVAL_SECONDS_VALUE;
    intervalSeconds = clampIntervalValue(prev * POLL_BACKOFF_FACTOR_VALUE, maxInterval);
  }
  intervalSeconds = clampIntervalValue(intervalSeconds, maxInterval);
  return {
    next_poll_at: new Date(Date.now() + intervalSeconds * 1000).toISOString(),
    poll_interval_seconds: intervalSeconds,
  };
}

function pollSnapshotFromRowValue(row: PollSnapshotRow): PollSnapshot {
  return {
    drodo_mmr: row.drodo_mmr,
    drodo_max_mmr: row.drodo_max_mmr ?? null,
    drodo_mmr_level: row.drodo_mmr_level ?? null,
    drodo_season: row.drodo_season ?? null,
    drodo_season_games: row.drodo_season_games,
    drodo_chicken_count: row.drodo_chicken_count,
    queen_rank:
      typeof row.queen_ladder_rank === "number" &&
      Number.isFinite(row.queen_ladder_rank) &&
      row.queen_ladder_rank > 0
        ? row.queen_ladder_rank
        : null,
    queen_ladder_last_seen_at: row.queen_ladder_last_seen_at,
    poll_interval_seconds: row.poll_interval_seconds,
  };
}

/**
 * Drodo's public courier payload intermittently omits season MMR / mmr_level /
 * queen_rank. When a field is absent on the fresh payload, keep the previously
 * cached value so a refresh cannot wipe a good profile down to null — mmr_level
 * especially, since rank is derived from it.
 */
function preserveOmittedDrodoFieldsValue(
  prev: DrodoProfileRow | PollSnapshot | null | undefined,
  next: DrodoProfileRow
): DrodoProfileRow {
  if (!prev) return next;

  const prevMmr = profileMetricValue(prev, "drodo_mmr", "mmr");
  const prevMaxMmr = profileMetricValue(prev, "drodo_max_mmr", "max_mmr");
  const prevSeasonGames = profileMetricValue(
    prev,
    "drodo_season_games",
    "season_games"
  );
  const prevMmrLevel = profileMetricValue(prev, "drodo_mmr_level", "mmr_level");
  const prevQueenRank = profileMetricValue(prev, "queen_rank", "queen_rank");
  const prevSeason =
    "drodo_season" in prev
      ? ((prev as PollSnapshot).drodo_season ?? null)
      : ((prev as DrodoProfileRow).season ?? null);

  return {
    ...next,
    mmr: next.mmr ?? prevMmr,
    max_mmr: next.max_mmr ?? prevMaxMmr,
    mmr_level: next.mmr_level ?? prevMmrLevel,
    season: next.season ?? prevSeason,
    season_games: next.season_games ?? prevSeasonGames,
    // An explicit 0 / -1 is stored as null and must clear a cached rank.
    // Only a payload that omits queen_rank keeps the previous value.
    queen_rank: drodoQueenRankExplicitValue(next.raw_data)
      ? next.queen_rank
      : (next.queen_rank ?? prevQueenRank),
  };
}

function countedQueenRankValue(record: object | null | undefined): boolean {
  const value = numericField(record, "queen_rank");
  return value !== null && value > 0;
}

function isQueenProfileValue(profile: DrodoProfileRow | PollSnapshot | null | undefined, prev: DrodoProfileRow | PollSnapshot | null = null): boolean {
  const lastSeen = profile && "queen_ladder_last_seen_at" in profile
    ? (profile as PollSnapshot).queen_ladder_last_seen_at
    : null;
  return countedQueenRankValue(profile) || countedQueenRankValue(prev) || Boolean(lastSeen);
}

function profileMetricValue(profile: DrodoProfileRow | PollSnapshot | null | undefined, snapshotKey: keyof PollSnapshot, rowKey: keyof DrodoProfileRow): number | null {
  if (!profile) return null;
  if (snapshotKey in profile) {
    const value = profile[snapshotKey as keyof typeof profile];
    return typeof value === "number" ? value : null;
  }
  const value = profile[rowKey as keyof typeof profile];
  return typeof value === "number" ? value : null;
}

function profileChangedValue(prev: DrodoProfileRow | PollSnapshot | null | undefined, next: DrodoProfileRow | PollSnapshot | null | undefined): boolean {
  if (!prev || !next) return true;
  return (
    profileMetricValue(prev, "drodo_mmr", "mmr") !== profileMetricValue(next, "drodo_mmr", "mmr") ||
    profileMetricValue(prev, "drodo_season_games", "season_games") !== profileMetricValue(next, "drodo_season_games", "season_games") ||
    profileMetricValue(prev, "drodo_chicken_count", "chicken_count") !== profileMetricValue(next, "drodo_chicken_count", "chicken_count") ||
    // Queen rank can move without any MMR/games/chicken change; count it so a
    // rank-only update still rewrites drodo_raw_data and snapshots the new rank
    // (keeps the queen-rank sparkline accurate, not just the queen_ladder_rank column).
    profileMetricValue(prev, "queen_rank", "queen_rank") !== profileMetricValue(next, "queen_rank", "queen_rank")
  );
}

function normalizeDrodoSteamIdsValue(steamIds: unknown[]): string[] {
  return [
    ...new Set(
      steamIds
        .filter((steamId) => steamId != null)
        .map(String)
        .filter(Boolean)
    ),
  ];
}

function upstreamErrorResults(ids: string[], error: Record<string, unknown> = {}): FetchDrodoBatchResult[] {
  const message = typeof error.message === "string" ? error.message : "Drodo API error";
  const status = typeof error.status === "number" ? error.status : undefined;
  return ids.map((steamId: string) => ({
    steam_id: steamId,
    ok: false as const,
    kind: "upstream_error" as const,
    status,
    error: message,
  }));
}

function isDrodoRecordValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * `err: 0` is a profile payload. Anything else — including the batch
 * response `{"err":1200,"err_msg":"invalid"}` — is an upstream failure, not
 * a missing player.
 */
function drodoPayloadErrorValue(payload: unknown): string | null {
  if (!isDrodoRecordValue(payload)) return "Drodo API error";
  const err = payload.err;
  const code = typeof err === "number" ? err : typeof err === "string" ? Number(err) : Number.NaN;
  if (code === 0) return null;
  const detail =
    typeof payload.err_msg === "string" && payload.err_msg.trim()
      ? payload.err_msg
      : typeof payload.msg === "string" && payload.msg.trim()
        ? payload.msg
        : "Drodo API error";
  return Number.isFinite(code) ? `Drodo API error ${code}: ${detail}` : detail;
}

/**
 * Current `/courier/get` returns `user_info` as the player object itself.
 * Older responses keyed that object by Steam ID. A single-ID call can be either.
 */
function drodoPlayerRecordValue(payload: unknown, steamId: string): Record<string, unknown> | null {
  if (!isDrodoRecordValue(payload)) return null;
  const userInfo = payload.user_info;
  if (!isDrodoRecordValue(userInfo)) return null;
  const keyed = userInfo[steamId];
  if (isDrodoRecordValue(keyed)) return keyed;
  if (userInfo.steam_id != null && String(userInfo.steam_id) !== steamId) return null;
  if (
    userInfo.steam_id != null ||
    "mmr_level" in userInfo ||
    seasonNumbersValue(userInfo).length > 0
  ) {
    return userInfo;
  }
  return null;
}

function drodoCourierProfileUrlValue(steamId: string): string {
  return `${DRODO_BASE_VALUE}/courier/get/@${encodeURIComponent(steamId)}`;
}

function delayValue(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithPaceValue<T, R>(
  items: T[],
  concurrency: number,
  paceMs: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let nextStart = Date.now();
  const workers = Math.min(Math.max(1, concurrency), items.length);

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const startAt = nextStart;
      nextStart += paceMs;
      const wait = startAt - Date.now();
      if (wait > 0) await delayValue(wait);
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function fetchOneDrodoProfileValue(
  steamId: string,
  adapter: DrodoBatchAdapter,
  options: FetchDrodoBatchOptions,
  prevSnapshot: PollSnapshot | null,
  fetchImpl: typeof fetch
): Promise<FetchDrodoBatchResult> {
  const pollMode = options.pollMode ?? "reset";
  let payload: unknown;
  try {
    const response = await fetchImpl(drodoCourierProfileUrlValue(steamId));
    if (!response.ok) {
      return upstreamErrorResults([steamId], {
        status: response.status,
        message: "Drodo API error",
      })[0];
    }
    payload = await response.json();
  } catch {
    return upstreamErrorResults([steamId], {
      message: "Failed to reach Drodo API",
    })[0];
  }

  const upstreamError = drodoPayloadErrorValue(payload);
  if (upstreamError) {
    return upstreamErrorResults([steamId], {
      status: 200,
      message: upstreamError,
    })[0];
  }

  const drodoData = drodoPlayerRecordValue(payload, steamId);
  if (!drodoData) {
    const fetchedAt = await adapter.markMissing(steamId);
    return {
      steam_id: steamId,
      ok: false,
      kind: "missing",
      error: "Player not found on Drodo",
      fetchedAt,
    };
  }

  const built = buildDrodoProfileValue(steamId, drodoData);
  const profile = preserveOmittedDrodoFieldsValue(prevSnapshot, built.profile);
  const { seasonRows } = built;
  if (!hasDrodoStatsValue(profile, seasonRows)) {
    const fetchedAt = await adapter.markMissing(steamId);
    return {
      steam_id: steamId,
      ok: false,
      kind: "missing",
      error: EMPTY_DRODO_PROFILE_ERROR_VALUE,
      fetchedAt,
    };
  }

  await adapter.persistProfile(profile, seasonRows, {
    snapshotOnSuccess: options.snapshotOnSuccess,
    pollMode,
    hotPoll: options.hotPoll,
    prevSnapshot,
  });
  return { steam_id: steamId, ok: true, profile, seasonRows };
}

async function fetchDrodoProfileBatchValue(steamIds: unknown[], adapter: DrodoBatchAdapter, options: FetchDrodoBatchOptions = {}): Promise<FetchDrodoBatchResult[]> {
  const ids = normalizeDrodoSteamIdsValue(steamIds);
  if (ids.length === 0) return [];

  // Always load prior cache when available — even on manual "reset" polls —
  // so omitted Drodo fields (season MMR, queen_rank) can be preserved.
  const prevSnapshots = adapter.loadPollSnapshots
    ? await adapter.loadPollSnapshots(ids)
    : new Map();
  const fetchImpl = adapter.fetch ?? fetch;
  const concurrency = options.concurrency ?? DRODO_COURIER_CONCURRENCY_VALUE;
  const paceMs = options.paceMs ?? DRODO_COURIER_PACE_MS_VALUE;

  return mapWithPaceValue(ids, concurrency, paceMs, (steamId) =>
    fetchOneDrodoProfileValue(
      steamId,
      adapter,
      options,
      prevSnapshots.get(steamId) ?? null,
      fetchImpl
    )
  );
}

function summarizeDrodoResultsValue(results: FetchDrodoBatchResult[]): DrodoResultsSummary {
  return results.reduce(
    (summary: DrodoResultsSummary, result: FetchDrodoBatchResult) => {
      if (result.ok) {
        summary.ok += 1;
      } else if ("kind" in result && result.kind === "missing") {
        summary.missing += 1;
      } else if ("kind" in result && result.kind === "upstream_error") {
        summary.upstream_error += 1;
      }
      return summary;
    },
    { ok: 0, missing: 0, upstream_error: 0 },
  );
}

export const DRODO_BASE: string = DRODO_BASE_VALUE;
export const DRODO_COURIER_CONCURRENCY: number = DRODO_COURIER_CONCURRENCY_VALUE;
export const DRODO_COURIER_PACE_MS: number = DRODO_COURIER_PACE_MS_VALUE;
export const DRODO_MMR_ENABLED: boolean = DRODO_MMR_ENABLED_VALUE;
export const DRODO_BACKGROUND_POLL_ENABLED: boolean =
  DRODO_BACKGROUND_POLL_ENABLED_VALUE;

export const DRODO_FRESH_TTL_MS: number = DRODO_FRESH_TTL_MS_VALUE;
export const DRODO_MISSING_TTL_MS: number = DRODO_MISSING_TTL_MS_VALUE;
export const EMPTY_DRODO_PROFILE_ERROR: string = EMPTY_DRODO_PROFILE_ERROR_VALUE;

export const POLL_ACTIVE_INTERVAL_SECONDS: number =
  POLL_ACTIVE_INTERVAL_SECONDS_VALUE;
export const POLL_INACTIVE_INTERVAL_SECONDS: number =
  POLL_INACTIVE_INTERVAL_SECONDS_VALUE;
export const POLL_MIN_INTERVAL_SECONDS: number = POLL_MIN_INTERVAL_SECONDS_VALUE;
export const POLL_MAX_INTERVAL_SECONDS: number = POLL_MAX_INTERVAL_SECONDS_VALUE;
export const POLL_BACKOFF_FACTOR: number = POLL_BACKOFF_FACTOR_VALUE;
export const HOT_POLL_MAX_INTERVAL_SECONDS: number = HOT_POLL_MAX_INTERVAL_SECONDS_VALUE;
export const ACTIVE_SIGN_IN_WINDOW_MS: number = ACTIVE_SIGN_IN_WINDOW_MS_VALUE;
export const QUEENS_REFRESH_COOLDOWN_MS: number =
  QUEENS_REFRESH_COOLDOWN_MS_VALUE;
export const QUEENS_VIEW_REFRESH_COOLDOWN_MS: number =
  QUEENS_VIEW_REFRESH_COOLDOWN_MS_VALUE;

export interface SeasonSnapshotRow {
  steam_id: string;
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
  chicken_count: number | null;
  queen_rank?: number | null;
  peak_queen_rank?: number | null;
  fetched_at: string;
}

export interface DrodoProfileRow {
  steam_id: string;
  mmr: number | null;
  max_mmr: number | null;
  mmr_level: number | null;
  queen_rank: number | null;
  last_win_at: string | number | null;
  last_top3_at: string | number | null;
  season: string | null;
  season_games: number | null;
  candy: number | null;
  chicken_count: number;
  raw_data: Record<string, unknown>;
  fetched_at: string;
}

export interface PollSchedule {
  next_poll_at: string;
  poll_interval_seconds: number;
}

export interface PollSnapshot {
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
  queen_rank: number | null;
  queen_ladder_last_seen_at: string | null;
  poll_interval_seconds: number | null;
}

export interface PollSnapshotRow extends Omit<PollSnapshot, "queen_rank"> {
  steam_id?: string;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
  queen_ladder_rank?: number | null;
  queen_ladder_last_seen_at: string | null;
  poll_interval_seconds: number | null;
}

export type DrodoUserPayload = {
  steam_id: string;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_candy: number | null;
  drodo_chicken_count: number;
  drodo_raw_data: Record<string, unknown>;
  drodo_last_fetched_at: string;
  drodo_profile_missing: false;
};

export type FetchDrodoResult =
  | {
      ok: true;
      profile: DrodoProfileRow;
      seasonRows: SeasonSnapshotRow[];
    }
  | {
      ok: false;
      kind: "upstream_error" | "missing";
      status?: number;
      error: string;
      fetchedAt?: string;
    };

export type FetchDrodoBatchResult = FetchDrodoResult & { steam_id: string };

export interface FetchDrodoBatchOptions {
  snapshotOnSuccess?: boolean;
  pollMode?: "adaptive" | "reset";
  hotPoll?: boolean;
  /** In-flight single-ID courier calls. Defaults to `DRODO_COURIER_CONCURRENCY`. */
  concurrency?: number;
  /** Minimum gap between courier call starts, in milliseconds. */
  paceMs?: number;
}

export interface DrodoPersistProfileOptions {
  snapshotOnSuccess?: boolean;
  pollMode: "adaptive" | "reset";
  hotPoll?: boolean;
  prevSnapshot?: PollSnapshot | null;
}

export interface DrodoBatchAdapter {
  fetch?: typeof fetch;
  loadPollSnapshots?: (steamIds: string[]) => Promise<Map<string, PollSnapshot>>;
  markMissing: (steamId: string) => Promise<string>;
  persistProfile: (
    profile: DrodoProfileRow,
    seasonRows: SeasonSnapshotRow[],
    options: DrodoPersistProfileOptions
  ) => Promise<void>;
}

export interface DrodoResultsSummary {
  ok: number;
  missing: number;
  upstream_error: number;
}

export const currentSeason: (data: Record<string, unknown>) => string | null =
  currentSeasonValue;

export const extractAllSeasons: (
  steamId: string,
  data: Record<string, unknown>,
  currentSeasonKey: string | null
) => SeasonSnapshotRow[] = extractAllSeasonsValue;

export const numberFromDrodoData: (
  data: Record<string, unknown>,
  key: string
) => number | null = numberFromDrodoDataValue;

export const valueFromDrodoData: (
  data: Record<string, unknown>,
  keys: string[]
) => string | number | null = valueFromDrodoDataValue;

export const lastWinFromDrodoData: (
  data: Record<string, unknown>
) => string | number | null = lastWinFromDrodoDataValue;

export const lastTop3FromDrodoData: (
  data: Record<string, unknown>
) => string | number | null = lastTop3FromDrodoDataValue;

export const buildDrodoProfile: (
  steamId: string,
  drodoData: Record<string, unknown>
) => {
  profile: DrodoProfileRow;
  seasonRows: SeasonSnapshotRow[];
} = buildDrodoProfileValue;

export const hasDrodoStats: (
  profile: Pick<
    DrodoProfileRow,
    "mmr" | "max_mmr" | "season_games" | "chicken_count"
  >,
  seasonRows: Array<
    Pick<SeasonSnapshotRow, "mmr" | "max_mmr" | "games_played">
  >
) => boolean = hasDrodoStatsValue;

export const drodoProfileToUserPayload: (
  profile: DrodoProfileRow
) => DrodoUserPayload = drodoProfileToUserPayloadValue as (
  profile: DrodoProfileRow
) => DrodoUserPayload;

export const clampInterval: (seconds: number, max?: number) => number =
  clampIntervalValue;

export const recentSignInCutoff: (now?: Date) => string =
  recentSignInCutoffValue;

export const activePollOrFilter: (cutoffIso: string) => string =
  activePollOrFilterValue;

export const isActivePollUser: (
  user:
    | {
        steam_signed_in_at?: string | null;
        queen_ladder_rank?: number | null;
      }
    | null
    | undefined,
  cutoffIso: string
) => boolean = isActivePollUserValue;

export const inactivePollCutoff: (now?: Date) => string =
  inactivePollCutoffValue;

export const nextPollSchedule: (input: {
  mode: "reset" | "adaptive";
  changed: boolean;
  prevIntervalSeconds: number | null;
  missing?: boolean;
  hot?: boolean;
  fixedHot?: boolean;
}) => PollSchedule = nextPollScheduleValue;

export const pollSnapshotFromRow: (row: PollSnapshotRow) => PollSnapshot =
  pollSnapshotFromRowValue;

export const preserveOmittedDrodoFields: (
  prev: DrodoProfileRow | PollSnapshot | null | undefined,
  next: DrodoProfileRow
) => DrodoProfileRow = preserveOmittedDrodoFieldsValue;

export const isQueenProfile: (
  profile: DrodoProfileRow,
  prev: PollSnapshot | null | undefined
) => boolean = isQueenProfileValue;

export const profileChanged: (
  prev: PollSnapshot | null,
  next: DrodoProfileRow
) => boolean = profileChangedValue;

export const normalizeDrodoSteamIds: (steamIds: unknown[]) => string[] =
  normalizeDrodoSteamIdsValue;

export const fetchDrodoProfileBatch: (
  steamIds: string[],
  adapter: DrodoBatchAdapter,
  options?: FetchDrodoBatchOptions
) => Promise<FetchDrodoBatchResult[]> = fetchDrodoProfileBatchValue;

export const summarizeDrodoResults: (
  results: FetchDrodoBatchResult[]
) => DrodoResultsSummary = summarizeDrodoResultsValue;
