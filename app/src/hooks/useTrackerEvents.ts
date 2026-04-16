import { useEffect, useRef, useCallback, useState } from "react";
import type { TrackerEvent, TrackerStatus, ParseResult, LogEntry } from "../types";

const MAX_LOG_ENTRIES = 500;

export interface ImportResult {
  imported: number;
  skipped: number;
}

interface TrackerState {
  status: TrackerStatus | null;
  pendingParseResult: ParseResult | null;
  clearParseResult: () => void;
  lastImportResult: ImportResult | null;
  clearImportResult: () => void;
  logEntries: LogEntry[];
  importing: boolean;
  beginImport: () => void;
}

// Safety net: if the backend never replies, drop the busy flag eventually.
// Slightly longer than the backend's IMPORT_TIMEOUT_SEC (90s).
const IMPORT_SAFETY_TIMEOUT_MS = 100_000;

export function useTrackerEvents(
  onImportResult?: () => void,
  onReplaySaved?: () => void
): TrackerState {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [pendingParseResult, setPendingParseResult] =
    useState<ParseResult | null>(null);
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const importTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onImportResult, onReplaySaved });
  callbacksRef.current = { onImportResult, onReplaySaved };

  const clearImportTimer = useCallback(() => {
    if (importTimeoutRef.current) {
      clearTimeout(importTimeoutRef.current);
      importTimeoutRef.current = null;
    }
  }, []);

  const finishImport = useCallback(() => {
    clearImportTimer();
    setImporting(false);
  }, [clearImportTimer]);

  const beginImport = useCallback(() => {
    clearImportTimer();
    setImporting(true);
    importTimeoutRef.current = setTimeout(() => {
      importTimeoutRef.current = null;
      setImporting(false);
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
          setStatus(msg);
          break;
        case "parse_result":
          setPendingParseResult(msg);
          finishImport();
          break;
        case "import_result":
          setPendingParseResult(null);
          setLastImportResult({ imported: msg.imported, skipped: msg.skipped });
          finishImport();
          callbacksRef.current.onImportResult?.();
          break;
        case "import_finished":
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
        case "error":
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

  return {
    status,
    pendingParseResult,
    clearParseResult,
    lastImportResult,
    clearImportResult,
    logEntries,
    importing,
    beginImport,
  };
}
