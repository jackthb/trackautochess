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
  const flagsKnown = netStatus?.has_condebug !== null;
  const setupComplete = Boolean(
    netStatus &&
      netStatus.autoexec_installed &&
      (flagsKnown
        ? netStatus.has_condebug && netStatus.has_conclearlog
        : netStatus.log_writable),
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
