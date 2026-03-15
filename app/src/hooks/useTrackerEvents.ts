import { useEffect, useRef, useState, useCallback } from "react";
import type { TrackerEvent, TrackerStatus, ParseResult } from "../types";

interface TrackerState {
  status: TrackerStatus | null;
  pendingParseResult: ParseResult | null;
  clearParseResult: () => void;
}

export function useTrackerEvents(
  onImportResult?: () => void,
  onReplaySaved?: () => void
): TrackerState {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [pendingParseResult, setPendingParseResult] =
    useState<ParseResult | null>(null);
  const registered = useRef(false);
  const callbacksRef = useRef({ onImportResult, onReplaySaved });
  callbacksRef.current = { onImportResult, onReplaySaved };

  useEffect(() => {
    if (registered.current || !window.tracker) return;
    registered.current = true;

    window.tracker.onEvent((msg: TrackerEvent) => {
      switch (msg.type) {
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
  }, []);

  const clearParseResult = useCallback(() => {
    setPendingParseResult(null);
  }, []);

  return { status, pendingParseResult, clearParseResult };
}
