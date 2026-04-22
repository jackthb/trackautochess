import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ImportResultTone,
  Screenshot,
  SavedParseResult,
  ParseResultRow,
  ScreenshotDebugResult,
  UnitFullInfo,
  SynergyInfo,
  RelicInfo,
} from "../types";
import type { ImportResult } from "../hooks/useTrackerEvents";
import type { Game } from "../../../shared/types";
import { ZoomableImageModal } from "./ZoomableImageModal";
import { ScreenshotDebugModal } from "./ScreenshotDebugModal";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import {
  placementBg,
  parseSynergies,
  parseRelics,
  parseWL,
  toDatetimeLocal,
} from "../lib/game-utils";
import type { CountedTag } from "./TagPickers";
import { GameEditFields } from "./GameEditFields";

interface ScreenshotHistoryProps {
  onImportFile?: (path: string) => void;
  lastImportResult?: ImportResult | null;
  onClearImportResult?: () => void;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  importing?: boolean;
  debugEnabled?: boolean;
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
    match_id: null,
    played_at: timestamp || "",
    created_at: "",
  };
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
    <div className={`game-entry${row.is_duplicate ? " game-entry-duplicate" : ""}`} style={{ background: placementBg(p) }}>
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
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {row.is_duplicate && (
            <span className="duplicate-badge">Already imported</span>
          )}
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
            <GameEditFields
              editPlacement={editPlacement}
              editLevel={editLevel}
              editRankTier={editRankTier}
              editRankNum={editRankNum}
              editW={editW}
              editL={editL}
              editUnits={editUnits}
              editSynergies={editSynergies}
              editRelics={editRelics}
              editPlayedAt={editPlayedAt}
              setEditPlacement={setEditPlacement}
              setEditLevel={setEditLevel}
              setEditRankTier={setEditRankTier}
              setEditRankNum={setEditRankNum}
              setEditW={setEditW}
              setEditL={setEditL}
              setEditUnits={setEditUnits}
              setEditSynergies={setEditSynergies}
              setEditRelics={setEditRelics}
              setEditPlayedAt={setEditPlayedAt}
              unitCosts={unitCosts}
              synergiesData={synergiesData}
              relicsData={relicsData}
            />
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

const SCREEN_TYPE_LABELS: Record<string, string> = {
  my_matches: "History",
  game_over: "Game Over",
  final_ranking: "Final Ranking",
};

interface ResultToast {
  message: string;
  tone: ImportResultTone;
}

function fallbackImportMessage(result: ImportResult): string {
  const singular = result.screenType === "game_over" ? "player row" : "match";
  const plural = result.screenType === "game_over" ? "player rows" : "matches";
  const details: string[] = [];
  if (result.skipped) details.push(`${result.skipped} duplicate(s) skipped`);
  if (result.failed) details.push(`${result.failed} failed to save`);

  let message = result.imported > 0
    ? `Imported ${result.imported} ${result.imported === 1 ? singular : plural}`
    : `No ${plural} were imported`;
  if (details.length > 0) {
    message += ` (${details.join(", ")})`;
  }
  return message;
}

function importToneIcon(tone: ImportResultTone): string {
  if (tone === "error") return "\u00d7";
  if (tone === "warning") return "!";
  return "\u2713";
}

export function ScreenshotHistory({
  onImportFile,
  lastImportResult,
  onClearImportResult,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  importing = false,
  debugEnabled = false,
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
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [importingPath, setImportingPath] = useState<string | null>(null);
  const [loadingThumbnail, setLoadingThumbnail] = useState<string | null>(null);
  const [resultToast, setResultToast] = useState<ResultToast | null>(null);
  const [debugLoadingFor, setDebugLoadingFor] = useState<string | null>(null);
  const [debugData, setDebugData] = useState<ScreenshotDebugResult | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Show import result toast and refresh list when import completes
  useEffect(() => {
    if (lastImportResult) {
      setImportingPath(null);
      setResultToast({
        message: lastImportResult.message ?? fallbackImportMessage(lastImportResult),
        tone: lastImportResult.tone ?? (lastImportResult.imported > 0 ? "success" : "warning"),
      });
      refresh();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setResultToast(null);
        onClearImportResult?.();
      }, 5000);
    }
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [lastImportResult]);

  // When the global import flag clears (success, error, or timeout),
  // also clear the per-row "Importing" highlight and refresh the list so
  // the newly-detected screen_type badge shows up.
  useEffect(() => {
    if (!importing) {
      setImportingPath(null);
      refresh();
    }
  }, [importing, refresh]);

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
    setDeletingName(name);
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
    setDeletingName(null);
  };

  const handleExpand = async (name: string) => {
    if (expandedImage === name) {
      setExpandedImage(null);
      return;
    }
    if (!thumbnailCache[name]) {
      setLoadingThumbnail(name);
      await loadThumbnail(name);
      setLoadingThumbnail(null);
    }
    setExpandedImage(name);
  };

  const handleDebug = useCallback(async (name: string, screenType: string | null) => {
    setDebugLoadingFor(name);
    setDebugData(null);
    try {
      const data = await window.screenshots.debug(name, screenType);
      setDebugData(data);
    } finally {
      setDebugLoadingFor(null);
    }
  }, []);

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

      {resultToast && (
        <div className={`ss-result-toast ss-result-toast-${resultToast.tone}`}>
          <span className="ss-result-icon">{importToneIcon(resultToast.tone)}</span>
          {resultToast.message}
        </div>
      )}

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
                      {ss.screenType && SCREEN_TYPE_LABELS[ss.screenType] && (
                        <span className="ss-type-badge" title={`Screen type: ${ss.screenType}`}> &middot; {SCREEN_TYPE_LABELS[ss.screenType]}</span>
                      )}
                      {ss.hasImported
                        ? <span className="ss-imported-badge" title="Game imported"> &middot; &#10003; Imported</span>
                        : ss.hasParsed && <span className="ss-parsed-badge" title="Has parsed data"> &middot; Parsed</span>
                      }
                    </span>
                  </div>
                  <div className="ss-item-buttons">
                    {onImportFile && (
                      <button
                        className={`btn-ss-small${importingPath === ss.path ? " btn-loading" : ""}`}
                        title={
                          importing && importingPath !== ss.path
                            ? "Another import is in progress"
                            : "Import this screenshot"
                        }
                        disabled={importing}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (importing) return;
                          setImportingPath(ss.path);
                          onImportFile(ss.path);
                        }}
                      >
                        {importingPath === ss.path ? "Importing" : "Import"}
                      </button>
                    )}
                    {debugEnabled && (
                      <button
                        className={`btn-ss-small${debugLoadingFor === ss.name ? " btn-loading" : ""}`}
                        disabled={!!debugLoadingFor}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDebug(ss.name, ss.screenType);
                        }}
                      >
                        {debugLoadingFor === ss.name ? "Debugging" : "Debug"}
                      </button>
                    )}
                    {deleteConfirm === ss.name ? (
                      <>
                        <button
                          className={`btn-ss-small btn-ss-danger${deletingName === ss.name ? " btn-loading" : ""}`}
                          disabled={deletingName === ss.name}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(ss.name);
                          }}
                        >
                          {deletingName === ss.name ? "Deleting" : "Confirm"}
                        </button>
                        <button
                          className="btn-ss-small"
                          disabled={deletingName === ss.name}
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
                    {loadingThumbnail === ss.name && (
                      <div className="ss-history-loading">Loading preview...</div>
                    )}
                    {thumbnailCache[ss.name] && (
                      <div className="ss-item-preview">
                        <img
                          src={thumbnailCache[ss.name]}
                          alt={ss.name}
                          onClick={() => setZoomSrc(thumbnailCache[ss.name])}
                          style={{ cursor: "zoom-in" }}
                        />
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
      {zoomSrc && <ZoomableImageModal src={zoomSrc} alt="Screenshot preview" onClose={() => setZoomSrc(null)} />}
      {(debugLoadingFor || debugData) && (
        <ScreenshotDebugModal
          title="Deep Debug"
          debugData={debugData}
          loading={!!debugLoadingFor}
          onClose={() => {
            setDebugLoadingFor(null);
            setDebugData(null);
          }}
        />
      )}
    </div>
  );
}
