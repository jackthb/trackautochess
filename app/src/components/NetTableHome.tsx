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
    lastGameEnded,
    pendingLeave,
  } = netTable;

  const confirmMatchEnd = () => {
    window.tracker?.sendCommand({ cmd: "nettable_confirm_match_end" });
  };
  // Live debug view — always on for the local player. Renders nothing
  // until a capture lands, so it's harmless before the first dump arrives.

  const round = currentRound(state);
  const hasCaptureData =
    round != null ||
    Object.keys(livePlayers).length > 0 ||
    Object.keys(state).length > 0;
  const emptyTitle = lastGameEnded ? "Match complete" : "Waiting for a live match";
  const emptyCopy = lastGameEnded
    ? lastGameEnded.message || "The last match has ended. Start another lobby to resume live capture."
    : "Start or join a Dota Auto Chess lobby, then keep Dota open while the tracker captures nettable updates.";

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

      {pendingLeave && (
        <section className="nettable-home-empty nettable-pending-leave" aria-live="polite">
          <div className="nettable-home-empty-title">You left the match early</div>
          <div className="nettable-home-empty-copy">
            If the game is over and you're not rejoining, upload it now with everyone's
            last-known standings. Rejoining the match cancels this; otherwise it uploads
            automatically at {new Date(pendingLeave.expiresAt).toLocaleTimeString()}.
          </div>
          <div className="nettable-home-empty-meta">
            <button
              type="button"
              className="btn-ghost nettable-pending-leave-confirm"
              onClick={confirmMatchEnd}
            >
              Game's over — upload now
            </button>
          </div>
        </section>
      )}

      {(!hasCaptureData || lastGameEnded) && (
        <section className="nettable-home-empty" aria-live="polite">
          <div className="nettable-home-empty-title">{emptyTitle}</div>
          <div className="nettable-home-empty-copy">{emptyCopy}</div>
          {lastGameEnded && (
            <div className="nettable-home-empty-meta">
              Ended {new Date(lastGameEnded.at).toLocaleTimeString()}
            </div>
          )}
        </section>
      )}

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
