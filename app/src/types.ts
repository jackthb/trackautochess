export interface Game {
  id: number;
  played_at: string;
  placement: string;
  rank: string | null;
  rank_change: string | null;
  lineup: string | null;
  synergies: string | null;
  relic: string | null;
  level: string | null;
  wl: string | null;
  screenshot: string | null;
  user_id: string;
  created_at: string;
}

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
}

export interface ParseResult {
  type: "parse_result";
  rows: ParseResultRow[];
  timestamps: string[];
  screenshot_b64?: string;
}

export interface RecordingStats {
  elapsed: number;
  frames: number;
  size_mb: number;
}

export interface TrackerStatus {
  type: "status";
  recording: boolean;
  focused: boolean;
  logged_in: boolean;
  version: string;
  steam_id: string;
  steam_name: string;
  replay_enabled: boolean;
  recording_stats: RecordingStats | null;
}

export interface LogEntry {
  type: "log";
  ts: number;
  level: string;
  msg: string;
}

export type TrackerEvent =
  | ParseResult
  | TrackerStatus
  | LogEntry
  | { type: "import_result" }
  | { type: "focus_gained" }
  | { type: "focus_lost" }
  | { type: "replay_started" }
  | { type: "replay_saved" }
  | { type: "error"; message: string }
  | { type: "steam_login"; steam_id: string; steam_name: string }
  | { type: "notification"; title: string; message: string };

export interface UnitInfo {
  cost: number;
  [key: string]: unknown;
}

export interface UnitsData {
  units: Record<string, UnitInfo>;
  aliases?: Record<string, string>;
}

export interface UnitFullInfo {
  synergies?: string[];
  stats?: Record<string, {
    hp: number;
    atk: number | number[];
    armor: number;
    magic_resist: number;
    mana: number;
    atk_rate: number;
  }>;
  [key: string]: unknown;
}

export interface SynergyInfo {
  name: string;
  description?: string;
  formatted?: string;
  tiers?: number[];
  lore?: string;
  [key: string]: unknown;
}

export interface RelicInfo {
  name: string;
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
    };
    tracker: {
      sendCommand: (cmd: Record<string, unknown>) => void;
      onEvent: (callback: (msg: TrackerEvent) => void) => void;
    };
    appApi: {
      openFileDialog: () => Promise<string | null>;
      getVersion: () => Promise<string>;
      fetchGames: () => Promise<Game[]>;
      updateGame: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
      deleteGame: (gameId: number) => Promise<boolean>;
      fetchUnitsData: () => Promise<UnitsData>;
      fetchUnitsFull: () => Promise<Record<string, UnitFullInfo>>;
      fetchSynergies: () => Promise<Record<string, SynergyInfo>>;
      fetchRelics: () => Promise<{ relics: Record<string, RelicInfo> }>;
    };
  }
}
