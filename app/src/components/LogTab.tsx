import { useEffect, useRef } from "react";
import type { LogEntry } from "../types";

interface LogTabProps {
  entries: LogEntry[];
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: "var(--text-muted)",
  INFO: "var(--text-secondary)",
  WARNING: "#e8a838",
  ERROR: "#e05555",
  CRITICAL: "#ff3333",
};

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function LogTab({ entries }: LogTabProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

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
      }}
    >
      {entries.length === 0 && (
        <div style={{ color: "var(--text-muted)", padding: "20px 0" }}>
          Waiting for backend logs...
        </div>
      )}
      {entries.map((entry, i) => (
        <div key={i} style={{ display: "flex", gap: "10px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
            {formatTime(entry.ts)}
          </span>
          <span
            style={{
              color: LEVEL_COLORS[entry.level] || "var(--text-secondary)",
              flexShrink: 0,
              width: "55px",
            }}
          >
            {entry.level}
          </span>
          <span style={{ color: "var(--text-primary)" }}>{entry.msg}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
