import { useCallback, useEffect, useMemo, useState } from "react";
import { parseNettableSynergyBuff } from "@dac/shared/game-structure";
import type { SynergyInfo } from "@dac/shared/types";
import { capture } from "../lib/posthog";
import type { LivePlayer } from "../backend-events";
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
  livePlayers?: Record<string, LivePlayer>;
  localSteamIds?: string[];
}

// Internal Dota integration flags applied by the backend. Keep these out of
// user-facing copy; the UI should describe setup state, not implementation.
const REQUIRED_FLAGS = [
  "-condebug",
  "-conclearlog",
  "-gamestateintegration",
];

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
  livePlayers = {},
  localSteamIds = [],
}: NetTableSetupCardProps) {
  const [applying, setApplying] = useState(false);
  const [uploadingQueens, setUploadingQueens] = useState(false);
  const [synergies, setSynergies] = useState<Record<string, SynergyInfo>>({});

  useEffect(() => {
    void window.appApi.fetchSynergies().then(setSynergies).catch(() => {});
  }, []);

  const localComp = useMemo(
    () => formatLocalComp(livePlayers, localSteamIds, synergies),
    [livePlayers, localSteamIds, synergies],
  );

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

  const checkActiveMatch = useCallback(() => {
    if (!window.tracker) return;
    window.tracker.sendCommand({ cmd: "nettable_check_active_match" });
    capture("nettable_check_active_match_clicked", {});
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
  const dotaFocused = status?.dota_focused === true;
  const flagsSet = condebugSet && conclearlogSet && gsiSet;
  // console.log activity alone does not prove capture can request dumps. Dota
  // must be focused so the app-owned dump binds go to Dota and not another app.
  const commandDeliveryReady = dotaRunning ? dotaFocused : flagsSet;
  const needsApply = flagsKnown && !flagsSet;

  // Setup is healthy when autoexec + launch flags are in place. Dump keys still
  // need Dota focused (Win32), but alt-tabbing / opening this app must not look
  // like broken setup — that's a normal mid-match pause that catches up on refocus.
  const remoteEnabled = status?.remote_enabled !== false;
  const tracking = dotaRunning && logActive && commandDeliveryReady;
  const waitingForFocus = Boolean(
    dotaRunning && autoexecOk && flagsSet && !dotaFocused,
  );
  const setupHealthy = Boolean(
    status &&
      remoteEnabled &&
      autoexecOk &&
      flagsSet &&
      (tracking || waitingForFocus || (!dotaRunning && flagsSet)),
  );
  const notSetup = Boolean(status && remoteEnabled && (!autoexecOk || needsApply));
  const cantTell = !status || Boolean(status && remoteEnabled && !setupHealthy && !notSetup);

  const closeApp = useCallback(() => {
    capture("app_close_clicked", { source: "setup_card" });
    window.windowControls?.close();
  }, []);

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
        <ActiveMatchControl onCheck={checkActiveMatch} />
        <QueenUploadControl
          uploading={uploadingQueens}
          progress={queenUploadProgress}
          result={queenUpload}
          onUpload={uploadQueens}
        />
      </div>
    );
  }

  if (setupHealthy) {
    const trackingDetail = formatTrackingDetail(status, localComp);
    const activelyTracking = tracking || waitingForFocus;
    const trackingLabel = activelyTracking
      ? trackingDetail
        ? `Tracking · ${trackingDetail}`
        : "Tracking in progress"
      : dotaRunning
        ? "Ready"
        : "Ready — start a match in Dota";
    // Focus loss is normal while reading this app — don't restyle as a warning.
    const trackingModifier = activelyTracking ? " tracking" : " paused";

    return (
      <div className="nettable-status-block">
        <div
          className={`nettable-setup-complete${trackingModifier}`}
          role="status"
          aria-live="polite"
        >
          <span
            className={`nettable-setup-complete-dot${trackingModifier}`}
            aria-hidden="true"
          />
          <span className="nettable-setup-complete-text">{trackingLabel}</span>
        </div>
        <div className="nettable-status-row">
          <ActiveMatchControl onCheck={checkActiveMatch} compact />
          <QueenUploadControl
            uploading={uploadingQueens}
            progress={queenUploadProgress}
            result={queenUpload}
            onUpload={uploadQueens}
            compact
          />
          <button
            type="button"
            className="btn-ghost nettable-pause-btn"
            onClick={closeApp}
            title="Close Track Auto Chess"
          >
            Close app
          </button>
        </div>
      </div>
    );
  }

  const buttonLabel = applying ? "Setting up…" : "Set up automatically";
  const setupTitle = notSetup ? "Setup needs update" : "Might be set up";
  const setupDetail = notSetup
    ? "Run automatic setup, then restart Dota."
    : "We've applied the Dota setup we can check. We can't confirm it is working until Dota is writing lobby data, so try a practice lobby.";

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
              className={`btn-ghost nettable-setup-apply-button${applying ? " btn-loading" : ""}`}
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
        {lastApply && lastApply.ok && (lastApply.added ?? []).length === 0 && (
          <div className="nettable-setup-apply-success">
            Setup already applied. Restart Steam, then Dota if live data still does not appear.
          </div>
        )}
        <ActiveMatchControl onCheck={checkActiveMatch} />
        <QueenUploadControl
          uploading={uploadingQueens}
          progress={queenUploadProgress}
          result={queenUpload}
          onUpload={uploadQueens}
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

function formatLocalComp(
  livePlayers: Record<string, LivePlayer>,
  localSteamIds: string[],
  synergiesData: Record<string, SynergyInfo>,
): string | null {
  const localId =
    localSteamIds.find((id) => livePlayers[id]) ??
    Object.keys(livePlayers)[0];
  const buff = localId ? livePlayers[localId]?.buff : undefined;
  if (!buff || Object.keys(synergiesData).length === 0) return null;
  const active = parseNettableSynergyBuff(buff, synergiesData, {
    activeOnly: true,
    includeOnePieceActive: false,
  });
  if (active.length === 0) return null;
  return active
    .slice(0, 4)
    .map((s) => `${s.count} ${s.name}`)
    .join(" · ");
}

function formatTrackingDetail(
  status: NetTableStatus | null,
  localComp: string | null,
): string | null {
  if (!status) return localComp;
  const parts: string[] = [];
  const first = status.first_round;
  const current = status.current_round;
  if (typeof first === "number" && typeof current === "number") {
    parts.push(
      first === current ? `round ${current}` : `rounds ${first}–${current}`,
    );
  } else if (typeof current === "number") {
    parts.push(`round ${current}`);
  }
  if (typeof status.players_alive === "number") {
    parts.push(`${status.players_alive} alive`);
  }
  if (localComp) parts.push(localComp);
  if (status.in_match && parts.length === 0) {
    parts.push("in match");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function ActiveMatchControl({
  onCheck,
  compact = false,
}: {
  onCheck: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`nettable-active-match-check${compact ? " compact" : ""}`}>
      <button
        type="button"
        className="btn-ghost nettable-active-match-button"
        onClick={onCheck}
        title="Unpauses live capture and requests a full Dota Auto Chess lobby snapshot."
      >
        Check active match
      </button>
      {!compact && (
        <span className="nettable-setup-apply-note">
          Use this after restarting or joining mid-game.
        </span>
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
        className={`btn-ghost nettable-queen-upload-button${uploading ? " btn-loading" : ""}`}
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

