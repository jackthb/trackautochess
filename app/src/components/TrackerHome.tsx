import { useEffect, useState } from "react";
import { Button } from "@dac/shared/Button";
import type { UnitFullInfo, TrackerStatus } from "../types";
import type { BackendCommand } from "../backend-events.generated";
import type { OutboxFlushedEvent } from "../backend-events";
import type { NetTableActivityState } from "../hooks/useNetTableEvents";
import { sendBackendRequest } from "../lib/backend-request";
import { NetTableSetupCard } from "./NetTableSetupCard";
import { LegendaryPoolOverlay } from "./LegendaryPoolOverlay";

interface TrackerHomeProps {
  unitsFull: Record<string, UnitFullInfo>;
  netTable: NetTableActivityState;
  status: TrackerStatus | null;
}

/**
 * Single tracker screen: status + account. Live match UI lives on the website;
 * the legendary popup is a Discord-styled always-on-top overlay.
 */
export function TrackerHome({ unitsFull, netTable, status }: TrackerHomeProps) {
  const {
    status: netStatus,
    state,
    stateAt,
    livePlayers,
    localSteamIds,
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
  const setupNeedsWork = Boolean(
    !netStatus ||
      netStatus.remote_enabled === false ||
      netStatus.autoexec_installed !== true ||
      netStatus.has_condebug !== true ||
      netStatus.has_conclearlog !== true ||
      netStatus.has_gamestateintegration !== true,
  );
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

  const autoUploadAt = pendingLeave
    ? new Date(pendingLeave.expiresAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="settings-tab">
      <div className="settings-container tracker-home">
        {pendingLeave && (
          <section className="tracker-pending" aria-label="Pending match upload">
            <div className="tracker-pending-copy">
              <div className="tracker-pending-title">Match ready to upload</div>
              <p className="tracker-pending-detail">
                Left the lobby early. Upload now, or it goes up automatically at{" "}
                {autoUploadAt}.
              </p>
            </div>
            <button
              type="button"
              className="tracker-pending-action"
              onClick={confirmMatchEnd}
            >
              Upload match
            </button>
          </section>
        )}

        <div className="settings-section">
          <div className="settings-section-title">
            {setupNeedsWork ? "Setup" : "Status"}
          </div>
          <NetTableSetupCard
            status={netStatus}
            lastApply={launchOptionsApplied}
            progress={launchOptionsProgress}
            resyncProgress={resyncProgress}
            queenUpload={queenUpload}
            queenUploadProgress={queenUploadProgress}
            livePlayers={livePlayers}
            localSteamIds={localSteamIds}
            showQueenUpload
          />
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Account</div>
          <div className="settings-row">
            <span className="settings-label">Steam</span>
            <span className="settings-value">{steamName}</span>
          </div>
          {steamId && (
            <div className="settings-row">
              <span className="settings-label">ID</span>
              <span className="settings-value dim">{steamId}</span>
            </div>
          )}
          <div className="settings-row">
            <span className="settings-label" />
            <button
              className="btn-ghost"
              onClick={() => sendCommand({ cmd: "steam_logout" })}
            >
              Log out
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Advanced</div>
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
          <div className="settings-row">
            <span className="settings-label">Legendary overlay</span>
            <span className="settings-value dim">Ctrl+Shift+L</span>
          </div>
          <div className="settings-row">
            <span className="settings-label" />
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void window.legendaryOverlay?.toggle()}
            >
              Toggle overlay
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">About</div>
          <div className="settings-row">
            <span className="settings-label">Version</span>
            <span className="settings-value dim">{version}</span>
          </div>
        </div>
      </div>

      <LegendaryPoolOverlay
        state={state}
        stateAt={stateAt}
        unitsFull={unitsFull}
        inMatch={netStatus?.in_match === true}
      />
    </div>
  );
}
