import { useEffect, useState } from "react";
import { capture } from "../lib/posthog";
import type { TrackerStatus } from "../types";

interface SettingsTabProps {
  status: TrackerStatus | null;
}

export function SettingsTab({ status }: SettingsTabProps) {
  const [version, setVersion] = useState("\u2014");
  const [loggingIn, setLoggingIn] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackState, setFeedbackState] = useState<"idle" | "sent">("idle");

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
  const backendStatus = status ? "Connected" : "Disconnected";
  const feedbackText = feedback.trim();

  const sendCommand = (cmd: Record<string, unknown>) => {
    window.tracker.sendCommand(cmd);
  };

  const submitFeedback = () => {
    if (!feedbackText) return;
    capture("feedback_submitted", {
      feedback: feedbackText,
      app_version: version,
      steam_id: status?.steam_id ?? null,
      steam_name: status?.steam_name ?? null,
    });
    setFeedback("");
    setFeedbackState("sent");
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
          <div className="settings-section-title">Feedback</div>
          <div className="settings-feedback">
            <label className="settings-feedback-label" htmlFor="settings-feedback-input">
              Tell us what is broken, confusing, or missing.
            </label>
            <textarea
              id="settings-feedback-input"
              className="settings-feedback-input"
              value={feedback}
              maxLength={1200}
              placeholder="Example: Queen upload worked, but I could not tell if tracking was setup."
              onChange={(event) => {
                setFeedback(event.target.value);
                if (feedbackState !== "idle") setFeedbackState("idle");
              }}
            />
            <div className="settings-feedback-actions">
              <span className="settings-feedback-status">
                {feedbackState === "sent"
                  ? "Thanks — feedback sent."
                  : "Sent through PostHog with your Steam ID so we can follow up."}
              </span>
              <button
                className="btn-ghost"
                type="button"
                disabled={!feedbackText}
                onClick={submitFeedback}
              >
                Send feedback
              </button>
            </div>
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
