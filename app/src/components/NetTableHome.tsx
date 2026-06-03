import type { TrackerStatus, UnitFullInfo, SynergyInfo, ItemFullInfo } from "../types";
import type { NetTableActivityState } from "../hooks/useNetTableEvents";
import { NetTableSetupCard } from "./NetTableSetupCard";
import { NetTableActivityFeed } from "./NetTableActivityFeed";
import { NetTableDebugPanel } from "./NetTableDebugPanel";
import { NetTableStatePanel } from "./NetTableStatePanel";
import { LiveMatchStatus } from "./LiveMatchStatus";

interface NetTableHomeProps {
  status: TrackerStatus | null;
  /** Loaded units_full.json — forwarded to NetTableStatePanel for chess code lookup */
  unitsFull: Record<string, UnitFullInfo>;
  /** Loaded synergies.json — forwarded to LiveMatchStatus for activation tiers */
  synergiesData: Record<string, SynergyInfo>;
  itemsFull?: Record<string, ItemFullInfo>;
  /** Hoisted into App.tsx so the subscription + state survive tab switches —
   * otherwise the grid flickers between the "setup incomplete" and
   * "setup complete" layouts on every return to home. */
  netTable: NetTableActivityState;
  // PARKED — admin "Preview as user" toggle. Props kept so reviving the
  // dual-view code in App.tsx stays a one-line uncomment.
  isAdminPreview?: boolean;
  onExitAdminPreview?: () => void;
}

export function NetTableHome({
  status,
  unitsFull,
  synergiesData,
  itemsFull,
  netTable,
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
    state,
    stateAt,
    livePlayers,
    localSteamIds,
    launchOptionsApplied,
    launchOptionsProgress,
    resyncProgress,
    debug,
  } = netTable;
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
  // Live debug view — always on for the local player. Renders nothing
  // until a capture lands, so it's harmless before the first dump arrives.

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

      <LiveMatchStatus
        players={livePlayers}
        localSteamIds={localSteamIds}
        unitsFull={unitsFull}
        synergiesData={synergiesData}
        itemsFull={itemsFull}
      />

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
          <NetTableDebugPanel debug={debug} />
          <NetTableActivityFeed entries={entries} />
        </div>
        <div className="nettable-home-state">
          <NetTableStatePanel
            state={state}
            stateAt={stateAt}
            unitsFull={unitsFull}
            livePlayers={livePlayers}
            localSteamIds={localSteamIds}
            synergiesData={synergiesData}
          />
        </div>
      </div>
    </div>
  );
}
