import type { ItemFullInfo, RelicInfo, SynergyInfo, UnitFullInfo } from "@dac/shared/types";
import type { BackendEvent } from "./backend-events";
import type { BackendCommand } from "./backend-events.generated";

export type { ItemFullInfo, RelicInfo, SynergyInfo, UnitFullInfo } from "@dac/shared/types";
export type * from "./backend-events";

export interface Replay {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface ReplayStats {
  count: number;
  totalBytes: number;
}

export interface ParseResultRow {
  placement: string;
  level: string;
  wl: string;
  rank: string;
  rank_change: string;
  units: string[];
  synergies: string;
  relic: string;
  time_ago: string;
  is_duplicate?: boolean;
}

export interface ParseResult {
  type: "parse_result";
  rows: ParseResultRow[];
  timestamps: string[];
  screenshot_b64?: string;
  screenshot_name?: string;
  screenshot_path?: string;
  screen_type?: "my_matches" | "game_over" | "final_ranking" | "unknown";
}

export interface ProcessingScreenshot {
  type: "processing_screenshot";
  screenshot_b64?: string;
  screenshot_name?: string;
  screenshot_path?: string;
  screen_type?: "my_matches" | "game_over" | "final_ranking" | "unknown";
  message?: string;
}

export interface RecordingStats {
  elapsed: number;
  frames: number;
  size_mb: number;
}

export interface UpdateStatus {
  state: "available" | "downloading" | "downloaded" | "error";
  tag?: string;
  version?: string;
  percent?: number;
  message?: string;
}

export interface TrackerStatus {
  type: "status";
  recording: boolean;
  focused: boolean;
  logged_in: boolean;
  version: string;
  steam_id: string;
  steam_name: string;
  admin_mode: boolean;
  replay_enabled: boolean;
  recording_stats: RecordingStats | null;
  update?: UpdateStatus;
}

export interface LogEntry {
  type: "log";
  ts: number;
  level: string;
  msg: string;
  /** Which file the line came from. "tracker" = backend's tracker.log,
   *  "dota" = Dota 2's console.log. Optional for backwards-compat with
   *  older backend events that did not include a source. */
  source?: "tracker" | "dota";
}

export type ImportResultTone = "success" | "warning" | "error";

export interface ImportResultEvent {
  type: "import_result";
  imported: number;
  skipped: number;
  failed?: number;
  message?: string;
  tone?: ImportResultTone;
  screen_type?: "my_matches" | "game_over" | "final_ranking" | "unknown";
  linked_to_user?: number;
  profile_url?: string;
  match_id?: string;
  screenshot_url?: string;
  game_id?: number;
  match_url?: string;
}

export interface ImportProgressEvent {
  type: "import_progress";
  progress: number;
  message?: string;
}

export type TrackerEvent =
  | BackendEvent
  | ParseResult
  | ProcessingScreenshot
  | LogEntry
  | ImportResultEvent
  | ImportProgressEvent
  | { type: "import_finished" }
  | { type: "focus_gained" }
  | { type: "focus_lost" }
  | { type: "replay_started" }
  | { type: "replay_saved" };

export interface UnitInfo {
  cost: number;
  [key: string]: unknown;
}

export interface UnitsData {
  units: Record<string, UnitInfo>;
  aliases?: Record<string, string>;
}

export interface ItemInfo {
  tier: number;
  icon?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ItemsData {
  items: Record<string, ItemInfo>;
  total?: number;
}

export interface TalentInfo {
  title: string;
  description?: string;
  [key: string]: unknown;
}

// Window API types from preload.js
declare global {
  interface Window {
    windowControls: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
    replays: {
      list: () => Promise<Replay[]>;
      delete: (filename: string) => Promise<boolean>;
      stats: () => Promise<ReplayStats>;
      openFolder: () => Promise<void>;
      exists: (filename: string) => Promise<boolean>;
    };
    tracker: {
      sendCommand: (cmd: BackendCommand) => void;
      onEvent: (callback: (msg: TrackerEvent) => void) => () => void;
    };
    appApi: {
      openExternal: (url: string) => Promise<boolean>;
      getVersion: () => Promise<string>;
      onError: (
        callback: (payload: { source: string; message: string; stack?: string }) => void,
      ) => () => void;
      fetchUnitsData: () => Promise<UnitsData>;
      fetchUnitsFull: () => Promise<Record<string, UnitFullInfo>>;
      fetchSynergies: () => Promise<Record<string, SynergyInfo>>;
      fetchRelics: () => Promise<{ relics: Record<string, RelicInfo> }>;
      fetchItems: () => Promise<ItemsData>;
      fetchItemsFull: () => Promise<Record<string, ItemFullInfo>>;
      fetchItemLinks: () => Promise<{
        links?: { item?: string; synergy?: string; category?: string }[];
      }>;
      fetchTalents: () => Promise<Record<string, TalentInfo>>;
    };
    legendaryOverlay?: {
      update: (payload: {
        revealed: { code: string; name: string }[];
        unrevealed: { code: string; name: string }[];
        stateAt: string | null;
      } | null) => Promise<boolean>;
      hide: () => Promise<boolean>;
      show: () => Promise<boolean>;
      toggle: () => Promise<boolean>;
      ready: () => void;
      resize: (size: { width: number; height: number }) => void;
      onPush: (
        callback: (
          payload: {
            revealed: { code: string; name: string }[];
            unrevealed: { code: string; name: string }[];
            stateAt: string | null;
          } | null,
        ) => void,
      ) => () => void;
    };
  }
}
