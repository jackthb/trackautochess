import { useEffect, useState } from "react";
import type { LivePlayer, TrackerEvent } from "../types";

export type { LivePlayer } from "../types";

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
  | "nettable_match_left_pending"
  | "nettable_match_left_resolved"
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
  has_console: boolean | null;
  has_condebug: boolean | null;
  has_conclearlog: boolean | null;
  /** -gamestateintegration: required for the GSI listener to receive payloads. */
  has_gamestateintegration: boolean | null;
  /** True when Dota owns the foreground window, enabling dump-key capture. */
  dota_focused: boolean;
  /** True if steam.exe was running at the moment we last checked. */
  steam_running: boolean;
  /** Empirical: dota2.exe is currently a running process. */
  dota_running: boolean;
  /** Empirical: console.log has been written to within the active window. The
   *  only signal that proves -condebug is actually doing its job right now,
   *  independent of what Steam's localconfig.vdf claims. */
  log_active: boolean;
  paused: boolean;
  /** True while Dota's UI is the in-game Auto Chess match screen. */
  in_match: boolean;
  /** First round observed in the current match, if any. */
  first_round: number | null;
  /** Latest round observed in the current match, if any. */
  current_round: number | null;
  /** Players still above 0 HP in the latest live snapshot, if known. */
  players_alive: number | null;
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

export interface NetTableGameEndedState {
  message?: string;
  at: string;
}

/** A match the user left early; the backend holds its snapshot until the user
 *  confirms the game is over, the window lapses, or they rejoin. */
export interface NetTablePendingLeaveState {
  message: string;
  /** ISO time when the held snapshot auto-uploads as-is. */
  expiresAt: string;
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
  /** Most recent match-end signal, used by the home screen after a game finishes. */
  lastGameEnded: NetTableGameEndedState | null;
  /** Set while a left-early match snapshot awaits confirmation or timeout. */
  pendingLeave: NetTablePendingLeaveState | null;
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

type NetTableRow = {
  table_name: string;
  key: string;
  raw: unknown;
};

function parseNetTableRows(rows: unknown): NetTableRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is NetTableRow => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return false;
    const candidate = row as Record<string, unknown>;
    return typeof candidate.table_name === "string" && typeof candidate.key === "string";
  });
}

function stateFromRows(rows: unknown): NetTableState {
  const next: NetTableState = {};
  for (const row of parseNetTableRows(rows)) {
    if (!row.table_name || !row.key) continue;
    next[row.table_name] ??= {};
    next[row.table_name][row.key] = row.raw;
  }
  return next;
}

function tablesFromRows(rows: unknown): string[] {
  return Array.from(
    new Set(parseNetTableRows(rows).map((row) => row.table_name)),
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
  const [lastGameEnded, setLastGameEnded] = useState<NetTableGameEndedState | null>(null);
  const [pendingLeave, setPendingLeave] = useState<NetTablePendingLeaveState | null>(null);
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
                has_console: msg.has_console ?? null,
              has_condebug: msg.has_condebug ?? null,
              has_conclearlog: msg.has_conclearlog ?? null,
              has_gamestateintegration: msg.has_gamestateintegration ?? null,
              dota_focused: msg.dota_focused ?? false,
              steam_running: msg.steam_running,
              dota_running: msg.dota_running,
              log_active: msg.log_active,
              paused: msg.paused ?? false,
              in_match: msg.in_match ?? false,
              first_round: msg.first_round ?? null,
              current_round: msg.current_round ?? null,
              players_alive: msg.players_alive ?? null,
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
          const transport = msg.command_transport
            ? ` via ${msg.command_transport}`
            : "";
          push({
            kind: "nettable_check_active_match",
            title: "Checking active match",
            detail: `${msg.message}${transport}`,
            tone: msg.ok ? "info" : "warning",
          });
          break;
        }
        case "nettable_rows": {
          const rows = Array.isArray(msg.rows) ? msg.rows : [];
          const tables = tablesFromRows(rows);
          if (rows.length > 0) setLastGameEnded(null);
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
          setLastGameEnded({
            message: msg.message,
            at: new Date().toISOString(),
          });
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  in_match: false,
                  first_round: null,
                  current_round: null,
                  players_alive: null,
                }
              : prev,
          );
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
        case "nettable_match_left_pending": {
          setPendingLeave({
            message: msg.message,
            expiresAt: msg.expires_at,
          });
          push({
            kind: "nettable_match_left_pending",
            title: "Left the match early",
            detail: msg.message,
            tone: "warning",
          });
          break;
        }
        case "nettable_match_left_resolved": {
          setPendingLeave(null);
          push({
            kind: "nettable_match_left_resolved",
            title:
              msg.outcome === "uploaded"
                ? "Left match uploaded"
                : msg.outcome === "cancelled"
                  ? "Rejoined the match"
                  : "Left match",
            detail: msg.message,
            tone: msg.outcome === "uploaded" ? "success" : "info",
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
        case "nettable_round_changed": {
          setStatus((prev) => {
            if (!prev) return prev;
            const round = typeof msg.round === "number" ? msg.round : null;
            if (round == null) return prev;
            return {
              ...prev,
              in_match: true,
              first_round: prev.first_round ?? round,
              current_round: round,
            };
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
          setQueenUpload(null);
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
              : rest.error ?? "Queens upload failed",
            tone: rest.ok ? "success" : "error",
          });
          break;
        }
        case "nettable_launch_options_applied": {
          const { type: _type, ...rest } = msg;
          setLaunchOptionsProgress(null);
          if ("error" in rest) {
            setLaunchOptionsApplied(null);
            push({
              kind: "nettable_ingest_error",
              title: "Couldn't update setup",
              detail: rest.error,
              tone: "error",
            });
            break;
          }
          const applied = {
            ...rest,
            backup_path: rest.backup_path ?? undefined,
            gsi_cfg_path: rest.gsi_cfg_path ?? undefined,
          };
          setLaunchOptionsApplied(applied);
          if (!applied.noop) {
            push({
              kind: "nettable_ingest_complete",
              title: "Setup updated",
              detail: "Restart Steam, then Dota.",
              tone: "success",
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
    lastGameEnded,
    pendingLeave,
  };
}
