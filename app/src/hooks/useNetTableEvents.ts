import { useEffect, useState } from "react";
import type { TrackerEvent } from "../types";

/**
 * Activity feed for NetTable + import pipeline.
 *
 * Subscribes to `window.tracker.onEvent` and keeps the most recent ~50 entries
 * in chronological order (newest last).
 */

export type NetTableActivityKind =
  | "nettable_pause_fired"
  | "nettable_check_active_match"
  | "nettable_dump_captured"
  | "nettable_ingest_complete"
  | "nettable_ingest_error"
  | "nettable_queen_upload_complete"
  | "nettable_game_ended"
  | "nettable_end_board_saved"
  | "nettable_creep_round"
  | "parse_result"
  | "import_result";

export interface NetTableStatus {
  autoexec_installed: boolean;
  log_path: string;
  log_writable: boolean;
  /** False when the remote game-tracking kill switch is disabling capture. */
  remote_enabled: boolean;
  /** Raw launch-options string from Steam's localconfig.vdf, or null if we couldn't read it. */
  launch_options: string | null;
  /** True/false when localconfig was read; null if unknown. */
  has_condebug: boolean | null;
  has_conclearlog: boolean | null;
  /** -gamestateintegration: required for the GSI listener to receive payloads,
   *  which gates the SendInput cascade. Without it live capture silently
   *  never fires. Null if we couldn't read localconfig. */
  has_gamestateintegration: boolean | null;
  /** True if steam.exe was running at the moment we last checked. */
  steam_running: boolean;
  /** Empirical: dota2.exe is currently a running process. */
  dota_running: boolean;
  /** Empirical: console.log has been written to within the active window. The
   *  only signal that proves -condebug is actually doing its job right now,
   *  independent of what Steam's localconfig.vdf claims. */
  log_active: boolean;
  paused: boolean;
}

export interface NetTableLaunchOptionsApplied {
  ok: boolean;
  error?: string;
  noop?: boolean;
  before?: string;
  after?: string;
  added?: string[];
  config_path?: string;
  backup_path?: string;
}

export interface NetTableQueenUploadResult {
  ok: boolean;
  player_count: number;
  upserted_count: number;
  season?: string;
  error?: string | null;
  at?: string;
}

export interface NetTableActivityEntry {
  id: number;
  kind: NetTableActivityKind;
  /** ms epoch — wall clock when we received the event */
  receivedAt: number;
  title: string;
  detail?: string;
  tone?: "info" | "success" | "warning" | "error";
}

/**
 * Live snapshot of the most-recently-captured CustomNetTable state.
 * Keyed by `CustomNetTable_*` table name; each value maps entry key
 * (e.g. `player_info`, `ranking_top`) to the decoded VBKV dict.
 */
export type NetTableState = Record<string, Record<string, unknown>>;

/**
 * Extracted per-player live state emitted alongside the raw NetTableState.
 * Built backend-side from `player_info_table` (gap-filled from `dac_table`).
 * `lineup` is the raw `chess_*` code list (e.g. `chess_wl1,chess_br11,`);
 * the frontend resolves codes → names + stars where units_full.json lives.
 * `hp` is the live value (the dac_table hp=100 sentinel is handled backend-side).
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
  /** Current/latest relic code. */
  relic?: string;
  /** Every relic the player has taken, in pick order (from relic_history). */
  relics?: string[];
  mmr_level?: number;
  candy?: number;
  /** Raw synergy stems from the game: "is_mage:6,is_human:6,". */
  buff?: string;
  board?: import("@dac/shared/types").ChessBoardPiece[];
}

export interface NetTableActivityState {
  status: NetTableStatus | null;
  entries: NetTableActivityEntry[];
  state: NetTableState;
  stateAt: string | null;
  /** Extracted per-player live state, keyed by steam_id. */
  livePlayers: Record<string, LivePlayer>;
  /** Steam IDs belonging to the local player (from player_info_table.data). */
  localSteamIds: string[];
  /** Result of the most recent apply-launch-options attempt. Null until the user clicks. */
  launchOptionsApplied: NetTableLaunchOptionsApplied | null;
  /** Current progress message during apply (null when idle or finished). */
  launchOptionsProgress: string | null;
  /** Current progress message during resync-from-Steam (null when idle). */
  resyncProgress: string | null;
  /** Result of the most recent manual Queen upload. Null until the user clicks. */
  queenUpload: NetTableQueenUploadResult | null;
  /** Current progress message during manual Queen upload (null when idle). */
  queenUploadProgress: string | null;
}

const MAX_ENTRIES = 50;

type NetTablePauseFiredEvent = {
  type: "nettable_pause_fired";
  at: string;
};

type NetTableDumpCapturedEvent = {
  type: "nettable_dump_captured";
  tables: string[];
  at: string;
};

type Incoming = TrackerEvent | NetTablePauseFiredEvent | NetTableDumpCapturedEvent;

function summarizeTables(tables: string[]): string {
  if (tables.length === 0) return "no tables";
  return tables
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

function summarizeTableList(tables: string[]): string {
  if (tables.length === 0) return "no tables";
  const head = tables.slice(0, 3);
  const extra = tables.length - head.length;
  const headStr = head.join(" · ");
  return extra > 0 ? `${headStr} · ${extra} more` : headStr;
}

function stateFromRows(rows: NetTableRowEvent["rows"]): NetTableState {
  const next: NetTableState = {};
  for (const row of rows) {
    if (!row.table_name || !row.key) continue;
    next[row.table_name] ??= {};
    next[row.table_name][row.key] = row.raw;
  }
  return next;
}

function tablesFromRows(rows: NetTableRowEvent["rows"]): string[] {
  return Array.from(
    new Set(rows.map((row) => row.table_name).filter((table): table is string => Boolean(table))),
  ).sort((a, b) => a.localeCompare(b));
}

export function useNetTableEvents(): NetTableActivityState {
  const [status, setStatus] = useState<NetTableStatus | null>(null);
  const [entries, setEntries] = useState<NetTableActivityEntry[]>([]);
  const [state, setState] = useState<NetTableState>({});
  const [stateAt, setStateAt] = useState<string | null>(null);
  const [livePlayers, setLivePlayers] = useState<Record<string, LivePlayer>>({});
  const [localSteamIds, setLocalSteamIds] = useState<string[]>([]);
  const [launchOptionsApplied, setLaunchOptionsApplied] =
    useState<NetTableLaunchOptionsApplied | null>(null);
  const [launchOptionsProgress, setLaunchOptionsProgress] = useState<string | null>(null);
  const [resyncProgress, setResyncProgress] = useState<string | null>(null);
  const [queenUpload, setQueenUpload] = useState<NetTableQueenUploadResult | null>(null);
  const [queenUploadProgress, setQueenUploadProgress] = useState<string | null>(null);
  useEffect(() => {
    if (!window.tracker) return;
    let nextId = 1;

    const push = (entry: Omit<NetTableActivityEntry, "id" | "receivedAt">) => {
      setEntries((prev) => {
        const next = [
          ...prev,
          {
            ...entry,
            id: nextId++,
            receivedAt: Date.now(),
          },
        ];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
    };

    const unsubscribe = window.tracker.onEvent((msg: Incoming) => {
      switch (msg.type) {
        case "nettable_status":
          setStatus((prev) => {
            const next: NetTableStatus = {
              autoexec_installed: msg.autoexec_installed,
              log_path: msg.log_path,
              log_writable: msg.log_writable,
              remote_enabled: msg.remote_enabled ?? true,
              launch_options: msg.launch_options ?? null,
              has_condebug: msg.has_condebug ?? null,
              has_conclearlog: msg.has_conclearlog ?? null,
              has_gamestateintegration: msg.has_gamestateintegration ?? null,
              steam_running: msg.steam_running,
              dota_running: msg.dota_running,
              log_active: msg.log_active,
              paused: msg.paused ?? false,
            };
            // Surface a one-time warning when Dota launches but console.log
            // doesn't start writing — that's the empirical "you forgot
            // -condebug" signal.
            if (
              prev &&
              !prev.dota_running &&
              msg.dota_running &&
              !msg.log_active
            ) {
              push({
                kind: "nettable_ingest_error",
                title: "Setup should be applied",
                detail:
                  "We can't confirm it is working until Dota writes lobby data. Open a practice lobby and play one round; if nothing appears, run automatic setup and restart Dota.",
                tone: "warning",
              });
            }
            return next;
          });
          break;
        case "nettable_pause_fired": {
          push({
            kind: "nettable_pause_fired",
            title: "PAUSE registered in Dota",
            detail: "Autoexec bind fired — waiting on dump output (empty outside a DAC match).",
            tone: "info",
          });
          break;
        }
        case "nettable_dump_captured": {
          push({
            kind: "nettable_dump_captured",
            title: "Captured lobby data",
            detail: summarizeTables(msg.tables),
            tone: "info",
          });
          break;
        }
        case "nettable_ingest_complete": {
          push({
            kind: "nettable_ingest_complete",
            title: `Saved ${msg.rows_written} row${msg.rows_written === 1 ? "" : "s"}`,
            detail: summarizeTableList(msg.tables),
            tone: "success",
          });
          break;
        }
        case "nettable_ingest_error": {
          push({
            kind: "nettable_ingest_error",
            title: "Ingest failed",
            detail: msg.error,
            tone: "error",
          });
          break;
        }
        case "nettable_check_active_match": {
          push({
            kind: "nettable_check_active_match",
            title: "Checking active match",
            detail: msg.message,
            tone: msg.ok ? "info" : "warning",
          });
          break;
        }
        case "nettable_rows": {
          const rows = Array.isArray(msg.rows) ? msg.rows : [];
          const tables = tablesFromRows(rows);
          setState(stateFromRows(rows));
          setStateAt(new Date().toISOString());
          push({
            kind: "nettable_dump_captured",
            title: `Captured ${rows.length} row${rows.length === 1 ? "" : "s"}`,
            detail: summarizeTableList(tables),
            tone: "success",
          });
          break;
        }
        case "nettable_game_ended": {
          push({
            kind: "nettable_game_ended",
            title: "Match ended",
            detail: msg.message,
            tone: "info",
          });
          break;
        }
        case "nettable_end_board_saved": {
          push({
            kind: "nettable_end_board_saved",
            title: "Captured end board",
            detail: msg.at,
            tone: "success",
          });
          break;
        }
        case "nettable_creep_round": {
          push({
            kind: "nettable_creep_round",
            title: `Creep round ${msg.round}`,
            tone: "info",
          });
          break;
        }
        case "nettable_state": {
          setState(msg.state ?? {});
          setLivePlayers(msg.players ?? {});
          setLocalSteamIds(msg.local_steam_ids ?? []);
          setStateAt(msg.at || null);
          break;
        }
        case "nettable_launch_options_progress": {
          setLaunchOptionsProgress(msg.message);
          break;
        }
        case "nettable_resync_progress": {
          setResyncProgress(msg.message);
          break;
        }
        case "nettable_resync_complete": {
          setResyncProgress(null);
          if (!msg.ok) {
            push({
              kind: "nettable_ingest_error",
              title: "Couldn't re-sync from Steam",
              detail: msg.error,
              tone: "error",
            });
          }
          break;
        }
        case "nettable_queen_upload_progress": {
          setQueenUploadProgress(msg.message);
          break;
        }
        case "nettable_queen_upload_complete": {
          const { type: _type, ...rest } = msg;
          setQueenUpload(rest);
          setQueenUploadProgress(null);
          push({
            kind: "nettable_queen_upload_complete",
            title: rest.ok ? "Queens uploaded" : "Queens upload failed",
            detail: rest.ok
              ? `${rest.upserted_count}/${rest.player_count} player${rest.player_count === 1 ? "" : "s"} saved`
              : rest.error,
            tone: rest.ok ? "success" : "error",
          });
          break;
        }
        case "nettable_launch_options_applied": {
          const { type: _type, ...rest } = msg;
          setLaunchOptionsApplied(rest);
          setLaunchOptionsProgress(null);
          if (rest.ok && !rest.noop) {
            push({
              kind: "nettable_ingest_complete",
              title: "Setup updated",
              detail: "Restart Steam, then Dota.",
              tone: "success",
            });
          } else if (!rest.ok) {
            push({
              kind: "nettable_ingest_error",
              title: "Couldn't update setup",
              detail: rest.error,
              tone: "error",
            });
          }
          break;
        }
        case "parse_result": {
          const rows = msg.rows?.length ?? 0;
          const screen = msg.screen_type ?? "screenshot";
          push({
            kind: "parse_result",
            title: `Parsed ${screen.replace(/_/g, " ")}`,
            detail: `${rows} row${rows === 1 ? "" : "s"} detected`,
            tone: "info",
          });
          break;
        }
        case "import_result": {
          const imported = msg.imported ?? 0;
          const skipped = msg.skipped ?? 0;
          const failed = msg.failed ?? 0;
          const parts: string[] = [];
          if (imported) parts.push(`${imported} imported`);
          if (skipped) parts.push(`${skipped} skipped`);
          if (failed) parts.push(`${failed} failed`);
          push({
            kind: "import_result",
            title: msg.message || "Import finished",
            detail: parts.length > 0 ? parts.join(" · ") : undefined,
            tone:
              msg.tone === "error"
                ? "error"
                : msg.tone === "warning"
                  ? "warning"
                  : "success",
          });
          break;
        }
      }
    });

    window.tracker.sendCommand({ cmd: "nettable_status" });
    window.tracker.sendCommand({ cmd: "nettable_get_state" });

    return () => {
      unsubscribe();
    };
  }, []);

  return {
    status,
    entries,
    state,
    stateAt,
    livePlayers,
    localSteamIds,
    launchOptionsApplied,
    launchOptionsProgress,
    resyncProgress,
    queenUpload,
    queenUploadProgress,
  };
}
