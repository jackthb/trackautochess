import type {
  BackendStatus as GeneratedBackendStatus,
  ConfigUpdated as GeneratedConfigUpdated,
  DiagnosticsUploaded as GeneratedDiagnosticsUploaded,
  DrodoProfile as GeneratedDrodoProfile,
  ErrorEvent as GeneratedErrorEvent,
  GameUpdated as GeneratedGameUpdated,
  GamesList as GeneratedGamesList,
  MatchTimeline as GeneratedMatchTimeline,
  NettableCheckActiveMatch as GeneratedNettableCheckActiveMatch,
  NettableCreepRound as GeneratedNettableCreepRound,
  NettableEndBoardSaved as GeneratedNettableEndBoardSaved,
  NettableGameEnded as GeneratedNettableGameEnded,
  NettableIngestComplete as GeneratedNettableIngestComplete,
  NettableIngestError as GeneratedNettableIngestError,
  NettableLaunchOptionsApplied as GeneratedNettableLaunchOptionsApplied,
  NettableLaunchOptionsError as GeneratedNettableLaunchOptionsError,
  NettableMatchLeftPending as GeneratedNettableMatchLeftPending,
  NettableMatchLeftResolved as GeneratedNettableMatchLeftResolved,
  NettablePaused as GeneratedNettablePaused,
  NettablePersonalGameEnded as GeneratedNettablePersonalGameEnded,
  NettableQueenUploadComplete as GeneratedNettableQueenUploadComplete,
  NettableQueenUploadProgress as GeneratedNettableQueenUploadProgress,
  NettableRankingScanned as GeneratedNettableRankingScanned,
  NettableResyncComplete as GeneratedNettableResyncComplete,
  NettableRoundChanged as GeneratedNettableRoundChanged,
  NettableRows as GeneratedNettableRows,
  NettableSetupProgress as GeneratedNettableSetupProgress,
  NettableStateEvent as GeneratedNettableStateEvent,
  NettableStatus as GeneratedNettableStatus,
  NettableTimelineExtracted as GeneratedNettableTimelineExtracted,
  OutboxFlushed as GeneratedOutboxFlushed,
  PanicEvent as GeneratedPanicEvent,
  PayloadQueued as GeneratedPayloadQueued,
  SteamLogin as GeneratedSteamLogin,
  SteamLoginUrl as GeneratedSteamLoginUrl,
  SteamLogout as GeneratedSteamLogout,
  UpdateApplyRequested as GeneratedUpdateApplyRequested,
} from "./backend-events.generated";

export type * from "./backend-events.generated";

export type BackendName = "rust";

type WithType<T, Type extends string> = Omit<T, "type"> & { type: Type };
type WithBackendType<T, Type extends string> = Omit<T, "type" | "backend"> & {
  type: Type;
  backend: BackendName;
};

/**
 * Extracted per-player live state emitted alongside the raw NetTableState.
 * Built backend-side from `player_info_table` and gap-filled from `dac_table`.
 */
export interface LivePlayer {
  hp?: number;
  level?: number;
  placement?: number;
  duration?: number;
  lineup?: string;
  lineup_value?: number;
  total_money?: number;
  win_round?: number;
  lose_round?: number;
  relic?: string;
  relics?: string[];
  mmr_level?: number;
  candy?: number;
  buff?: string;
  board?: import("@dac/shared/types").ChessBoardPiece[];
}

export type BackendStatusEvent = WithBackendType<GeneratedBackendStatus, "status">;
export type BackendErrorEvent = WithType<GeneratedErrorEvent, "error">;
export type PanicEvent = Omit<WithBackendType<GeneratedPanicEvent, "panic">, "location"> & {
  location?: string;
};
export type PayloadQueuedEvent = WithType<GeneratedPayloadQueued, "payload_queued">;
export type OutboxFlushedEvent = WithBackendType<GeneratedOutboxFlushed, "outbox_flushed">;
export type ConfigUpdatedEvent = WithType<GeneratedConfigUpdated, "config_updated">;
export type GamesListEvent = Omit<WithBackendType<GeneratedGamesList, "games_list">, "games"> & {
  games: import("./backend-events.generated").JsonValue;
};
export type MatchTimelineEvent = Omit<
  WithBackendType<GeneratedMatchTimeline, "match_timeline">,
  "timeline"
> & {
  timeline: import("./backend-events.generated").JsonValue;
};
export type GameUpdatedEvent = WithBackendType<GeneratedGameUpdated, "game_updated">;
export type DrodoProfileEvent = Omit<
  WithBackendType<GeneratedDrodoProfile, "drodo_profile">,
  "profile"
> & {
  profile: import("./backend-events.generated").JsonValue;
};
export type SteamLoginUrlEvent = WithType<GeneratedSteamLoginUrl, "steam_login_url">;
export type SteamLoginEvent = WithType<GeneratedSteamLogin, "steam_login">;
export type SteamLogoutEvent = WithType<GeneratedSteamLogout, "steam_logout">;
export type UpdateApplyRequestedEvent = WithBackendType<
  GeneratedUpdateApplyRequested,
  "update_apply_requested"
>;
export type UpdateAvailableEvent = {
  type: "update_available";
  backend: "electron";
  tag?: string;
  version?: string;
};
export type UpdateDownloadProgressEvent = {
  type: "update_download_progress";
  backend: "electron";
  version?: string;
  percent: number;
  transferred?: number;
  total?: number;
};
export type UpdateDownloadedEvent = {
  type: "update_downloaded";
  backend: "electron";
  tag?: string;
  version?: string;
};
export type UpdateNotAvailableEvent = {
  type: "update_not_available";
  backend: "electron";
};
export type UpdateErrorEvent = {
  type: "update_error";
  backend: "electron";
  message: string;
};

export type DiagnosticsUploadedEvent = Omit<
  WithBackendType<GeneratedDiagnosticsUploaded, "diagnostics_uploaded">,
  "tracker_bytes" | "console_bytes" | "console_found" | "message"
> & {
  tracker_bytes?: number;
  console_bytes?: number;
  console_found?: boolean;
  message?: string;
};

export type NettableRowsEvent = Omit<WithType<GeneratedNettableRows, "nettable_rows">, "rows"> & {
  rows: Array<{
    table_name?: string;
    key?: string;
    raw?: unknown;
  }>;
};

export type NettableStateEvent = Omit<
  WithBackendType<GeneratedNettableStateEvent, "nettable_state">,
  "rows" | "state" | "players" | "local_steam_ids"
> & {
  rows: NettableRowsEvent["rows"];
  state: Record<string, Record<string, unknown>>;
  players: Record<string, LivePlayer>;
  local_steam_ids: string[];
};

export type NettableStatusEvent = WithBackendType<GeneratedNettableStatus, "nettable_status">;
export type NettablePausedEvent = WithBackendType<GeneratedNettablePaused, "nettable_paused">;
export type NettableCheckActiveMatchEvent = WithBackendType<
  GeneratedNettableCheckActiveMatch,
  "nettable_check_active_match"
>;
export type NettableIngestCompleteEvent = WithBackendType<
  GeneratedNettableIngestComplete,
  "nettable_ingest_complete"
>;
export type NettableIngestErrorEvent = Omit<
  WithType<GeneratedNettableIngestError, "nettable_ingest_error">,
  "backend" | "at"
> & {
  backend?: BackendName;
  at?: string;
};
export type NettableRoundChangedEvent = WithBackendType<
  GeneratedNettableRoundChanged,
  "nettable_round_changed"
>;
export type NettableCreepRoundEvent = WithBackendType<
  GeneratedNettableCreepRound,
  "nettable_creep_round"
>;
export type NettablePersonalGameEndedEvent = WithBackendType<
  GeneratedNettablePersonalGameEnded,
  "nettable_personal_game_ended"
>;
export type NettableGameEndedEvent = Omit<
  WithBackendType<GeneratedNettableGameEnded, "nettable_game_ended">,
  "match_id"
> & {
  match_id?: string;
};
export type NettableEndBoardSavedEvent = WithBackendType<
  GeneratedNettableEndBoardSaved,
  "nettable_end_board_saved"
>;
export type NettableMatchLeftPendingEvent = WithBackendType<
  GeneratedNettableMatchLeftPending,
  "nettable_match_left_pending"
>;
export type NettableMatchLeftResolvedEvent = Omit<
  WithBackendType<GeneratedNettableMatchLeftResolved, "nettable_match_left_resolved">,
  "outcome" | "match_id"
> & {
  outcome: "uploaded" | "cancelled" | "nothing_pending";
  match_id?: string;
};
export type NettableTimelineExtractedEvent = WithBackendType<
  GeneratedNettableTimelineExtracted,
  "nettable_timeline_extracted"
>;
export type NettableRankingScannedEvent = WithBackendType<
  GeneratedNettableRankingScanned,
  "nettable_ranking_scanned"
>;
export type NettableQueenUploadProgressEvent = WithType<
  GeneratedNettableQueenUploadProgress,
  "nettable_queen_upload_progress"
>;
export type NettableQueenUploadCompleteEvent = Omit<
  WithType<GeneratedNettableQueenUploadComplete, "nettable_queen_upload_complete">,
  "season"
> & {
  season?: string;
};
export type NettableResyncCompleteEvent = Omit<
  WithType<GeneratedNettableResyncComplete, "nettable_resync_complete">,
  "error"
> & {
  error?: string;
};
export type NettableSetupProgressEvent = Omit<
  WithType<GeneratedNettableSetupProgress, "nettable_launch_options_progress" | "nettable_resync_progress">,
  "type"
> & {
  type: "nettable_launch_options_progress" | "nettable_resync_progress";
};
export type NettableLaunchOptionsAppliedEvent =
  | WithBackendType<GeneratedNettableLaunchOptionsApplied, "nettable_launch_options_applied">
  | WithBackendType<GeneratedNettableLaunchOptionsError, "nettable_launch_options_applied">;

export type BackendEvent =
  | BackendStatusEvent
  | BackendErrorEvent
  | PanicEvent
  | PayloadQueuedEvent
  | OutboxFlushedEvent
  | ConfigUpdatedEvent
  | GamesListEvent
  | MatchTimelineEvent
  | GameUpdatedEvent
  | DrodoProfileEvent
  | SteamLoginUrlEvent
  | SteamLoginEvent
  | SteamLogoutEvent
  | UpdateApplyRequestedEvent
  | UpdateAvailableEvent
  | UpdateDownloadProgressEvent
  | UpdateDownloadedEvent
  | UpdateNotAvailableEvent
  | UpdateErrorEvent
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
  | NettableMatchLeftPendingEvent
  | NettableMatchLeftResolvedEvent
  | NettableTimelineExtractedEvent
  | NettableRankingScannedEvent
  | NettableQueenUploadProgressEvent
  | NettableQueenUploadCompleteEvent
  | NettableResyncCompleteEvent
  | NettableSetupProgressEvent
  | NettableLaunchOptionsAppliedEvent;
