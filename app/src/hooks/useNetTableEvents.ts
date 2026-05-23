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
  | "nettable_dump_captured"
  | "nettable_ingest_complete"
  | "nettable_ingest_error"
  | "nettable_game_ended"
  | "nettable_end_board_saved"
  | "nettable_creep_round"
  | "parse_result"
  | "import_result";

export interface NetTableStatus {
  autoexec_installed: boolean;
  log_path: string;
  log_writable: boolean;
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

interface NetTableActivityState {
  status: NetTableStatus | null;
  entries: NetTableActivityEntry[];
  state: NetTableState;
  stateAt: string | null;
  /** Result of the most recent apply-launch-options attempt. Null until the user clicks. */
  launchOptionsApplied: NetTableLaunchOptionsApplied | null;
  /** Current progress message during apply (null when idle or finished). */
  launchOptionsProgress: string | null;
  /** Current progress message during resync-from-Steam (null when idle). */
  resyncProgress: string | null;
}

const MAX_ENTRIES = 50;

// Extra event shapes from the backend that aren't in types.ts yet.
type NetTableStatusEvent = {
  type: "nettable_status";
  autoexec_installed: boolean;
  log_path: string;
  log_writable: boolean;
  launch_options: string | null;
  has_condebug: boolean | null;
  has_conclearlog: boolean | null;
  has_gamestateintegration: boolean | null;
  steam_running: boolean;
  dota_running: boolean;
  log_active: boolean;
};
type NetTableLaunchOptionsAppliedEvent = NetTableLaunchOptionsApplied & {
  type: "nettable_launch_options_applied";
};
type NetTableLaunchOptionsProgressEvent = {
  type: "nettable_launch_options_progress";
  stage: "closing_steam" | "waiting_steam_exit" | "writing";
  message: string;
};
type NetTableResyncProgressEvent = {
  type: "nettable_resync_progress";
  stage: "closing_steam" | "waiting_steam_exit";
  message: string;
};
type NetTableResyncCompleteEvent = {
  type: "nettable_resync_complete";
  ok: boolean;
  noop?: boolean;
  error?: string;
};
type NetTablePauseFiredEvent = {
  type: "nettable_pause_fired";
  at: string;
};
type NetTableDumpCapturedEvent = {
  type: "nettable_dump_captured";
  tables: Record<string, number>;
  at: string;
};
type NetTableIngestCompleteEvent = {
  type: "nettable_ingest_complete";
  rows_written: number;
  tables: string[];
  at: string;
};
type NetTableIngestErrorEvent = {
  type: "nettable_ingest_error";
  error: string;
};
type NetTableStateEvent = {
  type: "nettable_state";
  state: NetTableState;
  at: string;
};
type NetTableGameEndedEvent = {
  type: "nettable_game_ended";
  message: string;
  at: string;
};
type NetTableEndBoardSavedEvent = {
  type: "nettable_end_board_saved";
  path: string;
  at: string;
};
type NetTableCreepRoundEvent = {
  type: "nettable_creep_round";
  round: number;
  at: string;
};

type Incoming =
  | TrackerEvent
  | NetTableStatusEvent
  | NetTablePauseFiredEvent
  | NetTableDumpCapturedEvent
  | NetTableIngestCompleteEvent
  | NetTableIngestErrorEvent
  | NetTableStateEvent
  | NetTableGameEndedEvent
  | NetTableEndBoardSavedEvent
  | NetTableCreepRoundEvent
  | NetTableLaunchOptionsAppliedEvent
  | NetTableLaunchOptionsProgressEvent
  | NetTableResyncProgressEvent
  | NetTableResyncCompleteEvent;

function summarizeTables(tables: Record<string, number>): string {
  const names = Object.keys(tables);
  if (names.length === 0) return "no tables";
  const head = names.slice(0, 3);
  const extra = names.length - head.length;
  const headStr = head.join(" · ");
  return extra > 0 ? `${headStr} · ${extra} more` : headStr;
}

function summarizeTableList(tables: string[]): string {
  if (tables.length === 0) return "no tables";
  const head = tables.slice(0, 3);
  const extra = tables.length - head.length;
  const headStr = head.join(" · ");
  return extra > 0 ? `${headStr} · ${extra} more` : headStr;
}

export function useNetTableEvents(): NetTableActivityState {
  const [status, setStatus] = useState<NetTableStatus | null>(null);
  const [entries, setEntries] = useState<NetTableActivityEntry[]>([]);
  const [state, setState] = useState<NetTableState>({});
  const [stateAt, setStateAt] = useState<string | null>(null);
  const [launchOptionsApplied, setLaunchOptionsApplied] =
    useState<NetTableLaunchOptionsApplied | null>(null);
  const [launchOptionsProgress, setLaunchOptionsProgress] = useState<string | null>(null);
  const [resyncProgress, setResyncProgress] = useState<string | null>(null);

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
              launch_options: msg.launch_options ?? null,
              has_condebug: msg.has_condebug ?? null,
              has_conclearlog: msg.has_conclearlog ?? null,
              has_gamestateintegration: msg.has_gamestateintegration ?? null,
              steam_running: msg.steam_running,
              dota_running: msg.dota_running,
              log_active: msg.log_active,
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
                title: "Dota started but tracking isn't active",
                detail:
                  "console.log isn't being written. Click 'Set them for me' to add -condebug -conclearlog and relaunch Dota.",
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
            detail: msg.path,
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
        case "nettable_launch_options_applied": {
          const { type: _type, ...rest } = msg;
          setLaunchOptionsApplied(rest);
          setLaunchOptionsProgress(null);
          if (rest.ok && !rest.noop) {
            push({
              kind: "nettable_ingest_complete",
              title: "Launch options updated",
              detail: `Added ${(rest.added ?? []).join(" ")} — restart Steam, then Dota.`,
              tone: "success",
            });
          } else if (!rest.ok) {
            push({
              kind: "nettable_ingest_error",
              title: "Couldn't update launch options",
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
    launchOptionsApplied,
    launchOptionsProgress,
    resyncProgress,
  };
}
