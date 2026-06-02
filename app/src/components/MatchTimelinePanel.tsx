import { useEffect, useState } from "react";
import type { UnitFullInfo, SynergyInfo, RelicInfo, ItemFullInfo } from "../types";
import type { ChessBoardPiece } from "@dac/shared/types";
import { ChessBoard } from "@dac/shared/ChessBoard";

interface PlayerSnap {
  hp?: number;
  level?: number;
  placement?: number;
  duration?: number;
  lineup?: string;
  lineup_value?: number;
  total_money?: number;
  win_round?: number;
  lose_round?: number;
  courier_level?: number;
  win_streak?: number;
  relic?: string;
  relic_ttl?: number;
  mmr_level?: number;
  team_id?: number;
  hero_index?: number;
  player_id?: number;
  board?: ChessBoardPiece[];
}

interface RoundSnap {
  round: number;
  captured_at?: string;
  players?: Record<string, PlayerSnap>;
  draft?: { bans?: Record<string, string>; legendaries_revealed?: unknown[] };
  death_team?: Record<string, unknown>;
}

interface Timeline {
  match_id: string;
  played_at: string;
  round_count: number;
  first_round: number;
  last_round: number;
  rounds: RoundSnap[];
}

interface Props {
  matchId: string;
  unitCosts: Record<string, number>;
  unitsFull?: Record<string, UnitFullInfo>;
  synergiesData?: Record<string, SynergyInfo>;
  relicsData?: Record<string, RelicInfo>;
  itemsFull?: Record<string, ItemFullInfo>;
}

export function MatchTimelinePanel({
  matchId,
  unitCosts,
  itemsFull,
}: Props) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.appApi
      ?.fetchTimeline?.(matchId)
      ?.then((raw) => {
        if (cancelled) return;
        const t = raw as Timeline | null;
        setTimeline(t);
        // Default to the last round (most interesting view).
        if (t?.rounds?.length) {
          setSelectedRoundIdx(t.rounds.length - 1);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  if (loading) {
    return <div className="timeline-panel-loading">Loading match timeline…</div>;
  }
  if (!timeline || !timeline.rounds?.length) {
    return (
      <div className="timeline-panel-empty">
        No timeline data for this match. Captured matches need round-by-round dumps to build a timeline.
      </div>
    );
  }

  const round = timeline.rounds[selectedRoundIdx];

  const isLastRound = selectedRoundIdx === timeline.rounds.length - 1;

  // While scrubbing through earlier rounds, rank players by the HP they had in
  // that snapshot instead of freezing the final placement order. Equal-HP early
  // rounds fall back to Steam ID for a deterministic alphabetical-ish order; the
  // final round keeps the stored placement order so the end state is unchanged.
  const playerRows = Object.entries(round.players || {}).sort(([aSid, a], [bSid, b]) => {
    const placementDelta = (a.placement ?? 99) - (b.placement ?? 99);
    if (isLastRound) return placementDelta;

    const aHasHp = typeof a.hp === "number";
    const bHasHp = typeof b.hp === "number";
    if (aHasHp !== bHasHp) return aHasHp ? -1 : 1;
    if (aHasHp && bHasHp && a.hp !== b.hp) return b.hp - a.hp;

    const sidDelta = aSid.localeCompare(bSid, undefined, { numeric: true });
    return sidDelta || placementDelta;
  });

  return (
    <div className="timeline-panel" style={{ padding: 12, borderTop: "1px solid #333", marginTop: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Match timeline:</strong> rounds {timeline.first_round}–{timeline.last_round} ({timeline.round_count} snapshots)
      </div>
      <input
        type="range"
        min={0}
        max={timeline.rounds.length - 1}
        value={selectedRoundIdx}
        onChange={(e) => setSelectedRoundIdx(Number(e.target.value))}
        style={{ width: "100%" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888" }}>
        <span>Round {timeline.first_round}</span>
        <strong style={{ color: "#fff" }}>Round {round.round}</strong>
        <span>Round {timeline.last_round}</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <table style={{ width: "100%", marginTop: 4, fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#888" }}>
              <th style={{ padding: "4px 8px" }}>#</th>
              <th style={{ padding: "4px 8px" }}>Steam ID</th>
              <th style={{ padding: "4px 8px" }}>HP</th>
              <th style={{ padding: "4px 8px" }}>Lvl</th>
              <th style={{ padding: "4px 8px" }}>W-L</th>
              <th style={{ padding: "4px 8px", width: "100%" }}>Board</th>
            </tr>
          </thead>
          <tbody>
            {playerRows.map(([sid, p], rowIdx) => {
              const dead = (p.hp ?? 0) <= 0;
              return (
                <tr
                  key={sid}
                  style={{ borderTop: "1px solid #222", opacity: dead ? 0.45 : 1 }}
                >
                  <td style={{ padding: "4px 8px" }}>{isLastRound ? p.placement ?? "-" : rowIdx + 1}</td>
                  <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 11 }}>{sid}</td>
                  <td style={{ padding: "4px 8px" }}>{p.hp ?? "-"}</td>
                  <td style={{ padding: "4px 8px" }}>{p.level ?? "-"}</td>
                  <td style={{ padding: "4px 8px" }}>{p.win_round ?? 0}-{p.lose_round ?? 0}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <ChessBoard
                      board={p.board}
                      lineup={p.lineup || ""}
                      unitCosts={unitCosts}
                      iconUrl={(type, stem) => `icons://${type}/${stem}.png`}
                      itemsFull={itemsFull}
                      compact
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {round.draft?.bans && Object.keys(round.draft.bans).length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <strong>Bans:</strong>{" "}
          {Object.entries(round.draft.bans).map(([pid, ban]) => (
            <span key={pid} style={{ marginRight: 8, color: "#aaa" }}>
              p{pid}: {String(ban)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
