import { useEffect, useRef, useCallback, useState } from "react";
import type { TrackerEvent, TrackerStatus, ParseResult, LogEntry } from "../types";

const MAX_LOG_ENTRIES = 500;

interface TrackerState {
  status: TrackerStatus | null;
  pendingParseResult: ParseResult | null;
  clearParseResult: () => void;
  logEntries: LogEntry[];
}

export function useTrackerEvents(
  onImportResult?: () => void,
  onReplaySaved?: () => void
): TrackerState {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [pendingParseResult, setPendingParseResult] =
    useState<ParseResult | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const callbacksRef = useRef({ onImportResult, onReplaySaved });
  callbacksRef.current = { onImportResult, onReplaySaved };

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
          break;
        case "import_result":
          setPendingParseResult(null);
          callbacksRef.current.onImportResult?.();
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
          break;
      }
    });

    window.tracker.sendCommand({ cmd: "status" });

    return unsubscribe;
  }, []);

  const clearParseResult = useCallback(() => {
    setPendingParseResult(null);
  }, []);

  return { status, pendingParseResult, clearParseResult, logEntries };
}
