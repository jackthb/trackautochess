// Generated from shared/drodo-core.ts. Do not edit by hand.
export declare const DRODO_BASE: string;
export declare const DRODO_COURIER_BATCH_SIZE: number;
export declare const DRODO_FRESH_TTL_MS: number;
export declare const DRODO_MISSING_TTL_MS: number;
export declare const EMPTY_DRODO_PROFILE_ERROR: string;
export declare const POLL_ACTIVE_INTERVAL_SECONDS: number;
export declare const POLL_INACTIVE_INTERVAL_SECONDS: number;
export declare const POLL_MIN_INTERVAL_SECONDS: number;
export declare const POLL_MAX_INTERVAL_SECONDS: number;
export declare const POLL_BACKOFF_FACTOR: number;
export declare const HOT_POLL_MAX_INTERVAL_SECONDS: number;
export declare const ACTIVE_SIGN_IN_WINDOW_MS: number;
export declare const QUEENS_REFRESH_COOLDOWN_MS: number;
export declare const QUEENS_VIEW_REFRESH_COOLDOWN_MS: number;
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
export interface PollSnapshotRow extends Omit<PollSnapshot, "queen_rank"> {
    steam_id?: string;
    drodo_mmr: number | null;
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
export type FetchDrodoResult = {
    ok: true;
    profile: DrodoProfileRow;
    seasonRows: SeasonSnapshotRow[];
} | {
    ok: false;
    kind: "upstream_error" | "missing";
    status?: number;
    error: string;
    fetchedAt?: string;
};
export type FetchDrodoBatchResult = FetchDrodoResult & {
    steam_id: string;
};
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
    persistProfile: (profile: DrodoProfileRow, seasonRows: SeasonSnapshotRow[], options: DrodoPersistProfileOptions) => Promise<void>;
}
export interface DrodoResultsSummary {
    ok: number;
    missing: number;
    upstream_error: number;
}
export declare const currentSeason: (data: Record<string, unknown>) => string | null;
export declare const extractAllSeasons: (steamId: string, data: Record<string, unknown>, currentSeasonKey: string | null) => SeasonSnapshotRow[];
export declare const numberFromDrodoData: (data: Record<string, unknown>, key: string) => number | null;
export declare const valueFromDrodoData: (data: Record<string, unknown>, keys: string[]) => string | number | null;
export declare const lastWinFromDrodoData: (data: Record<string, unknown>) => string | number | null;
export declare const lastTop3FromDrodoData: (data: Record<string, unknown>) => string | number | null;
export declare const buildDrodoProfile: (steamId: string, drodoData: Record<string, unknown>) => {
    profile: DrodoProfileRow;
    seasonRows: SeasonSnapshotRow[];
};
export declare const hasDrodoStats: (profile: Pick<DrodoProfileRow, "mmr" | "max_mmr" | "season_games" | "chicken_count">, seasonRows: Array<Pick<SeasonSnapshotRow, "mmr" | "max_mmr" | "games_played">>) => boolean;
export declare const drodoProfileToUserPayload: (profile: DrodoProfileRow) => DrodoUserPayload;
export declare const clampInterval: (seconds: number, max?: number) => number;
export declare const recentSignInCutoff: (now?: Date) => string;
export declare const activePollOrFilter: (cutoffIso: string) => string;
export declare const isActivePollUser: (user: {
    steam_signed_in_at?: string | null;
    queen_ladder_rank?: number | null;
} | null | undefined, cutoffIso: string) => boolean;
export declare const inactivePollCutoff: (now?: Date) => string;
export declare const nextPollSchedule: (input: {
    mode: "reset" | "adaptive";
    changed: boolean;
    prevIntervalSeconds: number | null;
    missing?: boolean;
    hot?: boolean;
    fixedHot?: boolean;
}) => PollSchedule;
export declare const pollSnapshotFromRow: (row: PollSnapshotRow) => PollSnapshot;
export declare const isQueenProfile: (profile: DrodoProfileRow, prev: PollSnapshot | null | undefined) => boolean;
export declare const profileChanged: (prev: PollSnapshot | null, next: DrodoProfileRow) => boolean;
export declare const normalizeDrodoSteamIds: (steamIds: unknown[]) => string[];
export declare const fetchDrodoProfileBatch: (steamIds: string[], adapter: DrodoBatchAdapter, options?: FetchDrodoBatchOptions) => Promise<FetchDrodoBatchResult[]>;
export declare const summarizeDrodoResults: (results: FetchDrodoBatchResult[]) => DrodoResultsSummary;
