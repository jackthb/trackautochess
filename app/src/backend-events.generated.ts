// This file is generated from app/backend/src/ipc_events.rs. Do not edit.

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue | undefined } | JsonValue[];

export type BackendStatus = { type: string, backend: string, recording: boolean, focused: boolean, logged_in: boolean, steam_id: string, steam_name: string, replay_enabled: boolean, };

export type BackendCommand = { "cmd": "quit" } | { "cmd": "status" } | { "cmd": "queue_ingest", payload: JsonValue, } | { "cmd": "queue_payload", payload: JsonValue, } | { "cmd": "set_config", key: string, value: JsonValue, } | { "cmd": "steam_logout" } | { "cmd": "steam_login" } | { "cmd": "toggle_recording" } | { "cmd": "nettable_status" } | { "cmd": "nettable_get_state" } | { "cmd": "capture" } | { "cmd": "nettable_apply_launch_options", flags: Array<string> | null, } | { "cmd": "nettable_check_active_match" } | { "cmd": "nettable_resync_from_steam" } | { "cmd": "nettable_set_paused", paused: boolean, } | { "cmd": "nettable_upload_queens" } | { "cmd": "nettable_confirm_match_end" } | { "cmd": "fetch_games", request_id: string, } | { "cmd": "fetch_timeline", request_id: string, match_id: string, } | { "cmd": "update_game", request_id: string, id: number, fields: JsonValue, } | { "cmd": "fetch_drodo", request_id: string, } | { "cmd": "refresh_drodo", request_id: string, } | { "cmd": "upload_logs", reason: string | null, } | { "cmd": "do_update" } | { "cmd": "parse_log", path: string | null, } | { "cmd": "tail_log_once", path: string | null, };

export type Config = { dac_dir: string, steam_id: string, steam_name: string, replay_enabled: boolean,
/**
 * Persist raw CustomNetTable captures locally for logging/debugging and
 * post-hoc reprocessing. Product views should use processed matches,
 * players, and timelines instead of depending on these raw dumps.
 */
keep_local_nettable_dumps: boolean,
/**
 * Upload the same raw captures as private Supabase Storage blobs. This is
 * a logging/reprocessing safety net, not a Postgres table dependency and
 * not the user-facing match data model.
 */
upload_raw_nettable_dumps: boolean, local_only: boolean, supabase_url: string, supabase_key: string, };

export type ErrorEvent = { type: string, message: string, };

export type PayloadQueued = { type: string, path: string, };

export type ConfigUpdated = { type: string, key: string, };

export type GamesList = { type: string, backend: string, request_id: string, games: JsonValue, error: string | null, };

export type MatchTimeline = { type: string, backend: string, request_id: string, timeline: JsonValue, error: string | null, };

export type GameUpdated = { type: string, backend: string, request_id: string, ok: boolean, error: string | null, };

export type DrodoProfile = { type: string, backend: string, request_id: string, profile: JsonValue, error: string | null, };

export type SteamLogout = { type: string, };

export type SteamLoginUrl = { type: string, url: string, };

export type SteamLogin = { type: string, steam_id: string, steam_name: string, };

export type NettablePaused = { type: string, backend: string, paused: boolean, };

export type UpdateApplyRequested = { type: string, backend: string, ok: boolean, };

export type DiagnosticsUploaded = { type: string, backend: string, storage_ok: boolean, reason: string, paths: JsonValue, tracker_bytes: number | null, console_bytes: number | null, console_found: boolean | null, message: string | null, };

export type NettableRoundChanged = { type: string, backend: string, round: number, prev_round: number | null, at: string, };

export type NettableCreepRound = { type: string, backend: string, round: number, at: string, };

export type NettablePersonalGameEnded = { type: string, backend: string, at: string, round: number, rank: number, late_capture: boolean, };

export type NettableRankingScanned = { type: string, backend: string, player_count: number, upserted_count: number, season: string, at: string, };

export type NettableIngestComplete = { type: string, backend: string, rows_written: number, tables: Array<string>, at: string, };

export type NettableRows = { type: string, rows: JsonValue, };

export type NettableTimelineExtracted = { type: string, backend: string, match_id: string, round_count: number, at: string, };

export type NettableEndBoardSaved = { type: string, backend: string, match_id: string, at: string, };

export type NettableIngestError = { type: string, backend: string | null, error: string, at: string | null, };

export type NettableGameEnded = { type: string, backend: string, message: string, match_id: string | null, at: string, };

export type NettableMatchLeftPending = { type: string, backend: string, message: string,
/**
 * RFC3339 time when the held snapshot auto-uploads as-is.
 */
expires_at: string, at: string, };

export type NettableMatchLeftResolved = { type: string, backend: string,
/**
 * "uploaded" | "cancelled" | "nothing_pending"
 */
outcome: string, match_id: string | null, message: string, at: string, };

export type NettableCheckActiveMatch = { type: string, backend: string, ok: boolean, paused: boolean, message: string, command_transport: string | null, at: string, };

export type NettableResyncComplete = { type: string, ok: boolean, noop: boolean, error: string | null, };

export type NettableQueenUploadProgress = { type: string, message: string, at: string, };

export type NettableQueenUploadComplete = { type: string, ok: boolean, player_count: number, upserted_count: number, season: string | null, error: string | null, at: string, };

export type NettableStateEvent = { type: string, backend: string, rows: JsonValue, state: JsonValue, players: JsonValue, local_steam_ids: JsonValue, at: string, };

export type NettableStatus = { type: string, backend: string, ok: boolean, paused: boolean, autoexec_installed: boolean, gsi_cfg_installed: boolean, log_path: string, log_writable: boolean, dota_dir: string, remote_enabled: boolean, launch_options: string | null, has_console: boolean | null, has_condebug: boolean | null, has_conclearlog: boolean | null, has_gamestateintegration: boolean | null, dota_focused: boolean, steam_running: boolean, dota_running: boolean, log_active: boolean, };

export type NettableSetupProgress = { type: string, stage: string, message: string, };

export type NettableLaunchOptionsApplied = { type: string, backend: string, ok: boolean, noop: boolean, before: string, after: string, added: Array<string>, config_path: string, backup_path: string | null, autoexec_path: string, gsi_cfg_path: string | null, };

export type NettableLaunchOptionsError = { type: string, backend: string, ok: boolean, error: string, };

