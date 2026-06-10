// This file is generated from app/backend/src/ipc_events.rs. Do not edit.

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue | undefined } | JsonValue[];

export type BackendStatus = { type: string, backend: string, recording: boolean, focused: boolean, logged_in: boolean, steam_id: string, steam_name: string, replay_enabled: boolean, };

export type ErrorEvent = { type: string, message: string, };

export type PayloadQueued = { type: string, path: string, };

export type ConfigUpdated = { type: string, key: string, };

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

export type NettableCheckActiveMatch = { type: string, backend: string, ok: boolean, paused: boolean, message: string, at: string, };

export type NettableResyncComplete = { type: string, ok: boolean, noop: boolean, error: string | null, };

export type NettableQueenUploadProgress = { type: string, message: string, at: string, };

export type NettableQueenUploadComplete = { type: string, ok: boolean, player_count: number, upserted_count: number, season: string | null, error: string | null, at: string, };

export type NettableStateEvent = { type: string, backend: string, rows: JsonValue, state: JsonValue, players: JsonValue, local_steam_ids: JsonValue, at: string, };

export type NettableStatus = { type: string, backend: string, ok: boolean, paused: boolean, autoexec_installed: boolean, gsi_cfg_installed: boolean, log_path: string, log_writable: boolean, dota_dir: string, remote_enabled: boolean, launch_options: string | null, has_condebug: boolean | null, has_conclearlog: boolean | null, has_gamestateintegration: boolean | null, steam_running: boolean, dota_running: boolean, log_active: boolean, };

export type NettableSetupProgress = { type: string, stage: string, message: string, };

export type NettableLaunchOptionsApplied = { type: string, backend: string, ok: boolean, noop: boolean, before: string, after: string, added: Array<string>, config_path: string, backup_path: string | null, autoexec_path: string, gsi_cfg_path: string | null, };

export type NettableLaunchOptionsError = { type: string, backend: string, ok: boolean, error: string, };

