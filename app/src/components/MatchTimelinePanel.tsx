import { useEffect, useMemo, useState } from "react";
import type { ItemFullInfo, RelicInfo, SynergyInfo, UnitFullInfo } from "../types";
import type { MatchTimelineEvent } from "../backend-events";
import { sendBackendRequest } from "../lib/backend-request";

type JsonRecord = Record<string, unknown>;

interface RoundSnap {
  round?: number | string | null;
  players?: unknown;
  [key: string]: unknown;
}

interface Timeline {
  rounds: RoundSnap[];
}

interface ParsedPlayerSnapshot {
  id: string;
  label: string;
  round: number;
  units: string[];
  items: string[];
  relics: string[];
}

interface ActivityLogEntry {
  key: string;
  round: number;
  playerLabel: string;
  text: string;
  tone: "buy" | "sell" | "item" | "relic";
}

interface MatchTimelinePanelProps {
  matchId: string;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  itemsFull: Record<string, ItemFullInfo>;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecordArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return Object.values(value).filter(isRecord);
  return [];
}

function timelineFromValue(value: unknown): Timeline | null {
  if (!isRecord(value)) return null;
  const rawRounds = value.rounds;
  const rounds = Array.isArray(rawRounds)
    ? rawRounds.filter(isRecord)
    : isRecord(rawRounds)
      ? Object.entries(rawRounds)
          .filter(([, round]) => isRecord(round))
          .map(([roundKey, round]) => ({ round: roundKey, ...(round as JsonRecord) }))
      : [];
  if (rounds.length === 0) return null;
  return { rounds };
}

function stringValue(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function roundNumber(round: RoundSnap, fallback: number): number {
  const value = round.round ?? round.round_num ?? round.roundNumber ?? round.round_id;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback + 1;
}

function normalizeCode(value: string): string {
  return value.trim().replace(/^npc_dota_/, "").replace(/^dac_/, "");
}

function codeFromEntry(entry: unknown, keys: string[]): string | null {
  if (typeof entry === "string" || typeof entry === "number") {
    const code = normalizeCode(String(entry));
    return code || null;
  }
  if (!isRecord(entry)) return null;
  const code = stringValue(entry, keys);
  return code ? normalizeCode(code) : null;
}

function collectCodes(record: JsonRecord, sourceKeys: string[], entryKeys: string[]): string[] {
  const codes: string[] = [];
  for (const sourceKey of sourceKeys) {
    const source = record[sourceKey];
    const values = Array.isArray(source)
      ? source
      : isRecord(source)
        ? Object.values(source)
        : typeof source === "string"
          ? source.split(/[,\s]+/)
          : [];
    for (const value of values) {
      const code = codeFromEntry(value, entryKeys);
      if (code) codes.push(code);
    }
  }
  return codes;
}

function playerId(record: JsonRecord, index: number): string {
  return (
    stringValue(record, [
      "steam_id",
      "steam_id64",
      "account_id",
      "player_id",
      "player_slot",
      "seat",
      "team",
      "id",
    ]) ?? `seat-${index + 1}`
  );
}

function playerLabel(record: JsonRecord, id: string, index: number): string {
  return (
    stringValue(record, ["name", "player_name", "steam_name", "nickname"]) ??
    (id.startsWith("seat-") ? `Player ${index + 1}` : id)
  );
}

function playerRecordsForRound(round: RoundSnap): JsonRecord[] {
  for (const key of ["players", "player_snapshots", "lineups", "seats"]) {
    const players = asRecordArray(round[key]);
    if (players.length > 0) return players;
  }
  return asRecordArray(round);
}

function parsePlayerSnapshots(timeline: Timeline): ParsedPlayerSnapshot[] {
  const snapshots: ParsedPlayerSnapshot[] = [];
  timeline.rounds.forEach((round, roundIndex) => {
    const roundNo = roundNumber(round, roundIndex);
    playerRecordsForRound(round).forEach((player, playerIndex) => {
      const id = playerId(player, playerIndex);
      snapshots.push({
        id,
        label: playerLabel(player, id, playerIndex),
        round: roundNo,
        units: collectCodes(
          player,
          ["units", "board", "lineup", "pieces", "chess", "army"],
          ["unit", "unit_id", "unit_name", "hero", "hero_id", "chess_id", "name", "code", "id"],
        ),
        items: collectCodes(
          player,
          ["items", "item_codes", "inventory", "equipment", "equipped_items"],
          ["item", "item_id", "item_name", "name", "code", "id"],
        ),
        relics: collectCodes(
          player,
          ["relics", "relic_codes", "relic_items"],
          ["relic", "relic_id", "relic_name", "name", "code", "id"],
        ),
      });
    });
  });
  return snapshots;
}

function diffCounts(previous: string[], next: string[]) {
  const previousCounts = new Map<string, number>();
  const nextCounts = new Map<string, number>();
  previous.forEach((code) => previousCounts.set(code, (previousCounts.get(code) ?? 0) + 1));
  next.forEach((code) => nextCounts.set(code, (nextCounts.get(code) ?? 0) + 1));

  const added: string[] = [];
  const removed: string[] = [];
  const codes = new Set([...previousCounts.keys(), ...nextCounts.keys()]);
  codes.forEach((code) => {
    const delta = (nextCounts.get(code) ?? 0) - (previousCounts.get(code) ?? 0);
    for (let i = 0; i < Math.abs(delta); i += 1) {
      if (delta > 0) added.push(code);
      if (delta < 0) removed.push(code);
    }
  });
  return { added, removed };
}

function displayName(
  code: string,
  lookup: Record<string, unknown>,
): string {
  const info = lookup[code] ?? lookup[`npc_dota_${code}`] ?? lookup[`item_${code}`];
  if (isRecord(info)) {
    for (const key of ["name", "displayName", "display_name", "title"]) {
      const value = info[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return code.replace(/^item_/, "").replace(/_/g, " ");
}

function buildActivityLog(
  timeline: Timeline,
  unitsFull: Record<string, UnitFullInfo>,
  relicsData: Record<string, RelicInfo>,
  itemsFull: Record<string, ItemFullInfo>,
): ActivityLogEntry[] {
  const byPlayer = new Map<string, ParsedPlayerSnapshot[]>();
  for (const snapshot of parsePlayerSnapshots(timeline)) {
    const entries = byPlayer.get(snapshot.id) ?? [];
    entries.push(snapshot);
    byPlayer.set(snapshot.id, entries);
  }

  const activity: ActivityLogEntry[] = [];
  byPlayer.forEach((snapshots, playerIdKey) => {
    const sorted = snapshots.slice().sort((a, b) => a.round - b.round);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const next = sorted[i];
      const unitDiff = diffCounts(previous.units, next.units);
      const itemDiff = diffCounts(previous.items, next.items);
      const relicDiff = diffCounts(previous.relics, next.relics);

      unitDiff.added.forEach((code, idx) =>
        activity.push({
          key: `${playerIdKey}-${next.round}-buy-${code}-${idx}`,
          round: next.round,
          playerLabel: next.label,
          text: `Bought ${displayName(code, unitsFull)}`,
          tone: "buy",
        }),
      );
      unitDiff.removed.forEach((code, idx) =>
        activity.push({
          key: `${playerIdKey}-${next.round}-sell-${code}-${idx}`,
          round: next.round,
          playerLabel: next.label,
          text: `Sold ${displayName(code, unitsFull)}`,
          tone: "sell",
        }),
      );
      itemDiff.added.forEach((code, idx) =>
        activity.push({
          key: `${playerIdKey}-${next.round}-item-${code}-${idx}`,
          round: next.round,
          playerLabel: next.label,
          text: `Picked item ${displayName(code, itemsFull)}`,
          tone: "item",
        }),
      );
      relicDiff.added.forEach((code, idx) =>
        activity.push({
          key: `${playerIdKey}-${next.round}-relic-${code}-${idx}`,
          round: next.round,
          playerLabel: next.label,
          text: `Picked relic ${displayName(code, relicsData)}`,
          tone: "relic",
        }),
      );
    }
  });

  return activity.sort((a, b) => a.round - b.round || a.playerLabel.localeCompare(b.playerLabel));
}

export function MatchTimelinePanel({
  matchId,
  unitsFull,
  relicsData,
  itemsFull,
}: MatchTimelinePanelProps) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTimeline(null);
    setSelectedRoundIdx(0);
    setShowActivity(false);

    sendBackendRequest<MatchTimelineEvent>({ cmd: "fetch_timeline", match_id: matchId })
      .then((response) => {
        if (cancelled) return;
        const parsed = timelineFromValue(response.timeline);
        if (!parsed) {
          setError("No timeline snapshots were saved for this match.");
          return;
        }
        setTimeline(parsed);
        setSelectedRoundIdx(Math.max(0, parsed.rounds.length - 1));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load timeline.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const selectedRound = timeline?.rounds[selectedRoundIdx] ?? null;
  const selectedPlayers = selectedRound ? parsePlayerSnapshots({ rounds: [selectedRound] }) : [];
  const activityLog = useMemo(
    () => (showActivity && timeline ? buildActivityLog(timeline, unitsFull, relicsData, itemsFull) : []),
    [itemsFull, relicsData, showActivity, timeline, unitsFull],
  );

  if (loading) return <div className="timeline-panel-loading">Loading timeline...</div>;
  if (error) return <div className="timeline-panel-error">{error}</div>;
  if (!timeline) return null;

  return (
    <div className="timeline-panel">
      <div className="timeline-panel-header">
        <div>
          <div className="timeline-panel-title">Timeline</div>
          <div className="timeline-panel-subtitle">{timeline.rounds.length} snapshots saved</div>
        </div>
        <button
          type="button"
          className="timeline-activity-toggle"
          onClick={() => setShowActivity((value) => !value)}
        >
          {showActivity ? "Hide activity log" : "Show activity log"}
        </button>
      </div>

      <label className="timeline-round-picker">
        <span>Round {selectedRound ? roundNumber(selectedRound, selectedRoundIdx) : selectedRoundIdx + 1}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, timeline.rounds.length - 1)}
          value={selectedRoundIdx}
          onChange={(event) => setSelectedRoundIdx(Number(event.target.value))}
        />
      </label>

      <div className="timeline-round-grid">
        {selectedPlayers.length === 0 ? (
          <div className="timeline-panel-empty">No player snapshots in this round.</div>
        ) : (
          selectedPlayers.map((player) => (
            <div className="timeline-player-card" key={player.id}>
              <div className="timeline-player-name">{player.label}</div>
              <div className="timeline-player-line">Units: {player.units.length || 0}</div>
              <div className="timeline-player-line">Items: {player.items.length || 0}</div>
              <div className="timeline-player-line">Relics: {player.relics.length || 0}</div>
            </div>
          ))
        )}
      </div>

      {showActivity && (
        <div className="timeline-activity-log">
          {activityLog.length === 0 ? (
            <div className="timeline-panel-empty">No unit, item, or relic changes were detected.</div>
          ) : (
            activityLog.map((entry) => (
              <div className={`timeline-activity-entry timeline-activity-${entry.tone}`} key={entry.key}>
                <span className="timeline-activity-round">R{entry.round}</span>
                <span className="timeline-activity-player">{entry.playerLabel}</span>
                <span className="timeline-activity-text">{entry.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
