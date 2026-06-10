export type BackendName = "rust";

export interface BackendStatusEvent {
  type: "status";
  backend: BackendName;
  recording: boolean;
  focused: boolean;
  logged_in: boolean;
  steam_id: string;
  steam_name: string;
  replay_enabled: boolean;
}

export interface BackendErrorEvent {
  type: "error";
  message: string;
}

export interface PayloadQueuedEvent {
  type: "payload_queued";
  path: string;
}

export interface ConfigUpdatedEvent {
  type: "config_updated";
  key: string;
}

export interface SteamLoginUrlEvent {
  type: "steam_login_url";
  url: string;
}

export interface SteamLoginEvent {
  type: "steam_login";
  steam_id: string;
  steam_name: string;
}

export interface SteamLogoutEvent {
  type: "steam_logout";
}

export interface UpdateApplyRequestedEvent {
  type: "update_apply_requested";
  backend: BackendName;
  ok: boolean;
}

export interface DiagnosticsUploadedEvent {
  type: "diagnostics_uploaded";
  backend: BackendName;
  storage_ok: boolean;
  reason: string;
  paths: Record<string, unknown>;
  tracker_bytes?: number;
  console_bytes?: number;
  console_found?: boolean;
  message?: string;
}

export interface NettableRowsEvent {
  type: "nettable_rows";
  rows: Array<{
    table_name?: string;
    key?: string;
    raw?: unknown;
  }>;
}

export interface NettableStateEvent {
  type: "nettable_state";
  backend: BackendName;
  rows: unknown[];
  state: Record<string, unknown>;
  players: Record<string, import("./hooks/useNetTableEvents").LivePlayer>;
  local_steam_ids: string[];
  at: string;
}

export interface NettableStatusEvent {
  type: "nettable_status";
  backend: BackendName;
  ok: boolean;
  paused: boolean;
  autoexec_installed: boolean;
  gsi_cfg_installed: boolean;
  log_path: string;
  log_writable: boolean;
  dota_dir: string;
  remote_enabled: boolean;
  launch_options: string | null;
  has_condebug: boolean | null;
  has_conclearlog: boolean | null;
  has_gamestateintegration: boolean | null;
  steam_running: boolean;
  dota_running: boolean;
  log_active: boolean;
}

export interface NettablePausedEvent {
  type: "nettable_paused";
  backend: BackendName;
  paused: boolean;
}

export interface NettableCheckActiveMatchEvent {
  type: "nettable_check_active_match";
  backend: BackendName;
  ok: boolean;
  paused: boolean;
  message: string;
  at: string;
}

export interface NettableIngestCompleteEvent {
  type: "nettable_ingest_complete";
  backend: BackendName;
  rows_written: number;
  tables: string[];
  at: string;
}

export interface NettableIngestErrorEvent {
  type: "nettable_ingest_error";
  backend?: BackendName;
  error: string;
  at?: string;
}

export interface NettableRoundChangedEvent {
  type: "nettable_round_changed";
  backend: BackendName;
  round: number;
  prev_round: number | null;
  at: string;
}

export interface NettableCreepRoundEvent {
  type: "nettable_creep_round";
  backend: BackendName;
  round: number;
  at: string;
}

export interface NettablePersonalGameEndedEvent {
  type: "nettable_personal_game_ended";
  backend: BackendName;
  at: string;
  round: number;
  rank: number;
  late_capture: boolean;
}

export interface NettableGameEndedEvent {
  type: "nettable_game_ended";
  backend: BackendName;
  message: string;
  match_id?: string;
  at: string;
}

export interface NettableEndBoardSavedEvent {
  type: "nettable_end_board_saved";
  backend: BackendName;
  match_id: string;
  at: string;
}

export interface NettableTimelineExtractedEvent {
  type: "nettable_timeline_extracted";
  backend: BackendName;
  match_id: string;
  round_count: number;
  at: string;
}

export interface NettableRankingScannedEvent {
  type: "nettable_ranking_scanned";
  backend: BackendName;
  player_count: number;
  upserted_count: number;
  season: string;
  at: string;
}

export interface NettableQueenUploadProgressEvent {
  type: "nettable_queen_upload_progress";
  message: string;
  at: string;
}

export interface NettableQueenUploadCompleteEvent {
  type: "nettable_queen_upload_complete";
  ok: boolean;
  player_count: number;
  upserted_count: number;
  season?: string;
  error: string | null;
  at: string;
}

export interface NettableResyncCompleteEvent {
  type: "nettable_resync_complete";
  ok: boolean;
  noop: boolean;
  error?: string;
}

export interface NettableSetupProgressEvent {
  type: "nettable_launch_options_progress" | "nettable_resync_progress";
  stage: string;
  message: string;
}

export interface NettableLaunchOptionsAppliedEvent {
  type: "nettable_launch_options_applied";
  backend: BackendName;
  ok: boolean;
  noop?: boolean;
  before?: string;
  after?: string;
  added?: string[];
  config_path?: string;
  backup_path?: string | null;
  autoexec_path?: string;
  gsi_cfg_path?: string | null;
  error?: string;
}

export type BackendEvent =
  | BackendStatusEvent
  | BackendErrorEvent
  | PayloadQueuedEvent
  | ConfigUpdatedEvent
  | SteamLoginUrlEvent
  | SteamLoginEvent
  | SteamLogoutEvent
  | UpdateApplyRequestedEvent
  | DiagnosticsUploadedEvent
  | NettableRowsEvent
  | NettableStateEvent
  | NettableStatusEvent
  | NettablePausedEvent
  | NettableCheckActiveMatchEvent
  | NettableIngestCompleteEvent
  | NettableIngestErrorEvent
  | NettableRoundChangedEvent
  | NettableCreepRoundEvent
  | NettablePersonalGameEndedEvent
  | NettableGameEndedEvent
  | NettableEndBoardSavedEvent
  | NettableTimelineExtractedEvent
  | NettableRankingScannedEvent
  | NettableQueenUploadProgressEvent
  | NettableQueenUploadCompleteEvent
  | NettableResyncCompleteEvent
  | NettableSetupProgressEvent
  | NettableLaunchOptionsAppliedEvent;
