import { createPortal } from "react-dom";
import { useEffect } from "react";
import type { ScreenshotDebugResult, ScreenshotDebugRow } from "../types";

interface ScreenshotDebugModalProps {
  title: string;
  debugData: ScreenshotDebugResult | null;
  loading: boolean;
  onClose: () => void;
}

function DebugRow({ row, index }: { row: ScreenshotDebugRow; index: number }) {
  const crops = [
    row.player_crop,
    row.placement_crop,
    row.level_crop,
    row.units_crop,
    row.synergy_crop,
    row.relic_crop,
    row.wl_crop,
    row.rank_crop,
    row.time_crop,
  ].filter(Boolean) as string[];

  return (
    <div className="debug-row-card">
      <div className="debug-row-title">Row {index + 1}</div>
      {row.row_image && <img className="debug-row-main" src={`data:image/jpeg;base64,${row.row_image}`} alt={`Debug row ${index + 1}`} />}
      <div className="debug-row-meta">
        {row.player_name && <span>Player: {row.player_name}</span>}
        {typeof row.db_match === "boolean" && <span>DB Match: {row.db_match ? `yes (${row.matched_user_id})` : "no"}</span>}
        {row.placement && <span>Place: {row.placement}</span>}
        {row.level && <span>Level: {row.level}</span>}
        {row.wl && <span>W-L: {row.wl}</span>}
        {row.rank && <span>Rank: {row.rank}</span>}
      </div>
      {(row.units?.length ?? 0) > 0 && <div className="debug-row-text">Units: {(row.units || []).join(", ")}</div>}
      {row.synergies && <div className="debug-row-text">Synergies: {row.synergies}</div>}
      {row.relic && <div className="debug-row-text">Relics: {row.relic}</div>}
      {crops.length > 0 && (
        <div className="debug-crop-grid">
          {crops.map((crop, idx) => (
            <img key={idx} src={`data:image/jpeg;base64,${crop}`} alt={`Debug crop ${idx + 1}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ScreenshotDebugModal({
  title,
  debugData,
  loading,
  onClose,
}: ScreenshotDebugModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="debug-modal-backdrop" onClick={onClose}>
      <div className="debug-modal" onClick={(e) => e.stopPropagation()}>
        <div className="debug-modal-header">
          <h2>{title}</h2>
          <button className="screenshot-lightbox-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="debug-modal-body">
          {loading && <div className="ss-history-loading">Running deep debug...</div>}
          {!loading && debugData?.error && <div className="ss-history-empty">{debugData.error}</div>}
          {!loading && debugData && !debugData.error && (
            <>
              <div className="debug-summary">
                <span>{debugData.width}×{debugData.height}</span>
                <span>{debugData.screen_type}</span>
                {debugData.aspect_ratio && <span>{debugData.aspect_ratio}</span>}
              </div>
              {!!debugData.crop && (
                <div className="debug-section">
                  <h3>Primary Crop</h3>
                  <img className="debug-primary-image" src={`data:image/jpeg;base64,${debugData.crop}`} alt="Debug crop" />
                </div>
              )}
              {!!debugData.region_crops?.length && (
                <div className="debug-section">
                  <h3>Configured Region Crops</h3>
                  <div className="debug-crop-grid">
                    {debugData.region_crops.map((crop) => (
                      <figure key={crop.name} className="debug-crop-card">
                        <img src={`data:image/jpeg;base64,${crop.image}`} alt={crop.name} />
                        <figcaption>{crop.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              )}
              {!!debugData.results && (
                <div className="debug-section">
                  <h3>Template Matches</h3>
                  {Object.entries(debugData.results).map(([name, result]) => (
                    <div key={name} className="debug-row-text">
                      {name}: {result.score}
                      {result.location ? ` @ ${result.location.join(", ")}` : ""}
                    </div>
                  ))}
                </div>
              )}
              {!!debugData.rows?.length && (
                <div className="debug-section">
                  <h3>Rows</h3>
                  <div className="debug-rows-list">
                    {debugData.rows.map((row, index) => (
                      <DebugRow key={index} row={row} index={index} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
