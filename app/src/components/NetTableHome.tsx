import type { TrackerStatus } from "../types";
import { useNetTableEvents } from "../hooks/useNetTableEvents";
import { NetTableSetupCard } from "./NetTableSetupCard";
import { NetTableActivityFeed } from "./NetTableActivityFeed";
import { NetTableStatePanel } from "./NetTableStatePanel";

interface NetTableHomeProps {
  status: TrackerStatus | null;
  isAdminPreview?: boolean;
  onExitAdminPreview?: () => void;
}

export function NetTableHome({
  status,
  isAdminPreview,
  onExitAdminPreview,
}: NetTableHomeProps) {
  const {
    status: netStatus,
    entries,
    state,
    stateAt,
    launchOptionsApplied,
    launchOptionsProgress,
    resyncProgress,
  } = useNetTableEvents();
  // Match the setup card's empirical "all good" calc: autoexec installed AND
  // (currently tracking OR Dota not running yet — i.e. nothing has falsified
  // the setup). Lets the layout collapse the setup card to a pill as soon as
  // we've got a green state.
  const tracking = Boolean(
    netStatus && netStatus.dota_running && netStatus.log_active,
  );
  const setupComplete = Boolean(
    netStatus &&
      netStatus.autoexec_installed &&
      (tracking || !netStatus.dota_running),
  );
  // The raw VBKV dump view is admin-only — pre-release debugging tool, not a
  // user-facing feature. Hide for everyone else, including admins previewing
  // as a regular user.
  const showStatePanel = status?.admin_mode === true && !isAdminPreview;

  return (
    <div className="nettable-home">
      <div className="nettable-home-header">
        <div>
          <div className="upload-eyebrow">DAC Tracker</div>
          <h1>Live capture</h1>
        </div>
        <div className="upload-user-group">
          {isAdminPreview && onExitAdminPreview && (
            <button
              type="button"
              className="upload-admin-toggle"
              onClick={onExitAdminPreview}
              title="Leave preview and return to the full admin view"
            >
              Admin view →
            </button>
          )}
          <div className="upload-user">
            <span>{status?.steam_name || "Steam user"}</span>
          </div>
        </div>
      </div>

      <div
        className={`nettable-home-grid ${setupComplete ? "setup-complete" : ""}`}
      >
        <div className="nettable-home-setup">
          <NetTableSetupCard
            status={netStatus}
            lastApply={launchOptionsApplied}
            progress={launchOptionsProgress}
            resyncProgress={resyncProgress}
          />
        </div>
        <div className="nettable-home-feed">
          <NetTableActivityFeed entries={entries} />
        </div>
        {showStatePanel && (
          <div className="nettable-home-state">
            <NetTableStatePanel state={state} stateAt={stateAt} />
          </div>
        )}
      </div>
    </div>
  );
}
