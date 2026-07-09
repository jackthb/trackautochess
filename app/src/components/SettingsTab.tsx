import { useEffect, useState } from "react";
import { Button } from "@dac/shared/Button";
import type { TrackerStatus } from "../types";
import type { BackendCommand } from "../backend-events.generated";
import type { OutboxFlushedEvent } from "../backend-events";
import { sendBackendRequest } from "../lib/backend-request";

interface SettingsTabProps {
  status: TrackerStatus | null;
}

export function SettingsTab({ status }: SettingsTabProps) {
  const [version, setVersion] = useState("\u2014");
  const [loggingIn, setLoggingIn] = useState(false);
  const [flushingOutbox, setFlushingOutbox] = useState(false);
  const [outboxStatus, setOutboxStatus] = useState<string | null>(null);
  const [outboxError, setOutboxError] = useState<string | null>(null);

  useEffect(() => {
    window.appApi.getVersion().then(setVersion);
  }, []);

  useEffect(() => {
    if (status?.logged_in) setLoggingIn(false);
  }, [status?.logged_in]);

  const loggedIn = !!status?.logged_in;
  const steamName = loggedIn ? status?.steam_name || "Steam" : "Not logged in";
  const steamId = status?.steam_id || "\u2014";

  const sendCommand = (cmd: BackendCommand) => {
    window.tracker.sendCommand(cmd);
  };

  const flushOutbox = async () => {
    setFlushingOutbox(true);
    setOutboxStatus(null);
    setOutboxError(null);
    try {
      const result = await sendBackendRequest<OutboxFlushedEvent>(
        { cmd: "flush_outbox" },
        { timeoutMs: 60_000 },
      );
      if (result.ok) {
        setOutboxStatus(
          result.pending === 0
            ? "No queued games"
            : `Uploaded ${result.uploaded} queued game${result.uploaded === 1 ? "" : "s"}`,
        );
      } else {
        setOutboxError(
          result.error ||
            `Uploaded ${result.uploaded}; ${result.failed} queued game${result.failed === 1 ? "" : "s"} still pending`,
        );
      }
    } catch (err) {
      setOutboxError(err instanceof Error ? err.message : "Failed to push queued games");
    } finally {
      setFlushingOutbox(false);
    }
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

        {loggedIn && (
          <div className="settings-section">
            <div className="settings-section-title">Sync</div>
            <div className="settings-row">
              <span className="settings-label">Queued uploads</span>
              <Button
                className={flushingOutbox ? "btn-loading" : undefined}
                disabled={flushingOutbox}
                onClick={flushOutbox}
              >
                {flushingOutbox ? "Pushing" : "Push queued"}
              </Button>
            </div>
            {outboxStatus && (
              <div className="settings-row">
                <span className="settings-label" />
                <span className="settings-value refresh-success">{outboxStatus}</span>
              </div>
            )}
            {outboxError && (
              <div className="settings-row">
                <span className="settings-label" />
                <span className="settings-value refresh-error">{outboxError}</span>
              </div>
            )}
          </div>
        )}

        <div className="settings-section">
          <div className="settings-section-title">About</div>
          <div className="settings-row">
            <span className="settings-label">Version</span>
            <span className="settings-value dim">{version}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
