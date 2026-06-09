import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../types";

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: "var(--text-muted)",
  INFO: "var(--text-secondary)",
  WARNING: "#e8a838",
  ERROR: "#e05555",
  CRITICAL: "#ff3333",
};

const SOURCE_COLORS: Record<string, string> = {
  tracker: "#7aa3d9",
  dota: "#d97a7a",
};

const MAX_DISPLAY_ENTRIES = 1000;

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

declare global {
  interface Window {
    trackerLog?: {
      read: () => Promise<LogEntry[]>;
      paths: () => Promise<{ tracker: string; dota: string | null }>;
      onUpdate: (callback: (entries: LogEntry[]) => void) => () => void;
    };
  }
}

export function LogTab() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [paths, setPaths] = useState<{ tracker: string; dota: string | null } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (!window.trackerLog) {
      setSourceError("window.trackerLog not available — preload may be stale (restart the app).");
      return;
    }
    let cancelled = false;

    window.trackerLog
      .paths()
      .then((value) => {
        if (!cancelled) setPaths(value);
      })
      .catch(() => {
        // Non-critical: log reading still works without displaying paths.
      });

    window.trackerLog
      .read()
      .then((initial) => {
        if (cancelled) return;
        setEntries(initial.slice(-MAX_DISPLAY_ENTRIES));
      })
      .catch((e) => {
        if (!cancelled) setSourceError(`Failed to read tracker.log: ${e?.message ?? e}`);
      });

    const unsubscribe = window.trackerLog.onUpdate((newEntries) => {
      setEntries((prev) => {
        const next = [...prev, ...newEntries];
        return next.length > MAX_DISPLAY_ENTRIES ? next.slice(-MAX_DISPLAY_ENTRIES) : next;
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScroll.current = atBottom;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflow: "auto",
        padding: "12px 16px",
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        fontSize: "12px",
        lineHeight: "1.6",
        background: "var(--bg-deep)",
        userSelect: "text",
        cursor: "text",
      }}
    >
      {sourceError && (
        <div style={{ color: "#e05555", padding: "8px 0" }}>{sourceError}</div>
      )}
      {entries.length === 0 && !sourceError && (
        <div style={{ color: "var(--text-muted)", padding: "20px 0" }}>
          tracker.log is empty.
        </div>
      )}
      {paths && (
        <div style={{ color: "var(--text-muted)", padding: "0 0 12px" }}>
          Tracker log: {paths.tracker}
          {paths.dota ? `\nDota log: ${paths.dota}` : ""}
        </div>
      )}
      {entries.map((entry, i) => {
        const source = entry.source ?? "tracker";
        if (!entry.msg?.trim()) return null;
        return (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <span style={{ color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
              {formatTime(entry.ts)}
            </span>
            <span
              style={{
                color: SOURCE_COLORS[source] || "var(--text-muted)",
                flexShrink: 0,
                width: "72px",
                whiteSpace: "nowrap",
              }}
            >
              [{source}]
            </span>
            <span
              style={{
                color: LEVEL_COLORS[entry.level] || "var(--text-secondary)",
                flexShrink: 0,
                width: "55px",
                whiteSpace: "nowrap",
              }}
            >
              {entry.level}
            </span>
            <span style={{ color: "var(--text-primary)", flex: 1, minWidth: 0 }}>
              {entry.msg}
            </span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
