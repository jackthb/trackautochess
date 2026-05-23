import type { TrackerStatus } from "../types";

interface StatusBarProps {
  status: TrackerStatus | null;
}

export function StatusBar({ status }: StatusBarProps) {
  const backendConnected = status !== null;
  // PARKED — replay recording indicator. Restore alongside the replay UI in App.tsx.
  // const recording = status?.recording ?? false;

  return (
    <div className="status-bar">
      <div className="status-indicator">
        <div
          className={`status-dot ${backendConnected ? "active" : ""}`}
        />
        <span>
          {backendConnected
            ? `Backend: v${status.version || "?"}`
            : "Backend: connecting..."}
        </span>
      </div>
      {/* PARKED — replay recording indicator.
      <div className="status-indicator">
        <div
          className={`status-dot ${recording ? "recording" : ""}`}
        />
        <span>{recording ? "Recording" : "Not recording"}</span>
      </div>
      */}
    </div>
  );
}
