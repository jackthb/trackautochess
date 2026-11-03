// Generated from shared/drodo-core.ts. Do not edit by hand.
const DRODO_BASE_VALUE = "http://autochess.ppbizon.com";
const DRODO_COURIER_CONCURRENCY_VALUE = 4;
const DRODO_COURIER_PACE_MS_VALUE = 250;
const DRODO_MMR_ENABLED_VALUE = true;
const DRODO_BACKGROUND_POLL_ENABLED_VALUE = true;
const DRODO_FRESH_TTL_MS_VALUE = 24 * 60 * 60 * 1000;
const DRODO_MISSING_TTL_MS_VALUE = 7 * 24 * 60 * 60 * 1000;
const EMPTY_DRODO_PROFILE_ERROR_VALUE = "Steam account has no Dota Auto Chess MMR or stats.";
const POLL_ACTIVE_INTERVAL_SECONDS_VALUE = 24 * 60 * 60;
const POLL_INACTIVE_INTERVAL_SECONDS_VALUE = 7 * 24 * 60 * 60;
const POLL_MIN_INTERVAL_SECONDS_VALUE = POLL_ACTIVE_INTERVAL_SECONDS_VALUE;
const POLL_MAX_INTERVAL_SECONDS_VALUE = POLL_INACTIVE_INTERVAL_SECONDS_VALUE;
const POLL_BACKOFF_FACTOR_VALUE = 1.5;
const HOT_POLL_MAX_INTERVAL_SECONDS_VALUE = POLL_ACTIVE_INTERVAL_SECONDS_VALUE;
const ACTIVE_SIGN_IN_WINDOW_MS_VALUE = 14 * 24 * 60 * 60 * 1000;
const QUEENS_REFRESH_COOLDOWN_MS_VALUE = 5 * 60 * 1000;
const QUEENS_VIEW_REFRESH_COOLDOWN_MS_VALUE = QUEENS_REFRESH_COOLDOWN_MS_VALUE;
const SEASON_FIELD_KEY_VALUE = /^(?:mmr|max_mmr|match)_s(\d+)$/;
function recentSignInCutoffValue(now = new Date()) {
    return new Date(now.getTime() - ACTIVE_SIGN_IN_WINDOW_MS_VALUE).toISOString();
}
function activePollOrFilterValue(cutoffIso) {
    return `steam_signed_in_at.gte.${cutoffIso}`;
}
function isActivePollUserValue(user, cutoffIso) {
    if (!user)
        return false;
    return user.steam_signed_in_at != null && user.steam_signed_in_at >= cutoffIso;
}
function inactivePollCutoffValue(now = new Date()) {
    return new Date(now.getTime() - POLL_INACTIVE_INTERVAL_SECONDS_VALUE * 1000).toISOString();
}
function steamIdValue(steamId) {
    return String(steamId);
}
function seasonNumbersValue(data) {
    const seasons = new Set();
    for (const key of Object.keys(data)) {
        const match = key.match(SEASON_FIELD_KEY_VALUE);
        if (!match)
            continue;
        const n = parseInt(match[1], 10);
        if (Number.isFinite(n) && n > 0)
            seasons.add(n);
    }
    return [...seasons].sort((a, b) => a - b);
}
function currentSeasonValue(data) {
    const latest = seasonNumbersValue(data).at(-1);
    return latest ? `s${latest}` : null;
}
function extractAllSeasonsValue(steamId, data, currentSeasonKey) {
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
            chicken_count: seasonKey === currentSeasonKey
                ? positiveNumberFromDrodoDataValue(data, "chicken_count")
                : null,
            fetched_at: now,
        });
    }
    return seasons.sort((a, b) => Number(a.season.slice(1)) - Number(b.season.slice(1)));
}
function numberFromDrodoDataValue(data, key) {
    if (!data)
        return null;
    const value = data[key];
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function positiveNumberFromDrodoDataValue(data, key) {
    const value = numberFromDrodoDataValue(data, key);
    return value !== null && value > 0 ? value : null;
}
function queenRankFromDrodoDataValue(data) {
    const value = numberFromDrodoDataValue(data, "queen_rank");
    if (value === null || value <= 0)
        return null;
    return value;
}
function drodoQueenRankExplicitValue(data) {
    return !!data && Object.prototype.hasOwnProperty.call(data, "queen_rank");
}
function valueFromDrodoDataValue(data, keys) {
    if (!data)
        return null;
    for (const key of keys) {
        const value = data[key];
        if (typeof value === "string" && value.trim())
            return value;
        if (typeof value === "number" && Number.isFinite(value))
            return value;
    }
    return null;
}
function lastWinFromDrodoDataValue(data) {
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
function lastTop3FromDrodoDataValue(data) {
    return valueFromDrodoDataValue(data, [
        "last_top3_at",
        "last_top3_date",
        "last_top3_time",
        "top3_at",
        "top3_date",
        "top3_time",
    ]);
}
function buildDrodoProfileValue(steamId, drodoData) {
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
function numericField(record, key) {
    if (!record || !(key in record))
        return null;
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function hasPositiveNumericField(record, key) {
    const value = numericField(record, key);
    return value !== null && value > 0;
}
function hasDrodoStatsValue(profile, seasonRows = []) {
    if (!profile)
        return false;
    if (hasPositiveNumericField(profile, "mmr") ||
        hasPositiveNumericField(profile, "max_mmr") ||
        hasPositiveNumericField(profile, "season_games") ||
        hasPositiveNumericField(profile, "chicken_count")) {
        return true;
    }
    if (hasPositiveNumericField(profile, "mmr_level") ||
        hasPositiveNumericField(profile, "queen_rank")) {
        return true;
    }
    if (seasonRows.length > 0)
        return true;
    return false;
}
function drodoProfileToUserPayloadValue(profile) {
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
function clampIntervalValue(seconds, max = POLL_MAX_INTERVAL_SECONDS_VALUE) {
    if (!Number.isFinite(seconds) || seconds < POLL_MIN_INTERVAL_SECONDS_VALUE) {
        return POLL_MIN_INTERVAL_SECONDS_VALUE;
    }
    if (seconds > max)
        return max;
    return Math.round(seconds);
}
function nextPollScheduleValue({ mode, changed, prevIntervalSeconds, missing = false, hot = false, fixedHot = false }, now = new Date()) {
    const maxInterval = hot || fixedHot ? HOT_POLL_MAX_INTERVAL_SECONDS_VALUE : POLL_MAX_INTERVAL_SECONDS_VALUE;
    let intervalSeconds;
    if (missing) {
        intervalSeconds = maxInterval;
    }
    else if (fixedHot) {
        intervalSeconds = maxInterval;
    }
    else if (mode === "reset" || changed) {
        intervalSeconds = POLL_MIN_INTERVAL_SECONDS_VALUE;
    }
    else {
        const prev = prevIntervalSeconds ?? POLL_MIN_INTERVAL_SECONDS_VALUE;
        intervalSeconds = clampIntervalValue(prev * POLL_BACKOFF_FACTOR_VALUE, maxInterval);
    }
    intervalSeconds = clampIntervalValue(intervalSeconds, maxInterval);
    return {
        next_poll_at: new Date(Date.now() + intervalSeconds * 1000).toISOString(),
        poll_interval_seconds: intervalSeconds,
    };
}
function pollSnapshotFromRowValue(row) {
    return {
        drodo_mmr: row.drodo_mmr,
        drodo_max_mmr: row.drodo_max_mmr ?? null,
        drodo_mmr_level: row.drodo_mmr_level ?? null,
        drodo_season: row.drodo_season ?? null,
        drodo_season_games: row.drodo_season_games,
        drodo_chicken_count: row.drodo_chicken_count,
        queen_rank: typeof row.queen_ladder_rank === "number" &&
            Number.isFinite(row.queen_ladder_rank) &&
            row.queen_ladder_rank > 0
            ? row.queen_ladder_rank
            : null,
        queen_ladder_last_seen_at: row.queen_ladder_last_seen_at,
        poll_interval_seconds: row.poll_interval_seconds,
    };
}
function preserveOmittedDrodoFieldsValue(prev, next) {
    if (!prev)
        return next;
    const prevMmr = profileMetricValue(prev, "drodo_mmr", "mmr");
    const prevMaxMmr = profileMetricValue(prev, "drodo_max_mmr", "max_mmr");
    const prevSeasonGames = profileMetricValue(prev, "drodo_season_games", "season_games");
    const prevMmrLevel = profileMetricValue(prev, "drodo_mmr_level", "mmr_level");
    const prevQueenRank = profileMetricValue(prev, "queen_rank", "queen_rank");
    const prevSeason = "drodo_season" in prev
        ? (prev.drodo_season ?? null)
        : (prev.season ?? null);
    return {
        ...next,
        mmr: next.mmr ?? prevMmr,
        max_mmr: next.max_mmr ?? prevMaxMmr,
        mmr_level: next.mmr_level ?? prevMmrLevel,
        season: next.season ?? prevSeason,
        season_games: next.season_games ?? prevSeasonGames,
        queen_rank: drodoQueenRankExplicitValue(next.raw_data)
            ? next.queen_rank
            : (next.queen_rank ?? prevQueenRank),
    };
}
function countedQueenRankValue(record) {
    const value = numericField(record, "queen_rank");
    return value !== null && value > 0;
}
function isQueenProfileValue(profile, prev = null) {
    const lastSeen = profile && "queen_ladder_last_seen_at" in profile
        ? profile.queen_ladder_last_seen_at
        : null;
    return countedQueenRankValue(profile) || countedQueenRankValue(prev) || Boolean(lastSeen);
}
function profileMetricValue(profile, snapshotKey, rowKey) {
    if (!profile)
        return null;
    if (snapshotKey in profile) {
        const value = profile[snapshotKey];
        return typeof value === "number" ? value : null;
    }
    const value = profile[rowKey];
    return typeof value === "number" ? value : null;
}
function profileChangedValue(prev, next) {
    if (!prev || !next)
        return true;
    return (profileMetricValue(prev, "drodo_mmr", "mmr") !== profileMetricValue(next, "drodo_mmr", "mmr") ||
        profileMetricValue(prev, "drodo_season_games", "season_games") !== profileMetricValue(next, "drodo_season_games", "season_games") ||
        profileMetricValue(prev, "drodo_chicken_count", "chicken_count") !== profileMetricValue(next, "drodo_chicken_count", "chicken_count") ||
        profileMetricValue(prev, "queen_rank", "queen_rank") !== profileMetricValue(next, "queen_rank", "queen_rank"));
}
function normalizeDrodoSteamIdsValue(steamIds) {
    return [
        ...new Set(steamIds
            .filter((steamId) => steamId != null)
            .map(String)
            .filter(Boolean)),
    ];
}
function upstreamErrorResults(ids, error = {}) {
    const message = typeof error.message === "string" ? error.message : "Drodo API error";
    const status = typeof error.status === "number" ? error.status : undefined;
    return ids.map((steamId) => ({
        steam_id: steamId,
        ok: false,
        kind: "upstream_error",
        status,
        error: message,
    }));
}
function isDrodoRecordValue(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function drodoPayloadErrorValue(payload) {
    if (!isDrodoRecordValue(payload))
        return "Drodo API error";
    const err = payload.err;
    const code = typeof err === "number" ? err : typeof err === "string" ? Number(err) : Number.NaN;
    if (code === 0)
        return null;
    const detail = typeof payload.err_msg === "string" && payload.err_msg.trim()
        ? payload.err_msg
        : typeof payload.msg === "string" && payload.msg.trim()
            ? payload.msg
            : "Drodo API error";
    return Number.isFinite(code) ? `Drodo API error ${code}: ${detail}` : detail;
}
function drodoPlayerRecordValue(payload, steamId) {
    if (!isDrodoRecordValue(payload))
        return null;
    const userInfo = payload.user_info;
    if (!isDrodoRecordValue(userInfo))
        return null;
    const keyed = userInfo[steamId];
    if (isDrodoRecordValue(keyed))
        return keyed;
    if (userInfo.steam_id != null && String(userInfo.steam_id) !== steamId)
        return null;
    if (userInfo.steam_id != null ||
        "mmr_level" in userInfo ||
        seasonNumbersValue(userInfo).length > 0) {
        return userInfo;
    }
    return null;
}
function drodoCourierProfileUrlValue(steamId) {
    return `${DRODO_BASE_VALUE}/courier/get/@${encodeURIComponent(steamId)}`;
}
function delayValue(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function mapWithPaceValue(items, concurrency, paceMs, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let nextStart = Date.now();
    const workers = Math.min(Math.max(1, concurrency), items.length);
    async function worker() {
        for (;;) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length)
                return;
            const startAt = nextStart;
            nextStart += paceMs;
            const wait = startAt - Date.now();
            if (wait > 0)
                await delayValue(wait);
            results[index] = await fn(items[index]);
        }
    }
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return results;
}
async function fetchOneDrodoProfileValue(steamId, adapter, options, prevSnapshot, fetchImpl) {
    const pollMode = options.pollMode ?? "reset";
    let payload;
    try {
        const response = await fetchImpl(drodoCourierProfileUrlValue(steamId));
        if (!response.ok) {
            return upstreamErrorResults([steamId], {
                status: response.status,
                message: "Drodo API error",
            })[0];
        }
        payload = await response.json();
    }
    catch {
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
async function fetchDrodoProfileBatchValue(steamIds, adapter, options = {}) {
    const ids = normalizeDrodoSteamIdsValue(steamIds);
    if (ids.length === 0)
        return [];
    const prevSnapshots = adapter.loadPollSnapshots
        ? await adapter.loadPollSnapshots(ids)
        : new Map();
    const fetchImpl = adapter.fetch ?? fetch;
    const concurrency = options.concurrency ?? DRODO_COURIER_CONCURRENCY_VALUE;
    const paceMs = options.paceMs ?? DRODO_COURIER_PACE_MS_VALUE;
    return mapWithPaceValue(ids, concurrency, paceMs, (steamId) => fetchOneDrodoProfileValue(steamId, adapter, options, prevSnapshots.get(steamId) ?? null, fetchImpl));
}
function summarizeDrodoResultsValue(results) {
    return results.reduce((summary, result) => {
        if (result.ok) {
            summary.ok += 1;
        }
        else if ("kind" in result && result.kind === "missing") {
            summary.missing += 1;
        }
        else if ("kind" in result && result.kind === "upstream_error") {
            summary.upstream_error += 1;
        }
        return summary;
    }, { ok: 0, missing: 0, upstream_error: 0 });
}
export const DRODO_BASE = DRODO_BASE_VALUE;
export const DRODO_COURIER_CONCURRENCY = DRODO_COURIER_CONCURRENCY_VALUE;
export const DRODO_COURIER_PACE_MS = DRODO_COURIER_PACE_MS_VALUE;
export const DRODO_MMR_ENABLED = DRODO_MMR_ENABLED_VALUE;
export const DRODO_BACKGROUND_POLL_ENABLED = DRODO_BACKGROUND_POLL_ENABLED_VALUE;
export const DRODO_FRESH_TTL_MS = DRODO_FRESH_TTL_MS_VALUE;
export const DRODO_MISSING_TTL_MS = DRODO_MISSING_TTL_MS_VALUE;
export const EMPTY_DRODO_PROFILE_ERROR = EMPTY_DRODO_PROFILE_ERROR_VALUE;
export const POLL_ACTIVE_INTERVAL_SECONDS = POLL_ACTIVE_INTERVAL_SECONDS_VALUE;
export const POLL_INACTIVE_INTERVAL_SECONDS = POLL_INACTIVE_INTERVAL_SECONDS_VALUE;
export const POLL_MIN_INTERVAL_SECONDS = POLL_MIN_INTERVAL_SECONDS_VALUE;
export const POLL_MAX_INTERVAL_SECONDS = POLL_MAX_INTERVAL_SECONDS_VALUE;
export const POLL_BACKOFF_FACTOR = POLL_BACKOFF_FACTOR_VALUE;
export const HOT_POLL_MAX_INTERVAL_SECONDS = HOT_POLL_MAX_INTERVAL_SECONDS_VALUE;
export const ACTIVE_SIGN_IN_WINDOW_MS = ACTIVE_SIGN_IN_WINDOW_MS_VALUE;
export const QUEENS_REFRESH_COOLDOWN_MS = QUEENS_REFRESH_COOLDOWN_MS_VALUE;
export const QUEENS_VIEW_REFRESH_COOLDOWN_MS = QUEENS_VIEW_REFRESH_COOLDOWN_MS_VALUE;
export const currentSeason = currentSeasonValue;
export const extractAllSeasons = extractAllSeasonsValue;
export const numberFromDrodoData = numberFromDrodoDataValue;
export const valueFromDrodoData = valueFromDrodoDataValue;
export const lastWinFromDrodoData = lastWinFromDrodoDataValue;
export const lastTop3FromDrodoData = lastTop3FromDrodoDataValue;
export const buildDrodoProfile = buildDrodoProfileValue;
export const hasDrodoStats = hasDrodoStatsValue;
export const drodoProfileToUserPayload = drodoProfileToUserPayloadValue;
export const clampInterval = clampIntervalValue;
export const recentSignInCutoff = recentSignInCutoffValue;
export const activePollOrFilter = activePollOrFilterValue;
export const isActivePollUser = isActivePollUserValue;
export const inactivePollCutoff = inactivePollCutoffValue;
export const nextPollSchedule = nextPollScheduleValue;
export const pollSnapshotFromRow = pollSnapshotFromRowValue;
export const preserveOmittedDrodoFields = preserveOmittedDrodoFieldsValue;
export const isQueenProfile = isQueenProfileValue;
export const profileChanged = profileChangedValue;
export const normalizeDrodoSteamIds = normalizeDrodoSteamIdsValue;
export const fetchDrodoProfileBatch = fetchDrodoProfileBatchValue;
export const summarizeDrodoResults = summarizeDrodoResultsValue;
