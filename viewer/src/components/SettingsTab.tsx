import { useEffect, useState } from "react";
import type { TrackerStatus, ReplayStats } from "../types";

interface SettingsTabProps {
  status: TrackerStatus | null;
  replayStats: ReplayStats;
}

export function SettingsTab({ status, replayStats }: SettingsTabProps) {
  const [version, setVersion] = useState("\u2014");

  useEffect(() => {
    window.appApi.getVersion().then(setVersion);
  }, []);

  const steamName = status?.steam_name || "Not logged in";
  const steamId = status?.steam_id || "\u2014";
  const replayEnabled = status?.replay_enabled ?? true;
  const backendStatus = status ? "Connected" : "Disconnected";
  const storageUsed =
    replayStats.count > 0
      ? `${(replayStats.totalBytes / 1024 ** 3).toFixed(1)} GB (${replayStats.count} replays)`
      : "\u2014";

  return (
    <div className="settings-tab">
      <div className="settings-container">
        <div className="settings-section">
          <div className="settings-section-title">Steam Account</div>
          <div className="settings-row">
            <span className="settings-label">Status</span>
            <span className="settings-value">{steamName}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Steam ID</span>
            <span className="settings-value dim">{steamId}</span>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Replay Recording</div>
          <div className="settings-row">
            <span className="settings-label">Recording enabled</span>
            <span className="settings-value">
              {replayEnabled ? "Yes" : "No"}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Storage used</span>
            <span className="settings-value dim">{storageUsed}</span>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">About</div>
          <div className="settings-row">
            <span className="settings-label">Version</span>
            <span className="settings-value dim">{version}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Backend</span>
            <span className="settings-value">{backendStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
