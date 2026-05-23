import type { TrackerStatus } from "../types";
import { useNetTableEvents } from "../hooks/useNetTableEvents";
import { NetTableSetupCard } from "./NetTableSetupCard";
import { NetTableActivityFeed } from "./NetTableActivityFeed";
import { NetTableStatePanel } from "./NetTableStatePanel";

interface NetTableHomeProps {
  status: TrackerStatus | null;
  // PARKED — admin "Preview as user" toggle. Props kept so reviving the
  // dual-view code in App.tsx stays a one-line uncomment.
  isAdminPreview?: boolean;
  onExitAdminPreview?: () => void;
}

export function NetTableHome({
  status,
  isAdminPreview,
  onExitAdminPreview,
}: NetTableHomeProps) {
  // Suppress unused-prop noise; both are intentionally retained for the
  // parked admin-preview flow.
  void isAdminPreview;
  void onExitAdminPreview;
  const {
    status: netStatus,
    entries,
    // PARKED with the admin state panel below.
    // state,
    // stateAt,
    launchOptionsApplied,
    launchOptionsProgress,
    resyncProgress,
  } = useNetTableEvents();
  // Match the setup card's "all good" calc — kept in sync with
  // NetTableSetupCard.tsx. Pill only collapses when we have positive
  // evidence the setup will work: either tracking is empirically active,
  // or Dota isn't running yet AND launch options are confirmed set.
  const tracking = Boolean(
    netStatus && netStatus.dota_running && netStatus.log_active,
  );
  const flagsSet = Boolean(
    netStatus &&
      netStatus.has_condebug === true &&
      netStatus.has_conclearlog === true &&
      netStatus.has_gamestateintegration === true,
  );
  const setupComplete = Boolean(
    netStatus &&
      netStatus.autoexec_installed &&
      (tracking || (!netStatus.dota_running && flagsSet)),
  );
  // PARKED — the raw VBKV dump was an admin-only debugging panel. Hidden
  // in the unified view so the home tab renders identically for everyone.
  // const showStatePanel = status?.admin_mode === true && !isAdminPreview;

  return (
    <div className="nettable-home">
      <div className="nettable-home-header">
        <div>
          <div className="upload-eyebrow">DAC Tracker</div>
          <h1>Live capture</h1>
        </div>
        <div className="upload-user-group">
          {/* PARKED — "Admin view →" button. Re-render alongside the admin
              preview toggle in App.tsx.
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
          */}
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
        {/* PARKED — admin debug state panel.
        {showStatePanel && (
          <div className="nettable-home-state">
            <NetTableStatePanel state={state} stateAt={stateAt} />
          </div>
        )}
        */}
      </div>
    </div>
  );
}
