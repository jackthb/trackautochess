import type { UnitFullInfo, SynergyInfo, ItemFullInfo } from "../types";
import type { NetTableActivityState } from "../hooks/useNetTableEvents";
import { NetTableSetupCard } from "./NetTableSetupCard";
import { NetTableStatePanel } from "./NetTableStatePanel";
import { LiveMatchStatus } from "./LiveMatchStatus";

interface NetTableHomeProps {
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
    state,
    stateAt,
    livePlayers,
    localSteamIds,
    launchOptionsApplied,
    launchOptionsProgress,
    resyncProgress,
  } = netTable;
  // Live debug view — always on for the local player. Renders nothing
  // until a capture lands, so it's harmless before the first dump arrives.

  return (
    <div className="nettable-home">
      <LiveMatchStatus
        players={livePlayers}
        localSteamIds={localSteamIds}
        unitsFull={unitsFull}
        synergiesData={synergiesData}
        itemsFull={itemsFull}
      />

      <div className="nettable-home-grid">
        <div className="nettable-home-setup">
          <NetTableSetupCard
            status={netStatus}
            lastApply={launchOptionsApplied}
            progress={launchOptionsProgress}
            resyncProgress={resyncProgress}
          />
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
