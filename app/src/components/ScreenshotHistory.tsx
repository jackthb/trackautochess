import { useState, useEffect, useCallback } from "react";
import type {
  Screenshot,
  SavedParseResult,
  ParseResultRow,
  UnitFullInfo,
  SynergyInfo,
  RelicInfo,
} from "../types";
import type { Game } from "../../../shared/types";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import {
  placementBg,
  unitStem,
  relicStem,
  synIconName,
  parseSynergies,
  parseRelics,
  parseWL,
} from "../lib/game-utils";
import { CountedTagPicker, ReorderableTagPicker } from "./TagPickers";
import type { CountedTag } from "./TagPickers";

interface ScreenshotHistoryProps {
  onImportFile?: (path: string) => void;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
}

export function parseRowToGame(row: ParseResultRow, timestamp: string): Game {
  const wl = parseWL(row.wl);
  return {
    id: 0,
    user_id: "",
    placement: row.placement || "",
    rank: row.rank || null,
    rank_change: (row.rank_change as Game["rank_change"]) || null,
    lineup: (row.units || [])
      .map((u) => {
        const m = u.match(/^(.+?)(?:\((\d)\))?$/);
        return m && m[2] ? `${m[1]}(${m[2]})` : u;
      })
      .join("|") || null,
    synergies: row.synergies || null,
    talents: null,
    relic: row.relic ? row.relic.replace(/\|/g, "|") : null,
    level: row.level || null,
    wl: row.wl || null,
    wins: wl?.w ?? null,
    losses: wl?.l ?? null,
    screenshot: null,
    replay: null,
    notes: null,
    played_at: timestamp || "",
    created_at: "",
  };
}

const RANK_TIERS = ["Pawn", "Knight", "Bishop", "Rook", "King", "Queen"];

function toDatetimeLocal(isoStr: string) {
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ParsedRowEdit({
  row,
  timestamp,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  onSave,
  checked,
  onToggleCheck,
}: {
  row: ParseResultRow;
  timestamp: string;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  onSave: (fields: Partial<ParseResultRow>) => Promise<void>;
  checked?: boolean;
  onToggleCheck?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editPlacement, setEditPlacement] = useState(row.placement || "");
  const [editLevel, setEditLevel] = useState(row.level || "");
  const [editRankTier, setEditRankTier] = useState("");
  const [editRankNum, setEditRankNum] = useState("");
  const [editW, setEditW] = useState(0);
  const [editL, setEditL] = useState(0);
  const [editUnits, setEditUnits] = useState<CountedTag[]>([]);
  const [editSynergies, setEditSynergies] = useState<CountedTag[]>([]);
  const [editRelics, setEditRelics] = useState<string[]>([]);
  const [editPlayedAt, setEditPlayedAt] = useState("");

  const game = parseRowToGame(row, timestamp);
  const p = parseInt(game.placement) || 0;

  const allUnitNames = Object.keys(unitCosts).sort();
  const allSynergyNames = Object.values(synergiesData)
    .map((s) => s.name)
    .sort();
  const allRelicNames = Object.values(relicsData)
    .map((r) => r.name)
    .sort();

  function resetEditState() {
    setEditPlacement(row.placement || "");
    setEditLevel(row.level || "");
    const parsedRank = row.rank ? row.rank.split("-") : [];
    setEditRankTier(parsedRank[0] || "");
    setEditRankNum(parsedRank[1] || "");
    const parsedWL = parseWL(row.wl);
    setEditW(parsedWL?.w ?? 0);
    setEditL(parsedWL?.l ?? 0);
    setEditPlayedAt(timestamp ? toDatetimeLocal(timestamp) : "");
    // Parse units preserving star data
    const parsedUnits = (row.units || []).map((u) => {
      const m = u.match(/^(.+?)(?:\((\d)\))?$/);
      return {
        name: m ? m[1] : u,
        count: m && m[2] ? parseInt(m[2]) : 1,
      };
    });
    setEditUnits(parsedUnits);
    setEditSynergies(
      parseSynergies(row.synergies).map((s) => ({
        name: s.name,
        count: s.count,
      }))
    );
    setEditRelics(parseRelics(row.relic));
  }

  function handleToggle() {
    if (!expanded) resetEditState();
    setExpanded(!expanded);
  }

  async function handleSave() {
    setSaving(true);
    const rankStr = editRankTier
      ? editRankNum
        ? `${editRankTier}-${editRankNum}`
        : editRankTier
      : "";
    const wlStr = editW || editL ? `${editW}-${editL}` : "";
    const unitsArr = editUnits.map((u) =>
      u.count > 1 ? `${u.name}(${u.count})` : u.name
    );
    const synStr = editSynergies.map((s) => `${s.name}:${s.count}`).join("|");
    const relicStr = editRelics.join("|");
    await onSave({
      placement: editPlacement,
      level: editLevel,
      rank: rankStr,
      wl: wlStr,
      units: unitsArr,
      synergies: synStr,
      relic: relicStr,
      time_ago: editPlayedAt ? new Date(editPlayedAt).toISOString() : row.time_ago,
    });
    setSaving(false);
    setExpanded(false);
  }

  return (
    <div className="game-entry" style={{ background: placementBg(p) }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        {onToggleCheck !== undefined && (
          <div
            className="confirm-row-check"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggleCheck}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <GameRowDisplay
            game={game}
            unitCosts={unitCosts}
            unitsFull={unitsFull}
            synergiesData={synergiesData}
            relicsData={relicsData}
            iconUrl={(type, stem) => `icons://${type}/${stem}.png`}
            onClick={handleToggle}
            style={{ cursor: "pointer" }}
          />
        </div>
      </div>
      {expanded && (
        <div className="game-edit-panel" onClick={(e) => e.stopPropagation()}>
          <div className="edit-panel-body">
            <div className="edit-fields-grid">
              <div className="edit-fields-row">
                <label className="edit-label">
                  <span>Placement</span>
                  <select
                    className="edit-field"
                    value={editPlacement}
                    onChange={(e) => setEditPlacement(e.target.value)}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="edit-label">
                  <span>Level</span>
                  <select
                    className="edit-field"
                    value={editLevel}
                    onChange={(e) => setEditLevel(e.target.value)}
                  >
                    <option value="">&mdash;</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="edit-label">
                  <span>Rank</span>
                  <div className="edit-rank-pair">
                    <select
                      className="edit-field"
                      value={editRankTier}
                      onChange={(e) => setEditRankTier(e.target.value)}
                    >
                      <option value="">&mdash;</option>
                      {RANK_TIERS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    {editRankTier && editRankTier !== "Queen" && (
                      <select
                        className="edit-field"
                        value={editRankNum}
                        onChange={(e) => setEditRankNum(e.target.value)}
                      >
                        <option value="">&mdash;</option>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                          <option key={n} value={String(n)}>{n}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <div className="edit-label">
                  <span>W &ndash; L</span>
                  <div className="edit-wl-pair">
                    <input
                      className="edit-field edit-wl-input"
                      type="number"
                      min="0"
                      max="99"
                      value={editW}
                      onChange={(e) => setEditW(parseInt(e.target.value) || 0)}
                    />
                    <span className="edit-wl-dash">&ndash;</span>
                    <input
                      className="edit-field edit-wl-input"
                      type="number"
                      min="0"
                      max="99"
                      value={editL}
                      onChange={(e) => setEditL(parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <label className="edit-label">
                  <span>Time</span>
                  <input
                    className="edit-field"
                    type="datetime-local"
                    value={editPlayedAt}
                    onChange={(e) => setEditPlayedAt(e.target.value)}
                  />
                </label>
              </div>

              <div className="edit-label edit-label-wide">
                <span>Lineup</span>
                <CountedTagPicker
                  tags={editUnits}
                  onChange={setEditUnits}
                  suggestions={allUnitNames}
                  iconPrefix="units"
                  iconStem={unitStem}
                  placeholder="Add unit..."
                  countLabel="Stars"
                  minCount={1}
                  maxCount={3}
                  defaultCount={1}
                />
              </div>

              <div className="edit-label edit-label-wide">
                <span>Synergies</span>
                <CountedTagPicker
                  tags={editSynergies}
                  onChange={setEditSynergies}
                  suggestions={allSynergyNames}
                  iconPrefix="synergies"
                  iconStem={synIconName}
                  placeholder="Add synergy..."
                  countLabel="Count"
                  minCount={1}
                  maxCount={20}
                  defaultCount={1}
                />
              </div>

              <div className="edit-label edit-label-wide">
                <span>Relic</span>
                <ReorderableTagPicker
                  tags={editRelics}
                  onChange={setEditRelics}
                  suggestions={allRelicNames}
                  iconPrefix="relics"
                  iconStem={relicStem}
                  placeholder="Add relic..."
                />
              </div>
            </div>
          </div>
          <div className="edit-panel-actions">
            <div style={{ flex: 1 }} />
            <button
              className="btn-confirm btn-confirm-cancel"
              onClick={() => setExpanded(false)}
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

export function ScreenshotHistory({
  onImportFile,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
}: ScreenshotHistoryProps) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [thumbnailCache, setThumbnailCache] = useState<
    Record<string, string>
  >({});
  const [parseCache, setParseCache] = useState<
    Record<string, SavedParseResult>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.screenshots.list();
      setScreenshots(list);
    } catch {
      setScreenshots([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadThumbnail = useCallback(
    async (name: string) => {
      if (thumbnailCache[name]) return;
      const data = await window.screenshots.thumbnail(name);
      if (data) {
        setThumbnailCache((prev) => ({ ...prev, [name]: data }));
      }
    },
    [thumbnailCache]
  );

  const loadParseResult = useCallback(
    async (name: string) => {
      if (parseCache[name] !== undefined) return;
      const data = await window.screenshots.getParseResult(name);
      if (data) {
        setParseCache((prev) => ({ ...prev, [name]: data }));
      }
    },
    [parseCache]
  );

  const handleDelete = async (name: string) => {
    const ok = await window.screenshots.delete(name);
    if (ok) {
      setScreenshots((prev) => prev.filter((s) => s.name !== name));
      setDeleteConfirm(null);
      if (expandedImage === name) setExpandedImage(null);
      setParseCache((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleExpand = async (name: string) => {
    if (expandedImage === name) {
      setExpandedImage(null);
      return;
    }
    if (!thumbnailCache[name]) {
      await loadThumbnail(name);
    }
    setExpandedImage(name);
  };

  const handleUpdateRow = useCallback(
    async (screenshotName: string, rowIndex: number, fields: Partial<ParseResultRow>) => {
      const ok = await window.screenshots.updateParseRow(screenshotName, rowIndex, fields);
      if (ok) {
        setParseCache((prev) => {
          const existing = prev[screenshotName];
          if (!existing) return prev;
          const updatedRows = [...existing.rows];
          updatedRows[rowIndex] = { ...updatedRows[rowIndex], ...fields };
          return { ...prev, [screenshotName]: { ...existing, rows: updatedRows } };
        });
      }
    },
    []
  );

  useEffect(() => {
    for (const ss of screenshots) {
      if (ss.hasParsed && !parseCache[ss.name]) {
        loadParseResult(ss.name);
      }
    }
  }, [screenshots, parseCache, loadParseResult]);

  const formatDate = (mtime: number) => {
    const d = new Date(mtime);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) + " " + d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="ss-history">
        <div className="ss-history-header">
          <h3>Screenshot History</h3>
        </div>
        <div className="ss-history-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="ss-history">
      <div className="ss-history-header">
        <h3>Screenshot History</h3>
        <div className="ss-history-actions">
          <button className="btn-ss-action" onClick={() => window.screenshots.openFolder()}>
            Open Folder
          </button>
          <button className="btn-ss-action" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>

      {screenshots.length === 0 ? (
        <div className="ss-history-empty">
          No screenshots yet. Capture a screenshot (F6) to get started.
        </div>
      ) : (
        <div className="ss-history-list">
          {screenshots.map((ss) => {
            const parsed = parseCache[ss.name];
            return (
              <div key={ss.name} className="ss-item">
                <div className="ss-item-row" onClick={() => handleExpand(ss.name)}>
                  <div className="ss-item-info">
                    <span className="ss-item-name">
                      {ss.uploaded && <span className="ss-uploaded-badge" title="Uploaded to database">&#10003;</span>}
                      {ss.name}
                    </span>
                    <span className="ss-item-meta">
                      {formatDate(ss.mtime)} &middot; {formatSize(ss.size)}
                      {ss.hasParsed && <span className="ss-parsed-badge" title="Has parsed data"> &middot; Parsed</span>}
                    </span>
                  </div>
                  <div className="ss-item-buttons">
                    {onImportFile && (
                      <button
                        className="btn-ss-small"
                        title="Import this screenshot"
                        onClick={(e) => {
                          e.stopPropagation();
                          onImportFile(ss.path);
                        }}
                      >
                        Import
                      </button>
                    )}
                    {deleteConfirm === ss.name ? (
                      <>
                        <button
                          className="btn-ss-small btn-ss-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(ss.name);
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          className="btn-ss-small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(null);
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-ss-small btn-ss-danger"
                        title="Delete screenshot"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(ss.name);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {expandedImage === ss.name && (
                  <div className="ss-item-expanded">
                    {thumbnailCache[ss.name] && (
                      <div className="ss-item-preview">
                        <img src={thumbnailCache[ss.name]} alt={ss.name} />
                      </div>
                    )}
                    {parsed && parsed.rows.length > 0 && (
                      <div className="ss-parsed-rows">
                        {parsed.rows.map((row, i) => (
                          <ParsedRowEdit
                            key={i}
                            row={row}
                            timestamp={parsed.timestamps[i] || ""}
                            unitCosts={unitCosts}
                            unitsFull={unitsFull}
                            synergiesData={synergiesData}
                            relicsData={relicsData}
                            onSave={async (fields) => {
                              await handleUpdateRow(ss.name, i, fields);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
