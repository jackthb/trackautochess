import { useCallback, useEffect, useState } from "react";
import type {
  NetTableLaunchOptionsApplied,
  NetTableStatus,
} from "../hooks/useNetTableEvents";

interface NetTableSetupCardProps {
  status: NetTableStatus | null;
  lastApply: NetTableLaunchOptionsApplied | null;
  progress: string | null;
  resyncProgress: string | null;
}

const REQUIRED_FLAGS = ["-condebug", "-conclearlog"];
const LAUNCH_OPTIONS = REQUIRED_FLAGS.join(" ");

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
}: NetTableSetupCardProps) {
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(LAUNCH_OPTIONS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, []);

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

  const resyncing = resyncProgress !== null;

  // Clear the local applying flag once a result lands.
  useEffect(() => {
    if (lastApply) setApplying(false);
  }, [lastApply]);

  const autoexecOk = status?.autoexec_installed === true;
  const dotaRunning = status?.dota_running === true;
  const logActive = status?.log_active === true;

  const flagsKnown = status?.has_condebug !== null;
  const condebugSet = status?.has_condebug === true;
  const conclearlogSet = status?.has_conclearlog === true;
  const flagsSet = condebugSet && conclearlogSet;
  const needsApply = flagsKnown && !flagsSet;

  // "All good" requires:
  //   - autoexec installed AND
  //   - Either Dota is running with -condebug verifiably working
  //     (empirical: console.log is being written), OR
  //   - Dota isn't running but config says the flags are set (will work
  //     when launched).
  // Crucially: if Dota isn't running AND flags aren't confirmed set in
  // localconfig, we are NOT done — don't pretend we are.
  const tracking = dotaRunning && logActive;
  const allOk = Boolean(
    status && autoexecOk && (tracking || (!dotaRunning && flagsSet)),
  );

  if (allOk) {
    return (
      <div className="nettable-setup-complete">
        <span className="nettable-setup-complete-dot" aria-hidden="true" />
        {tracking
          ? "Tracking active"
          : "Setup complete — launch Dota when ready"}
      </div>
    );
  }

  const buttonLabel = applying ? "Working…" : "Set them for me";

  return (
    <div className="nettable-setup-card">
      <div className="nettable-setup-header">Setup</div>

      <div className="nettable-setup-step">
        <div className="nettable-setup-step-label">
          Dota 2 launch options need to include:
        </div>
        <div className="nettable-setup-launch">
          <code className="nettable-setup-code">{LAUNCH_OPTIONS}</code>
          <button
            type="button"
            className="btn-ghost"
            onClick={copy}
            title="Copy to clipboard"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {needsApply && (
          <div className="nettable-setup-apply">
            <button
              type="button"
              className={`btn-ghost${applying ? " btn-loading" : ""}`}
              onClick={applyLaunchOptions}
              disabled={applying}
              title="We close Steam, append the flags to your existing options, you relaunch Steam + Dota."
            >
              {buttonLabel}
            </button>
            <span className="nettable-setup-apply-note">
              {applying && progress
                ? progress
                : "We close Steam, edit the config, then relaunch Steam + Dota."}
            </span>
          </div>
        )}
        {lastApply && !lastApply.ok && (
          <div className="nettable-setup-apply-error">{lastApply.error}</div>
        )}
        {lastApply && lastApply.ok && (lastApply.added ?? []).length > 0 && (
          <div className="nettable-setup-apply-success">
            Added {(lastApply.added ?? []).join(" ")}. Restart Steam, then Dota.
          </div>
        )}
      </div>

      <div className="nettable-setup-status-row">
        <span className="nettable-setup-status-label">autoexec.cfg</span>
        <StatusBadge
          ok={autoexecOk}
          unknown={status === null}
          okLabel="installed"
          badLabel="missing"
        />
      </div>

      <div className="nettable-setup-status-row">
        <span className="nettable-setup-status-label">Dota running</span>
        <StatusBadge
          ok={dotaRunning}
          unknown={status === null}
          okLabel="running"
          badLabel="not running"
        />
      </div>

      <div className="nettable-setup-status-row">
        <span className="nettable-setup-status-label">tracking active</span>
        <StatusBadge
          ok={tracking}
          unknown={status === null || (!dotaRunning && !logActive)}
          okLabel="writing"
          badLabel={dotaRunning ? "missing -condebug" : "idle"}
        />
      </div>

      {status?.launch_options ? (
        <div className="nettable-setup-launch-detail" title={status.launch_options}>
          steam config: <code>{status.launch_options}</code>
        </div>
      ) : null}

      {status?.steam_running && (
        <div className="nettable-setup-resync">
          <button
            type="button"
            className={`nettable-setup-resync-link${resyncing ? " is-busy" : ""}`}
            onClick={resyncFromSteam}
            disabled={resyncing}
            title="Quits Steam so it flushes localconfig.vdf to disk, then we re-read it"
          >
            {resyncing
              ? (resyncProgress ?? "Re-syncing…")
              : "Re-sync from Steam (quits Steam)"}
          </button>
        </div>
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
