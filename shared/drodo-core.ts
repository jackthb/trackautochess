import {
  DRODO_BASE as DRODO_BASE_VALUE,
  DRODO_COURIER_BATCH_SIZE as DRODO_COURIER_BATCH_SIZE_VALUE,
  DRODO_FRESH_TTL_MS as DRODO_FRESH_TTL_MS_VALUE,
  DRODO_MISSING_TTL_MS as DRODO_MISSING_TTL_MS_VALUE,
  EMPTY_DRODO_PROFILE_ERROR as EMPTY_DRODO_PROFILE_ERROR_VALUE,
  HOT_POLL_BACKOFF_FACTOR as HOT_POLL_BACKOFF_FACTOR_VALUE,
  HOT_POLL_MAX_INTERVAL_SECONDS as HOT_POLL_MAX_INTERVAL_SECONDS_VALUE,
  POLL_BACKOFF_FACTOR as POLL_BACKOFF_FACTOR_VALUE,
  POLL_MAX_INTERVAL_SECONDS as POLL_MAX_INTERVAL_SECONDS_VALUE,
  POLL_MIN_INTERVAL_SECONDS as POLL_MIN_INTERVAL_SECONDS_VALUE,
  buildDrodoProfile as buildDrodoProfileValue,
  clampInterval as clampIntervalValue,
  currentSeason as currentSeasonValue,
  drodoProfileToUserPayload as drodoProfileToUserPayloadValue,
  extractAllSeasons as extractAllSeasonsValue,
  fetchDrodoProfileBatch as fetchDrodoProfileBatchValue,
  hasDrodoStats as hasDrodoStatsValue,
  isQueenProfile as isQueenProfileValue,
  lastTop3FromDrodoData as lastTop3FromDrodoDataValue,
  lastWinFromDrodoData as lastWinFromDrodoDataValue,
  nextPollSchedule as nextPollScheduleValue,
  normalizeDrodoSteamIds as normalizeDrodoSteamIdsValue,
  numberFromDrodoData as numberFromDrodoDataValue,
  pollSnapshotFromRow as pollSnapshotFromRowValue,
  profileChanged as profileChangedValue,
  summarizeDrodoResults as summarizeDrodoResultsValue,
  valueFromDrodoData as valueFromDrodoDataValue,
} from "./drodo-core.mjs";

export const DRODO_BASE: string = DRODO_BASE_VALUE;
export const DRODO_COURIER_BATCH_SIZE: number = DRODO_COURIER_BATCH_SIZE_VALUE;

export const DRODO_FRESH_TTL_MS: number = DRODO_FRESH_TTL_MS_VALUE;
export const DRODO_MISSING_TTL_MS: number = DRODO_MISSING_TTL_MS_VALUE;
export const EMPTY_DRODO_PROFILE_ERROR: string = EMPTY_DRODO_PROFILE_ERROR_VALUE;

export const POLL_MIN_INTERVAL_SECONDS: number = POLL_MIN_INTERVAL_SECONDS_VALUE;
export const POLL_MAX_INTERVAL_SECONDS: number = POLL_MAX_INTERVAL_SECONDS_VALUE;
export const POLL_BACKOFF_FACTOR: number = POLL_BACKOFF_FACTOR_VALUE;
export const HOT_POLL_MAX_INTERVAL_SECONDS: number = HOT_POLL_MAX_INTERVAL_SECONDS_VALUE;
export const HOT_POLL_BACKOFF_FACTOR: number = HOT_POLL_BACKOFF_FACTOR_VALUE;

export interface SeasonSnapshotRow {
  steam_id: string;
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
  chicken_count: number | null;
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
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
  queen_rank: number | null;
  queen_ladder_last_seen_at: string | null;
  poll_interval_seconds: number | null;
}

export interface PollSnapshotRow extends PollSnapshot {
  steam_id?: string;
  drodo_raw_data: Record<string, unknown> | null;
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

export const nextPollSchedule: (input: {
  mode: "reset" | "adaptive";
  changed: boolean;
  prevIntervalSeconds: number | null;
  missing?: boolean;
  hot?: boolean;
}) => PollSchedule = nextPollScheduleValue;

export const pollSnapshotFromRow: (row: PollSnapshotRow) => PollSnapshot =
  pollSnapshotFromRowValue;

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
