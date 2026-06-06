import { useEffect, useState } from "react";
import { getPostHog } from "../lib/posthog";
import type { TrackerStatus } from "../types";

interface SettingsTabProps {
  status: TrackerStatus | null;
}

export function SettingsTab({ status }: SettingsTabProps) {
  const [version, setVersion] = useState("\u2014");
  const [loggingIn, setLoggingIn] = useState(false);
  const [surveyStatus, setSurveyStatus] = useState("Loading feedback survey...");

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

  const sendCommand = (cmd: Record<string, unknown>) => {
    window.tracker.sendCommand(cmd);
  };

  useEffect(() => {
    let cancelled = false;
    const selector = "#posthog-feedback-survey";
    const configuredSurveyId = import.meta.env.VITE_POSTHOG_FEEDBACK_SURVEY_ID?.trim();
    const properties = {
      app_version: version,
      steam_id: status?.steam_id ?? null,
      steam_name: status?.steam_name ?? null,
      source: "desktop_app_settings",
    };

    const renderSurvey = (surveyId: string) => {
      const container = document.querySelector(selector);
      if (!container || cancelled) return;
      container.innerHTML = "";
      void getPostHog().then((posthog) => {
        if (!posthog || cancelled) return;
        posthog.displaySurvey(surveyId, {
          displayType: "inline",
          selector,
          properties,
        });
        setSurveyStatus("");
      });
    };

    if (configuredSurveyId) {
      renderSurvey(configuredSurveyId);
      return () => {
        cancelled = true;
      };
    }

    void getPostHog().then((posthog) => {
      if (!posthog || cancelled) {
        if (!cancelled) setSurveyStatus("Feedback survey is not available in this build.");
        return;
      }
      posthog.getActiveMatchingSurveys((surveys, context) => {
        if (cancelled) return;
        const survey = surveys[0];
        if (survey?.id) {
          renderSurvey(survey.id);
          return;
        }
        setSurveyStatus(
          context?.error
            ? "Could not load the feedback survey."
            : "No feedback survey is active for this user yet.",
        );
      }, true);
    });

    return () => {
      cancelled = true;
    };
  }, [status?.steam_id, status?.steam_name, version]);

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
            <div id="posthog-feedback-survey" className="settings-feedback-survey" />
            {surveyStatus && <div className="settings-feedback-status">{surveyStatus}</div>}
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
