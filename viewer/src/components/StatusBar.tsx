import type { TrackerStatus } from "../types";

interface StatusBarProps {
  status: TrackerStatus | null;
}

export function StatusBar({ status }: StatusBarProps) {
  const backendConnected = status !== null;
  const recording = status?.recording ?? false;
  const focused = status?.focused ?? false;

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
      <div className="status-indicator">
        <div
          className={`status-dot ${recording ? "recording" : ""}`}
        />
        <span>{recording ? "Recording" : "Not recording"}</span>
      </div>
      <div className="status-indicator">
        <div className={`status-dot ${focused ? "active" : ""}`} />
        <span>{focused ? "Dota: active" : "Dota: inactive"}</span>
      </div>
    </div>
  );
}
