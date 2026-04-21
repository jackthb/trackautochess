import { useState, useEffect, useCallback } from "react";
import { ScreenshotHistory, ParsedRowEdit } from "./ScreenshotHistory";
import { ZoomableImageModal } from "./ZoomableImageModal";
import { ScreenshotDebugModal } from "./ScreenshotDebugModal";
import type {
  ParseResult,
  ParseResultRow,
  ProcessingScreenshot,
  ScreenshotDebugResult,
  UnitFullInfo,
  SynergyInfo,
  RelicInfo,
} from "../types";
import type { ImportResult } from "../hooks/useTrackerEvents";

interface ConfirmationTabProps {
  processingScreenshot: ProcessingScreenshot | null;
  parseResult: ParseResult | null;
  onClear: () => void;
  lastImportResult: ImportResult | null;
  onClearImportResult: () => void;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  importing: boolean;
  onBeginImport: () => void;
  debugEnabled: boolean;
}

export function ConfirmationTab({
  processingScreenshot,
  parseResult,
  onClear,
  lastImportResult,
  onClearImportResult,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  importing,
  onBeginImport,
  debugEnabled,
}: ConfirmationTabProps) {
  const [checked, setChecked] = useState<boolean[]>([]);
  const [editedRows, setEditedRows] = useState<ParseResultRow[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugData, setDebugData] = useState<ScreenshotDebugResult | null>(null);

  useEffect(() => {
    if (parseResult) {
      setChecked(parseResult.rows.map((r) => !r.is_duplicate));
      setEditedRows([...parseResult.rows]);
    }
  }, [parseResult]);

  // Reset the local confirming flag once the parse result is cleared
  // (which happens on import_result) so a fresh confirmation is enabled.
  useEffect(() => {
    if (!parseResult) setConfirming(false);
  }, [parseResult]);

  const handleImportFile = useCallback((filePath: string) => {
    if (importing) return;
    onBeginImport();
    window.tracker.sendCommand({ cmd: "import_file", path: filePath });
  }, [importing, onBeginImport]);

  const runDebug = useCallback(async () => {
    const screenshotName = parseResult?.screenshot_name || processingScreenshot?.screenshot_name;
    const screenType = parseResult?.screen_type || processingScreenshot?.screen_type || null;
    if (!screenshotName) return;
    setDebugLoading(true);
    setDebugData(null);
    try {
      const data = await window.screenshots.debug(screenshotName, screenType);
      setDebugData(data);
    } finally {
      setDebugLoading(false);
    }
  }, [parseResult, processingScreenshot]);

  if (!parseResult) {
    return (
      <div className="confirm-tab">
        <div className="confirm-container">
          {processingScreenshot && (
            <div className="confirm-processing">
              <div className="confirm-preview">
                {processingScreenshot.screenshot_b64 && (
                  <img
                    src={`data:image/jpeg;base64,${processingScreenshot.screenshot_b64}`}
                    alt="Processing screenshot preview"
                    onClick={() => setZoomSrc(`data:image/jpeg;base64,${processingScreenshot.screenshot_b64}`)}
                    style={{ cursor: "zoom-in" }}
                  />
                )}
                <div className="confirm-preview-info">
                  <h2>{processingScreenshot.message || "Loading screenshot and processing..."}</h2>
                  <p>The screenshot has been captured and we’re parsing it now.</p>
                  {debugEnabled && processingScreenshot.screenshot_name && (
                    <button className="btn-confirm btn-confirm-primary" onClick={runDebug} disabled={debugLoading}>
                      {debugLoading ? "Running Debug" : "Run Deep Debug"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          <ScreenshotHistory
            onImportFile={handleImportFile}
            lastImportResult={lastImportResult}
            onClearImportResult={onClearImportResult}
            unitCosts={unitCosts}
            unitsFull={unitsFull}
            synergiesData={synergiesData}
            relicsData={relicsData}
            importing={importing}
            debugEnabled={debugEnabled}
          />
          {zoomSrc && <ZoomableImageModal src={zoomSrc} alt="Processing screenshot" onClose={() => setZoomSrc(null)} />}
          {(debugLoading || debugData) && (
            <ScreenshotDebugModal
              title="Deep Debug"
              debugData={debugData}
              loading={debugLoading}
              onClose={() => {
                setDebugLoading(false);
                setDebugData(null);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  const { rows, timestamps, screenshot_b64 } = parseResult;
  const checkedCount = checked.filter(Boolean).length;
  const duplicateCount = rows.filter((r) => r.is_duplicate).length;

  const toggleAll = (val: boolean) => {
    setChecked(rows.map(() => val));
  };

  const toggleRow = (idx: number) => {
    setChecked((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  const handleRowSave = async (idx: number, fields: Partial<ParseResultRow>) => {
    setEditedRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...fields };
      return next;
    });
  };

  const handleConfirm = () => {
    const selected: number[] = [];
    checked.forEach((c, i) => {
      if (c) selected.push(i);
    });

    const editPayload: Record<string, Record<string, string | string[]>> = {};
    for (let i = 0; i < rows.length; i++) {
      const orig = rows[i];
      const edited = editedRows[i];
      if (!edited) continue;
      const diff: Record<string, string | string[]> = {};

      if (edited.placement !== orig.placement) diff.placement = edited.placement;
      if (edited.level !== orig.level) diff.level = edited.level;
      if (edited.rank !== orig.rank) diff.rank = edited.rank;
      if (edited.wl !== orig.wl) diff.wl = edited.wl;
      if (edited.synergies !== orig.synergies) diff.synergies = edited.synergies;
      if (edited.relic !== orig.relic) diff.relic = edited.relic;
      if (edited.time_ago !== orig.time_ago) diff.time_ago = edited.time_ago;

      const origUnits = (orig.units || []).join(",");
      const editedUnits = (edited.units || []).join(",");
      if (editedUnits !== origUnits) diff.units = edited.units || [];

      if (Object.keys(diff).length > 0) {
        editPayload[String(i)] = diff;
      }
    }

    setConfirming(true);
    window.tracker.sendCommand({
      cmd: "confirm",
      selected,
      edits: editPayload,
    });
    // Don't call onClear() — the import_result event will clear pendingParseResult
  };

  const handleCancel = () => {
    window.tracker.sendCommand({ cmd: "cancel_confirm" });
    onClear();
  };

  return (
    <div className="confirm-tab">
      <div className="confirm-container">
        <div className="confirm-preview">
          {screenshot_b64 && (
            <img
              src={`data:image/jpeg;base64,${screenshot_b64}`}
              alt="Screenshot preview"
              onClick={() => setZoomSrc(`data:image/jpeg;base64,${screenshot_b64}`)}
              style={{ cursor: "zoom-in" }}
            />
          )}
          <div className="confirm-preview-info">
            <h2>
              {rows.length} rows parsed
              {duplicateCount > 0 && (
                <span className="duplicate-count-badge">
                  {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""}
                </span>
              )}
            </h2>
            <p>Click a row to edit, uncheck to exclude, then Confirm.</p>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={checked.every(Boolean)}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              Select all
            </label>
            {debugEnabled && parseResult.screenshot_name && (
              <button className="btn-confirm btn-confirm-primary" onClick={runDebug} disabled={debugLoading}>
                {debugLoading ? "Running Debug" : "Run Deep Debug"}
              </button>
            )}
          </div>
        </div>

        <div className="confirm-rows">
          {editedRows.map((row, i) => (
            <ParsedRowEdit
              key={i}
              row={row}
              timestamp={timestamps[i] || ""}
              unitCosts={unitCosts}
              unitsFull={unitsFull}
              synergiesData={synergiesData}
              relicsData={relicsData}
              onSave={(fields) => handleRowSave(i, fields)}
              checked={checked[i] ?? true}
              onToggleCheck={() => toggleRow(i)}
            />
          ))}
        </div>

        <div className="confirm-actions">
          <button
            className="btn-confirm btn-confirm-cancel"
            onClick={handleCancel}
            disabled={confirming}
          >
            Cancel
          </button>
          <button
            className={`btn-confirm btn-confirm-primary${confirming ? " btn-loading" : ""}`}
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? "Importing" : `Confirm (${checkedCount})`}
          </button>
        </div>

        <ScreenshotHistory
            onImportFile={handleImportFile}
            lastImportResult={lastImportResult}
            onClearImportResult={onClearImportResult}
            unitCosts={unitCosts}
            unitsFull={unitsFull}
            synergiesData={synergiesData}
            relicsData={relicsData}
            importing={importing}
            debugEnabled={debugEnabled}
          />
        {zoomSrc && <ZoomableImageModal src={zoomSrc} alt="Screenshot preview" onClose={() => setZoomSrc(null)} />}
        {(debugLoading || debugData) && (
          <ScreenshotDebugModal
            title="Deep Debug"
            debugData={debugData}
            loading={debugLoading}
            onClose={() => {
              setDebugLoading(false);
              setDebugData(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
