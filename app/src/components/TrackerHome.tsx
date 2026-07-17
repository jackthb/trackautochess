import { useEffect, useState } from "react";
import { Button } from "@dac/shared/Button";
import type { UnitFullInfo, TrackerStatus } from "../types";
import type { BackendCommand } from "../backend-events.generated";
import type { OutboxFlushedEvent } from "../backend-events";
import type { NetTableActivityState } from "../hooks/useNetTableEvents";
import { sendBackendRequest } from "../lib/backend-request";
import { isAdminSteamId } from "../lib/admin";
import { NetTableSetupCard } from "./NetTableSetupCard";
import { LegendaryPoolOverlay } from "./LegendaryPoolOverlay";

interface TrackerHomeProps {
  unitsFull: Record<string, UnitFullInfo>;
  netTable: NetTableActivityState;
  status: TrackerStatus | null;
}

/**
 * Single tracker screen: setup + account. Live match UI lives on the website;
 * admin-only legendary overlay stays desktop-side.
 */
export function TrackerHome({ unitsFull, netTable, status }: TrackerHomeProps) {
  const {
    status: netStatus,
    state,
    stateAt,
    launchOptionsApplied,
    launchOptionsProgress,
    resyncProgress,
    queenUpload,
    queenUploadProgress,
    pendingLeave,
  } = netTable;

  const [version, setVersion] = useState("\u2014");
  const [flushingOutbox, setFlushingOutbox] = useState(false);
  const [outboxStatus, setOutboxStatus] = useState<string | null>(null);
  const [outboxError, setOutboxError] = useState<string | null>(null);

  const steamId = status?.steam_id ?? null;
  const steamName = status?.steam_name || "Steam";
  const isAdmin = isAdminSteamId(steamId);

  useEffect(() => {
    window.appApi.getVersion().then(setVersion);
  }, []);

  const confirmMatchEnd = () => {
    window.tracker?.sendCommand({ cmd: "nettable_confirm_match_end" });
  };

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
          <div className="settings-section-title">Setup</div>
          <NetTableSetupCard
            status={netStatus}
            lastApply={launchOptionsApplied}
            progress={launchOptionsProgress}
            resyncProgress={resyncProgress}
            queenUpload={queenUpload}
            queenUploadProgress={queenUploadProgress}
          />
        </div>

        {pendingLeave && (
          <div className="settings-section">
            <div className="settings-section-title">Upload</div>
            <div className="settings-value dim" style={{ padding: "0 20px 12px", lineHeight: 1.45 }}>
              If the game is over and you're not rejoining, upload it now. Otherwise
              it uploads automatically at{" "}
              {new Date(pendingLeave.expiresAt).toLocaleTimeString()}.
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={confirmMatchEnd}
            >
              Game's over — upload now
            </button>
          </div>
        )}

        <div className="settings-section">
          <div className="settings-section-title">Steam Account</div>
          <div className="settings-row">
            <span className="settings-label">Status</span>
            <span className="settings-value">{steamName}</span>
          </div>
          {steamId && (
            <div className="settings-row">
              <span className="settings-label">Steam ID</span>
              <span className="settings-value dim">{steamId}</span>
            </div>
          )}
          <div className="settings-row">
            <span className="settings-label" />
            <button
              className="btn-ghost"
              onClick={() => sendCommand({ cmd: "steam_logout" })}
            >
              Logout
            </button>
          </div>
        </div>

        {isAdmin && (
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

      {isAdmin && (
        <LegendaryPoolOverlay
          state={state}
          stateAt={stateAt}
          unitsFull={unitsFull}
        />
      )}
    </div>
  );
}
