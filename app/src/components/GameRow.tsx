import { useEffect, useState } from "react";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { Game, RelicInfo, SynergyInfo, UnitFullInfo, ItemFullInfo } from "../types";
import { placementBg } from "../lib/game-utils";
import { MatchTimelinePanel } from "./MatchTimelinePanel";
import { VideoPlayer } from "./VideoPlayer";

interface GameRowProps {
  game: Game;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  itemsFull: Record<string, ItemFullInfo>;
  expanded: boolean;
  onToggle: () => void;
}

export function GameRow({
  game,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  itemsFull,
  expanded,
  onToggle,
}: GameRowProps) {
  const [replayExists, setReplayExists] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const placement = parseInt(game.placement) || 0;

  useEffect(() => {
    if (!game.replay) {
      setReplayExists(false);
      return;
    }
    window.replays.exists(game.replay).then(setReplayExists);
  }, [game.replay]);

  return (
    <div className="game-entry" style={{ background: placementBg(placement) }}>
      <GameRowDisplay
        game={game}
        unitCosts={unitCosts}
        unitsFull={unitsFull}
        synergiesData={synergiesData}
        relicsData={relicsData}
        iconUrl={(type, stem) => `icons://${type}/${stem}.png`}
        shareUrl={`https://trackautochess.com/games/${game.id}`}
        onClick={onToggle}
        style={{ cursor: "pointer" }}
        dateExtra={
          replayExists ? (
            <button
              className="btn-play-replay"
              title="Watch replay"
              onClick={(e) => {
                e.stopPropagation();
                setShowReplay(true);
                if (!expanded) onToggle();
              }}
            >
              &#9654;
            </button>
          ) : undefined
        }
      />

      {expanded && (
        <div className="game-detail-panel" onClick={(e) => e.stopPropagation()}>
          {showReplay && replayExists && game.replay && (
            <div className="replay-player-inline">
              <VideoPlayer
                src={`replay://video/${encodeURIComponent(game.replay)}`}
                autoPlay
              />
              <button
                className="btn-replay-hide"
                onClick={() => setShowReplay(false)}
              >
                Hide replay
              </button>
            </div>
          )}
          {game.match_id && (
            <MatchTimelinePanel
              matchId={game.match_id}
              unitCosts={unitCosts}
              unitsFull={unitsFull}
              synergiesData={synergiesData}
              relicsData={relicsData}
              itemsFull={itemsFull}
            />
          )}
        </div>
      )}
    </div>
  );
}
