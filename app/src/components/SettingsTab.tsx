import { useEffect, useState } from "react";
import type { TrackerStatus, ReplayStats } from "../types";

interface SettingsTabProps {
  status: TrackerStatus | null;
  replayStats: ReplayStats;
}

export function SettingsTab({ status, replayStats }: SettingsTabProps) {
  const [version, setVersion] = useState("\u2014");
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    window.appApi.getVersion().then(setVersion);
  }, []);

  // Clear login loading when steam status changes
  useEffect(() => {
    if (status?.steam_name) setLoggingIn(false);
  }, [status?.steam_name]);

  const loggedIn = !!status?.steam_name;
  const steamName = status?.steam_name || "Not logged in";
  const steamId = status?.steam_id || "\u2014";
  const replayEnabled = status?.replay_enabled ?? true;
  const backendStatus = status ? "Connected" : "Disconnected";
  const storageUsed =
    replayStats.count > 0
      ? `${(replayStats.totalBytes / 1024 ** 3).toFixed(1)} GB (${replayStats.count} replays)`
      : "\u2014";

  const sendCommand = (cmd: Record<string, unknown>) => {
    window.tracker.sendCommand(cmd);
  };

  return (
    <div className="settings-tab">
      <div className="settings-container">
        <div className="settings-section">
          <div className="settings-section-title">Steam Account</div>
          <div className="settings-row">
            <span className="settings-label">Status</span>
            <span className="settings-value">{steamName}</span>
          </div>
          {loggedIn && (
            <div className="settings-row">
              <span className="settings-label">Steam ID</span>
              <span className="settings-value dim">{steamId}</span>
            </div>
          )}
          <div className="settings-row">
            <span className="settings-label" />
            {loggedIn ? (
              <button
                className="btn-ghost"
                onClick={() => sendCommand({ cmd: "steam_logout" })}
              >
                Logout
              </button>
            ) : (
              <button
                className={`btn-ghost${loggingIn ? " btn-loading" : ""}`}
                disabled={loggingIn}
                onClick={() => {
                  setLoggingIn(true);
                  sendCommand({ cmd: "steam_login" });
                }}
              >
                {loggingIn ? "Logging in" : "Login with Steam"}
              </button>
            )}
          </div>
        </div>

        {/* PARKED — Replay Recording section. Restore alongside the Replays
            tab in App.tsx + TabBar.tsx.
        <div className="settings-section">
          <div className="settings-section-title">Replay Recording</div>
          <div className="settings-row">
            <span className="settings-label">Record replays</span>
            <button
              className="btn-ghost"
              onClick={() =>
                sendCommand({
                  cmd: "set_config",
                  key: "replay_enabled",
                  value: !replayEnabled,
                })
              }
            >
              {replayEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-label">Storage used</span>
            <span className="settings-value dim">{storageUsed}</span>
          </div>
        </div>
        */}

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
