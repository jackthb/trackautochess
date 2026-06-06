import { useCallback, useEffect, useState } from "react";
import { capture } from "../lib/posthog";
import type {
  NetTableLaunchOptionsApplied,
  NetTableQueenUploadResult,
  NetTableStatus,
} from "../hooks/useNetTableEvents";

interface NetTableSetupCardProps {
  status: NetTableStatus | null;
  lastApply: NetTableLaunchOptionsApplied | null;
  progress: string | null;
  resyncProgress: string | null;
  queenUpload: NetTableQueenUploadResult | null;
  queenUploadProgress: string | null;
}

// Internal Dota integration flags applied by the backend. Keep these out of
// user-facing copy; the UI should describe setup state, not implementation.
const REQUIRED_FLAGS = ["-condebug", "-conclearlog", "-gamestateintegration"];

/**
 * Setup card driven by **empirical** signals, not config parsing.
 *
 * The old card checked `localconfig.vdf` for `-condebug` / `-conclearlog`
 * and trusted what it found. Steam Cloud reverts that file, the cvar
 * parser races against Steam's writes, and the result is a card that
 * lies about state. So we lean on what's actually observable:
 *
 *   - `autoexec.cfg` installed on disk     (real, we wrote it ourselves)
 *   - Dota running right now                (process check)
 *   - `console.log` actively being written  (mtime within window) ← the
 *     real proof `-condebug` is doing its job
 *
 * The config-derived flags (`has_condebug`, etc.) are still emitted by
 * the backend and used to know whether Apply has work to do, but they
 * don't drive the user-visible status badges any more.
 */
export function NetTableSetupCard({
  status,
  lastApply,
  progress,
  resyncProgress,
  queenUpload,
  queenUploadProgress,
}: NetTableSetupCardProps) {
  const [applying, setApplying] = useState(false);
  const [uploadingQueens, setUploadingQueens] = useState(false);

  const applyLaunchOptions = useCallback(() => {
    if (!window.tracker) return;
    setApplying(true);
    window.tracker.sendCommand({
      cmd: "nettable_apply_launch_options",
      flags: REQUIRED_FLAGS,
    });
  }, []);

  const resyncFromSteam = useCallback(() => {
    if (!window.tracker) return;
    window.tracker.sendCommand({ cmd: "nettable_resync_from_steam" });
  }, []);

  const uploadQueens = useCallback(() => {
    if (!window.tracker) return;
    setUploadingQueens(true);
    window.tracker.sendCommand({ cmd: "nettable_upload_queens" });
    capture("queen_ladder_manual_upload_clicked", {});
  }, []);

  const resyncing = resyncProgress !== null;

  // Clear the local applying flag once a result lands.
  useEffect(() => {
    if (lastApply) setApplying(false);
  }, [lastApply]);

  useEffect(() => {
    if (queenUpload) setUploadingQueens(false);
  }, [queenUpload]);

  const autoexecOk = status?.autoexec_installed === true;
  const dotaRunning = status?.dota_running === true;
  const logActive = status?.log_active === true;

  const flagsKnown = status?.has_condebug !== null;
  const condebugSet = status?.has_condebug === true;
  const conclearlogSet = status?.has_conclearlog === true;
  const gsiSet = status?.has_gamestateintegration === true;
  const flagsSet = condebugSet && conclearlogSet && gsiSet;
  // Empirical signal trumps config-derived signal: Steam doesn't flush
  // localconfig.vdf to disk until it exits, so `flagsSet` can be stale
  // while Steam is running. If `log_active` is true, the flags ARE
  // working right now — don't pester the user to "set them for me".
  const needsApply = flagsKnown && !flagsSet && !logActive;

  // "All good" requires:
  //   - autoexec installed AND
  //   - Either Dota is running with -condebug verifiably working
  //     (empirical: console.log is being written), OR
  //   - Dota isn't running but config says the flags are set (will work
  //     when launched).
  // Crucially: if Dota isn't running AND flags aren't confirmed set in
  // localconfig, we are NOT done — don't pretend we are.
  const paused = status?.paused === true;
  const remoteEnabled = status?.remote_enabled !== false;
  const tracking = dotaRunning && logActive;
  const allOk = Boolean(
    status && remoteEnabled && autoexecOk && (tracking || (!dotaRunning && flagsSet)),
  );
  const notSetup = Boolean(status && remoteEnabled && (!autoexecOk || needsApply));
  const cantTell = !status || Boolean(status && remoteEnabled && !allOk && !notSetup);

  const togglePause = useCallback(() => {
    if (!window.tracker) return;
    window.tracker.sendCommand({ cmd: "nettable_set_paused", paused: !paused });
    capture("recording_toggled", { paused: !paused });
  }, [paused]);

  if (status && !remoteEnabled) {
    return (
      <div className="nettable-status-disabled" role="status" aria-live="polite">
        <div className="nettable-status-disabled-badge">
          <span className="nettable-status-disabled-dot" aria-hidden="true" />
          Disabled
        </div>
        <div className="nettable-status-disabled-copy">
          Game tracking is currently turned off remotely. Dota setup and logs can still be checked,
          but live capture will not run until tracking is re-enabled.
        </div>
        <QueenUploadControl
          uploading={uploadingQueens}
          progress={queenUploadProgress}
          result={queenUpload}
          onUpload={uploadQueens}
        />
      </div>
    );
  }

  if (allOk) {
    const statusLabel = paused ? "Paused" : tracking ? "Capturing" : "Ready";
    return (
      <div className="nettable-status-row">
        <div className={`nettable-setup-complete${paused ? " paused" : ""}`}>
          <span className={`nettable-setup-complete-dot${paused ? " paused" : ""}`} aria-hidden="true" />
          {statusLabel}
        </div>
        <button type="button" className="btn-ghost nettable-pause-btn" onClick={togglePause}>
          {paused ? "Resume" : "Pause"}
        </button>
        <QueenUploadControl
          uploading={uploadingQueens}
          progress={queenUploadProgress}
          result={queenUpload}
          onUpload={uploadQueens}
          compact
        />
      </div>
    );
  }

  const buttonLabel = applying ? "Setting up…" : "Set up automatically";
  const setupTitle = notSetup ? "Not setup" : "Can't tell if setup is complete";
  const setupDetail = notSetup
    ? "Run automatic setup, then restart Dota."
    : "Try a practice lobby and play one round. If no live data appears, run automatic setup and restart Dota.";

  return (
    <div className="nettable-setup-card">
      <div className="nettable-setup-header">Setup</div>

      <div className="nettable-setup-step">
        <div className={`nettable-setup-summary${notSetup ? " not-setup" : " unknown"}`}>
          <div className="nettable-setup-summary-title">{setupTitle}</div>
          <div className="nettable-setup-summary-detail">{setupDetail}</div>
        </div>
        {(notSetup || cantTell) && (
          <div className="nettable-setup-apply">
            <button
              type="button"
              className={`btn-ghost${applying ? " btn-loading" : ""}`}
              onClick={applyLaunchOptions}
              disabled={applying}
              title="We close Steam, update the Dota setup, then you restart Steam + Dota."
            >
              {buttonLabel}
            </button>
            <span className="nettable-setup-apply-note">
              {applying && progress
                ? progress
                : "We close Steam, update Dota setup, then you restart Steam + Dota."}
            </span>
          </div>
        )}
        {lastApply && !lastApply.ok && (
          <div className="nettable-setup-apply-error">{lastApply.error}</div>
        )}
        {lastApply && lastApply.ok && (lastApply.added ?? []).length > 0 && (
          <div className="nettable-setup-apply-success">
            Setup updated. Restart Steam, then Dota.
          </div>
        )}
        <QueenUploadControl
          uploading={uploadingQueens}
          progress={queenUploadProgress}
          result={queenUpload}
          onUpload={uploadQueens}
        />
      </div>

      <div className="nettable-setup-status-row">
        <span className="nettable-setup-status-label">Dota</span>
        <StatusBadge
          ok={dotaRunning}
          unknown={status === null}
          okLabel={logActive ? "capturing" : "running — try practice lobby"}
          badLabel="not running"
        />
      </div>

      {status?.steam_running && (
        <div className="nettable-setup-resync">
          <button
            type="button"
            className={`nettable-setup-resync-link${resyncing ? " is-busy" : ""}`}
            onClick={resyncFromSteam}
            disabled={resyncing}
            title="Quits Steam so we can re-check setup"
          >
            {resyncing
              ? (resyncProgress ?? "Re-syncing…")
              : "Re-check setup (quits Steam)"}
          </button>
        </div>
      )}
    </div>
  );
}

function QueenUploadControl({
  uploading,
  progress,
  result,
  onUpload,
  compact = false,
}: {
  uploading: boolean;
  progress: string | null;
  result: NetTableQueenUploadResult | null;
  onUpload: () => void;
  compact?: boolean;
}) {
  const resultText = result
    ? result.ok
      ? `Uploaded ${result.upserted_count}/${result.player_count} Queens.`
      : result.error ?? "Upload failed."
    : null;
  return (
    <div className={`nettable-queen-upload${compact ? " compact" : ""}`}>
      <button
        type="button"
        className={`btn-ghost${uploading ? " btn-loading" : ""}`}
        onClick={onUpload}
        disabled={uploading}
      >
        {uploading ? "Uploading Queens…" : "Upload Queens now"}
      </button>
      {(progress || resultText) && (
        <span className={`nettable-queen-upload-note${result && !result.ok ? " error" : ""}`}>
          {progress ?? resultText}
        </span>
      )}
    </div>
  );
}

function StatusBadge({
  ok,
  unknown,
  okLabel = "installed",
  badLabel = "missing",
}: {
  ok: boolean;
  unknown: boolean;
  okLabel?: string;
  badLabel?: string;
}) {
  if (unknown) {
    return (
      <span className="nettable-status-badge unknown">
        <span className="nettable-status-mark" aria-hidden="true">
          ?
        </span>
        checking
      </span>
    );
  }
  if (ok) {
    return (
      <span className="nettable-status-badge ok">
        <span className="nettable-status-mark" aria-hidden="true">
          ✓
        </span>
        {okLabel}
      </span>
    );
  }
  return (
    <span className="nettable-status-badge bad">
      <span className="nettable-status-mark" aria-hidden="true">
        ✗
      </span>
      {badLabel}
    </span>
  );
}
