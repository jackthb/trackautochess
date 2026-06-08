import type { UnitFullInfo, SynergyInfo, RelicInfo, ItemFullInfo } from "../types";
import type { NetTableActivityState, NetTableState } from "../hooks/useNetTableEvents";
import { NetTableSetupCard } from "./NetTableSetupCard";
import { NetTableStatePanel } from "./NetTableStatePanel";
import { LiveMatchStatus } from "./LiveMatchStatus";

interface NetTableHomeProps {
  /** Loaded units_full.json — forwarded to NetTableStatePanel for chess code lookup */
  unitsFull: Record<string, UnitFullInfo>;
  /** Loaded synergies.json — forwarded to LiveMatchStatus for activation tiers */
  synergiesData: Record<string, SynergyInfo>;
  /** Loaded relics.json — forwarded to LiveMatchStatus to resolve relic codes */
  relicsData: Record<string, RelicInfo>;
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
  relicsData,
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
    // (round derived from `state` below)
    launchOptionsApplied,
    launchOptionsProgress,
    resyncProgress,
    queenUpload,
    queenUploadProgress,
  } = netTable;
  // Live debug view — always on for the local player. Renders nothing
  // until a capture lands, so it's harmless before the first dump arrives.

  const round = currentRound(state);

  return (
    <div className="nettable-home">
      <LiveMatchStatus
        players={livePlayers}
        localSteamIds={localSteamIds}
        round={round}
        unitsFull={unitsFull}
        synergiesData={synergiesData}
        relicsData={relicsData}
        itemsFull={itemsFull}
      />

      <div className="nettable-home-grid">
        <div className="nettable-home-setup">
          <NetTableSetupCard
            status={netStatus}
            lastApply={launchOptionsApplied}
            progress={launchOptionsProgress}
            resyncProgress={resyncProgress}
            queenUpload={queenUpload}
            queenUploadProgress={queenUploadProgress}
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

/** Current game round from the live `game_info.round_info` capture. */
function currentRound(state: NetTableState): number | undefined {
  const roundInfo = state["CustomNetTable_game_info"]?.["round_info"] as
    | { round?: unknown }
    | undefined;
  return typeof roundInfo?.round === "number" ? roundInfo.round : undefined;
}
