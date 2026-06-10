import { useEffect, useRef, useCallback, useState } from "react";
import type {
  ImportResultTone,
  TrackerEvent,
  TrackerStatus,
  ParseResult,
  ProcessingScreenshot,
  LogEntry,
} from "../types";

const MAX_LOG_ENTRIES = 500;

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  message?: string;
  tone?: ImportResultTone;
  screenType?: "my_matches" | "game_over" | "final_ranking" | "unknown";
  linkedToUser?: number;
  profileUrl?: string;
  matchId?: string;
  screenshotUrl?: string;
  gameId?: number;
  matchUrl?: string;
}

export interface ImportProgress {
  progress: number;
  message?: string;
}

interface TrackerState {
  status: TrackerStatus | null;
  processingScreenshot: ProcessingScreenshot | null;
  pendingParseResult: ParseResult | null;
  clearParseResult: () => void;
  lastImportResult: ImportResult | null;
  clearImportResult: () => void;
  authError: string | null;
  clearAuthError: () => void;
  logEntries: LogEntry[];
  importing: boolean;
  importProgress: ImportProgress | null;
  beginImport: () => void;
}

// Safety net: if the backend never replies, drop the busy flag eventually.
// Slightly longer than the backend's IMPORT_TIMEOUT_SEC (90s).
const IMPORT_SAFETY_TIMEOUT_MS = 100_000;

function cleanSteamName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

export function useTrackerEvents(
  onImportResult?: () => void,
  onReplaySaved?: () => void,
  onMatchSaved?: () => void
): TrackerState {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [processingScreenshot, setProcessingScreenshot] =
    useState<ProcessingScreenshot | null>(null);
  const [pendingParseResult, setPendingParseResult] =
    useState<ParseResult | null>(null);
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const importTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onImportResult, onReplaySaved, onMatchSaved });
  callbacksRef.current = { onImportResult, onReplaySaved, onMatchSaved };

  const clearImportTimer = useCallback(() => {
    if (importTimeoutRef.current) {
      clearTimeout(importTimeoutRef.current);
      importTimeoutRef.current = null;
    }
  }, []);

  const finishImport = useCallback(() => {
    clearImportTimer();
    setImporting(false);
    setImportProgress(null);
  }, [clearImportTimer]);

  const beginImport = useCallback(() => {
    clearImportTimer();
    setImporting(true);
    setImportProgress({ progress: 0 });
    importTimeoutRef.current = setTimeout(() => {
      importTimeoutRef.current = null;
      setImporting(false);
      setImportProgress(null);
    }, IMPORT_SAFETY_TIMEOUT_MS);
  }, [clearImportTimer]);

  useEffect(() => {
    if (!window.tracker) return;

    const unsubscribe = window.tracker.onEvent((msg: TrackerEvent) => {
      switch (msg.type) {
        case "log":
          setLogEntries((prev) => {
            const next = [...prev, msg];
            return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
          });
          break;
        case "status":
          setStatus((prev) => ({
            type: "status",
            recording: msg.recording,
            focused: msg.focused,
            version: prev?.version ?? "",
            admin_mode: prev?.admin_mode ?? false,
            recording_stats: prev?.recording_stats ?? null,
            logged_in: msg.logged_in,
            steam_id: msg.steam_id,
            steam_name: cleanSteamName(msg.steam_name),
            replay_enabled: msg.replay_enabled,
          }));
          if (msg.logged_in) {
            setAuthError(null);
          }
          break;
        case "steam_login":
          setAuthError(null);
          setStatus((prev) => ({
            type: "status",
            recording: prev?.recording ?? false,
            focused: prev?.focused ?? false,
            version: prev?.version ?? "",
            replay_enabled: prev?.replay_enabled ?? true,
            recording_stats: prev?.recording_stats ?? null,
            admin_mode: prev?.admin_mode ?? false,
            logged_in: true,
            steam_id: msg.steam_id,
            steam_name: cleanSteamName(msg.steam_name),
          }));
          break;
        case "steam_logout":
          setStatus((prev) => prev ? { ...prev, logged_in: false, steam_id: "", steam_name: "" } : prev);
          break;
        case "processing_screenshot":
          setProcessingScreenshot(msg);
          break;
        case "import_progress":
          setImportProgress({
            progress: Math.max(0, Math.min(100, msg.progress)),
            message: msg.message,
          });
          break;
        case "parse_result":
          setProcessingScreenshot(null);
          setPendingParseResult(msg);
          finishImport();
          break;
        case "import_result":
          setProcessingScreenshot(null);
          setPendingParseResult(null);
          setLastImportResult({
            imported: msg.imported,
            skipped: msg.skipped,
            failed: msg.failed ?? 0,
            message: msg.message,
            tone: msg.tone,
            screenType: msg.screen_type,
            linkedToUser: msg.linked_to_user,
            profileUrl: msg.profile_url,
            matchId: msg.match_id,
            screenshotUrl: msg.screenshot_url,
            gameId: msg.game_id,
            matchUrl: msg.match_url,
          });
          finishImport();
          callbacksRef.current.onImportResult?.();
          break;
        case "import_finished":
          setProcessingScreenshot(null);
          finishImport();
          break;
        case "focus_gained":
          setStatus((prev) => prev ? { ...prev, focused: true } : prev);
          break;
        case "focus_lost":
          setStatus((prev) => prev ? { ...prev, focused: false } : prev);
          break;
        case "replay_started":
          setStatus((prev) => prev ? { ...prev, recording: true } : prev);
          break;
        case "replay_saved":
          setStatus((prev) => prev ? { ...prev, recording: false } : prev);
          callbacksRef.current.onReplaySaved?.();
          break;
        case "nettable_end_board_saved":
          callbacksRef.current.onMatchSaved?.();
          break;
        case "error":
          setProcessingScreenshot(null);
          if (msg.message?.toLowerCase().includes("steam_login failed")) {
            setAuthError(msg.message);
          }
          if (msg.message?.includes("exited")) {
            setStatus((prev) =>
              prev ? { ...prev, type: "status" } : prev
            );
          }
          // Most error paths in the backend already emit import_finished,
          // but clear the busy flag here too so the UI never sticks.
          finishImport();
          break;
      }
    });

    window.tracker.sendCommand({ cmd: "status" });

    return () => {
      unsubscribe();
      clearImportTimer();
    };
  }, [finishImport, clearImportTimer]);

  const clearParseResult = useCallback(() => {
    setPendingParseResult(null);
  }, []);

  const clearImportResult = useCallback(() => {
    setLastImportResult(null);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  return {
    status,
    processingScreenshot,
    pendingParseResult,
    clearParseResult,
    lastImportResult,
    clearImportResult,
    authError,
    clearAuthError,
    logEntries,
    importing,
    importProgress,
    beginImport,
  };
}
