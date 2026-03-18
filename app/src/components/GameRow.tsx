import { useState } from "react";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "../types";
import {
  placementColor,
  placementBg,
  costBorderColor,
  unitStem,
  relicStem,
  synIconName,
  parseLineup,
  parseSynergies,
  parseRelics,
  parseWL,
} from "../lib/game-utils";
import { Tooltip } from "./Tooltip";

interface GameRowProps {
  game: Game;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  onUpdate: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
  onDelete: (gameId: number) => Promise<boolean>;
}

const SUPABASE_STORAGE_URL =
  "https://xkfxykorskdltcmvgihh.supabase.co/storage/v1/object/public/screenshots/";

export function GameRow({
  game,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  onUpdate,
  onDelete,
}: GameRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editFields, setEditFields] = useState({
    placement: game.placement || "",
    level: game.level || "",
    wl: game.wl || "",
    lineup: game.lineup || "",
    synergies: game.synergies || "",
    relic: game.relic || "",
  });
  const [screenshotFull, setScreenshotFull] = useState(false);

  const p = parseInt(game.placement) || 0;
  const wl = parseWL(game.wl);
  const rankParts = game.rank ? game.rank.split("-") : [];
  const tier = rankParts[0] || "";
  const rankNum = rankParts[1] || "";
  const lineup = parseLineup(game.lineup, unitCosts);
  const syns = parseSynergies(game.synergies);
  const relics = parseRelics(game.relic);
  const pColor = placementColor(p);

  const screenshotUrl = game.screenshot
    ? `${SUPABASE_STORAGE_URL}${game.screenshot}`
    : null;

  function handleToggle() {
    if (!expanded) {
      // Reset edit fields to current game values when opening
      setEditFields({
        placement: game.placement || "",
        level: game.level || "",
        wl: game.wl || "",
        lineup: game.lineup || "",
        synergies: game.synergies || "",
        relic: game.relic || "",
      });
      setScreenshotFull(false);
    }
    setExpanded(!expanded);
  }

  function handleChange(field: string, value: string) {
    setEditFields((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    const ok = await onUpdate(game.id, {
      placement: editFields.placement,
      level: editFields.level || null,
      wl: editFields.wl || null,
      lineup: editFields.lineup || null,
      synergies: editFields.synergies || null,
      relic: editFields.relic || null,
    });
    setSaving(false);
    if (ok) setExpanded(false);
  }

  return (
    <div className="game-entry" style={{ background: placementBg(p) }}>
      <div className="game-row" onClick={handleToggle} style={{ cursor: "pointer" }}>
        <div className="cell">
          <div
            className="placement"
            style={{ color: pColor, borderColor: pColor }}
          >
            {game.placement}
          </div>
        </div>
        <div className="cell units-cell">
          {lineup.length > 0 && (
            <div className="lineup">
              {lineup.map((u, i) => {
                const cost = unitCosts[u.name] || 1;
                return (
                  <Tooltip
                    key={i}
                    type="unit"
                    name={u.name}
                    stars={u.stars}
                    unitCosts={unitCosts}
                    unitsFull={unitsFull}
                  >
                    <div className="unit-icon-wrap" onClick={(e) => e.stopPropagation()}>
                      <img
                        className="unit-icon"
                        src={`icons://units/${unitStem(u.name)}.png`}
                        alt={u.name}
                        loading="lazy"
                        style={{ borderColor: costBorderColor(cost) }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      {u.stars > 1 && (
                        <span className={`unit-stars s${u.stars}`}>
                          {"★".repeat(u.stars)}
                        </span>
                      )}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          )}
          {syns.length > 0 && (
            <div className="synergies">
              {syns.map((s, i) => (
                <Tooltip
                  key={i}
                  type="synergy"
                  name={s.name}
                  count={s.count}
                  synergiesData={synergiesData}
                >
                  <div className="syn-badge" onClick={(e) => e.stopPropagation()}>
                    <img
                      className="syn-icon"
                      src={`icons://synergies/${synIconName(s.name)}.png`}
                      alt={s.name}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <span className="syn-count">{s.count}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
        <div className="cell rank-cell">
          <span className="rank-tier">{tier}</span>{" "}
          <span className="rank-num">{rankNum}</span>
          {game.rank && game.rank_change === "up" && (
            <span className="arrow-up">&#9650;</span>
          )}
          {game.rank && game.rank_change === "down" && (
            <span className="arrow-down">&#9660;</span>
          )}
        </div>
        <div className="cell wl">
          {wl ? (
            <>
              <span className="wl-w">{wl.w}</span>
              <span className="wl-sep"> &ndash; </span>
              <span className="wl-l">{wl.l}</span>
            </>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>&mdash;</span>
          )}
        </div>
        <div className="cell level-cell">{game.level || "\u2014"}</div>
        <div className="cell relics-cell">
          {relics.length > 0 ? (
            <div className="relics">
              {relics.map((r, i) => (
                <Tooltip
                  key={i}
                  type="relic"
                  name={r}
                  relicsData={relicsData}
                >
                  <img
                    className="relic-icon"
                    src={`icons://relics/${relicStem(r)}.png`}
                    alt={r}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </Tooltip>
              ))}
            </div>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>&mdash;</span>
          )}
        </div>
        <div className="cell date-cell">
          {game.played_at ? (
            <>
              <div>
                {new Date(game.played_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </div>
              <div>
                {new Date(game.played_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </>
          ) : (
            "\u2014"
          )}
        </div>
      </div>

      {expanded && (
        <div className="game-edit-panel" onClick={(e) => e.stopPropagation()}>
          <div className="edit-panel-body">
            {screenshotUrl && (
              <div className="edit-screenshot-col">
                <img
                  className={`game-screenshot-thumb ${screenshotFull ? "full" : ""}`}
                  src={screenshotUrl}
                  alt="Game screenshot"
                  onClick={() => setScreenshotFull(!screenshotFull)}
                />
              </div>
            )}
            <div className="edit-fields-grid">
              <label className="edit-label">
                <span>Placement</span>
                <input
                  className="edit-field"
                  value={editFields.placement}
                  onChange={(e) => handleChange("placement", e.target.value)}
                />
              </label>
              <label className="edit-label">
                <span>Level</span>
                <input
                  className="edit-field"
                  value={editFields.level}
                  onChange={(e) => handleChange("level", e.target.value)}
                />
              </label>
              <label className="edit-label">
                <span>W-L</span>
                <input
                  className="edit-field"
                  value={editFields.wl}
                  onChange={(e) => handleChange("wl", e.target.value)}
                />
              </label>
              <label className="edit-label">
                <span>Lineup</span>
                <input
                  className="edit-field"
                  value={editFields.lineup}
                  onChange={(e) => handleChange("lineup", e.target.value)}
                />
              </label>
              <label className="edit-label">
                <span>Synergies</span>
                <input
                  className="edit-field"
                  value={editFields.synergies}
                  onChange={(e) => handleChange("synergies", e.target.value)}
                />
              </label>
              <label className="edit-label">
                <span>Relic</span>
                <input
                  className="edit-field"
                  value={editFields.relic}
                  onChange={(e) => handleChange("relic", e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="edit-panel-actions">
            {!confirmDelete ? (
              <button
                className="btn-confirm btn-confirm-cancel btn-delete-game"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            ) : (
              <button
                className="btn-confirm btn-modal-danger"
                onClick={() => onDelete(game.id)}
              >
                Confirm delete
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              className="btn-confirm btn-confirm-cancel"
              onClick={() => { setExpanded(false); setConfirmDelete(false); }}
            >
              Cancel
            </button>
            <button
              className="btn-confirm btn-confirm-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
