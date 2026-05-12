/** A row from the `games` table — one player's result in a match. */
export interface Game {
  id: number;
  user_id: string;
  placement: string;
  rank: string | null;
  rank_change: "up" | "down" | "none" | null;
  lineup: string | null;
  synergies: string | null;
  talents: string | null;
  relic: string | null;
  level: string | null;
  wl: string | null;
  wins: number | null;
  losses: number | null;
  screenshot: string | null;
  replay: string | null;
  notes: string | null;
  match_id: string | null;
  played_at: string;
  created_at: string;
}

/** @deprecated Use Game instead — the table is flat, not split. */
export type PlayerGame = Game;

export interface Replay {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface Screenshot {
  name: string;
  path: string;
  size: number;
  mtime: number;
  uploaded: boolean;
  hasParsed: boolean;
  hasImported: boolean;
  screenType: "my_matches" | "game_over" | "final_ranking" | "unknown" | null;
}

export interface SavedParseResult {
  rows: ParseResultRow[];
  timestamps: string[];
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

// ── Parser Lab ───────────────────────────────────────────────────────────────

export type LabRegionKind = "ocr" | "template" | "grid" | "band";

export interface LabRegion {
  name: string;
  kind: LabRegionKind;
  category: string;
  bbox: [number, number, number, number];
  label: string;
  row_index: number | null;
}

export interface LabParseFullResult {
  ok: boolean;
  error?: string;
  screen_type?: "my_matches" | "game_over" | "final_ranking" | "unknown";
  width?: number;
  height?: number;
  regions?: LabRegion[];
}

export interface LabParseRegionResult {
  ok: boolean;
  error?: string;
  name?: string;
  category?: string;
  bbox?: [number, number, number, number];
  label?: string;
  crop_b64?: string;
}

export interface LabScreenshotGroup {
  label: string;
  files: Array<{ name: string; path: string; size: number; mtime: number }>;
}

export interface LabFixture {
  name: string;
  path: string;
  screenshot_path: string;
  screen_type: string;
  row_count: number;
}

export interface LabConfigBundle {
  defaults: Record<string, unknown> | null;
  overrides: Record<string, unknown> | null;
}

export interface LabPytestEvent {
  seq: number;
  kind: "stdout" | "stderr" | "exit" | "error";
  text: string;
}

export interface LabApi {
  listScreenshots: () => Promise<LabScreenshotGroup[]>;
  loadConfig: () => Promise<LabConfigBundle>;
  saveConfig: (config: Record<string, unknown>) => Promise<{ ok: boolean; path?: string }>;
  resetConfig: () => Promise<{ ok: boolean }>;
  parseFull: (payload: { path: string }) => Promise<LabParseFullResult>;
  parseRegion: (payload: {
    path: string;
    name: string;
    category: string;
    bbox: [number, number, number, number];
  }) => Promise<LabParseRegionResult>;
  listFixtures: () => Promise<LabFixture[]>;
  saveFixture: (name: string, data: unknown) => Promise<{ ok: boolean; path?: string }>;
  deleteFixture: (name: string) => Promise<{ ok: boolean; error?: string }>;
  imageData: (filePath: string) => Promise<string | null>;
  runFixtures: () => Promise<{ ok: boolean; seq: number }>;
  onPytestOutput: (callback: (msg: LabPytestEvent) => void) => () => void;
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
  admin_mode: boolean;
  replay_enabled: boolean;
  recording_stats: RecordingStats | null;
}

export interface LogEntry {
  type: "log";
  ts: number;
  level: string;
  msg: string;
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
  | ParseResult
  | ProcessingScreenshot
  | TrackerStatus
  | LogEntry
  | ImportResultEvent
  | ImportProgressEvent
  | { type: "import_finished" }
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

export interface SeasonSnapshot {
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
}

export interface DrodoProfile {
  mmr: number | null;
  max_mmr: number | null;
  mmr_level: number | null;
  season: string | null;
  season_games: number | null;
  chicken_count: number | null;
  fetched_at: string | null;
  seasons?: SeasonSnapshot[];
}

// Window API types from preload.js
declare global {
  interface Window {
    windowControls: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
    screenshots: {
      list: () => Promise<Screenshot[]>;
      delete: (filename: string) => Promise<boolean>;
      openFolder: () => Promise<void>;
      thumbnail: (filename: string) => Promise<string | null>;
      getParseResult: (filename: string) => Promise<SavedParseResult | null>;
      updateParseRow: (filename: string, rowIndex: number, fields: Partial<ParseResultRow>) => Promise<boolean>;
    };
    replays: {
      list: () => Promise<Replay[]>;
      delete: (filename: string) => Promise<boolean>;
      stats: () => Promise<ReplayStats>;
      openFolder: () => Promise<void>;
      exists: (filename: string) => Promise<boolean>;
    };
    tracker: {
      sendCommand: (cmd: Record<string, unknown>) => void;
      onEvent: (callback: (msg: TrackerEvent) => void) => () => void;
    };
    lab: LabApi;
    appApi: {
      openFileDialog: () => Promise<string | null>;
      openGameOverScreenshotDialog: () => Promise<string | null>;
      openExternal: (url: string) => Promise<boolean>;
      getVersion: () => Promise<string>;
      getCloseToTray: () => Promise<boolean>;
      setCloseToTray: (value: boolean) => Promise<boolean>;
      fetchGames: () => Promise<Game[]>;
      updateGame: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
      deleteGame: (gameId: number) => Promise<boolean>;
      fetchUnitsData: () => Promise<UnitsData>;
      fetchUnitsFull: () => Promise<Record<string, UnitFullInfo>>;
      fetchSynergies: () => Promise<Record<string, SynergyInfo>>;
      fetchRelics: () => Promise<{ relics: Record<string, RelicInfo> }>;
      fetchItems: () => Promise<ItemsData>;
      fetchTalents: () => Promise<Record<string, TalentInfo>>;
      fetchDrodo: () => Promise<DrodoProfile | null>;
      refreshDrodo: () => Promise<DrodoProfile | null>;
    };
  }
}
