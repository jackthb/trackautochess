import { useCallback, useState } from "react";
import type { TrackerStatus } from "../types";
import type { ImportProgress, ImportResult } from "../hooks/useTrackerEvents";

interface UploadShellProps {
  status: TrackerStatus | null;
  importing: boolean;
  importProgress: ImportProgress | null;
  lastImportResult: ImportResult | null;
  onBeginImport: () => void;
  onClearImportResult: () => void;
  isAdminPreview?: boolean;
  onExitAdminPreview?: () => void;
}

type ElectronFile = File & { path?: string };

export function UploadShell({
  status,
  importing,
  importProgress,
  lastImportResult,
  onBeginImport,
  onClearImportResult,
  isAdminPreview,
  onExitAdminPreview,
}: UploadShellProps) {
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submitPath = useCallback((path: string | null | undefined) => {
    if (!path) {
      setLocalError("Use Choose screenshot if drag and drop does not expose a file path.");
      return;
    }
    setLocalError(null);
    onClearImportResult();
    onBeginImport();
    window.tracker.sendCommand({ cmd: "upload_game_over_screenshot", path });
  }, [onBeginImport, onClearImportResult]);

  const chooseScreenshot = useCallback(async () => {
    const path = await window.appApi.openGameOverScreenshotDialog();
    submitPath(path);
  }, [submitPath]);

  const openProfile = useCallback(() => {
    const url = lastImportResult?.profileUrl;
    if (url) void window.appApi.openExternal(url);
  }, [lastImportResult?.profileUrl]);

  const matchUrl = lastImportResult?.matchUrl;
  const openMatch = useCallback(() => {
    if (matchUrl) void window.appApi.openExternal(matchUrl);
  }, [matchUrl]);

  return (
    <div className="upload-shell">
      <div className="upload-shell-header">
        <div>
          <div className="upload-eyebrow">DAC Tracker</div>
          <h1>Upload a Game Over screenshot</h1>
        </div>
        <div className="upload-user-group">
          {isAdminPreview && (
            <button
              type="button"
              className="upload-admin-toggle"
              onClick={openMatch}
              disabled={!matchUrl}
              title={
                matchUrl
                  ? "Open the most recently uploaded match on the website"
                  : "No uploaded match yet — upload a screenshot first"
              }
            >
              Open match ↗
            </button>
          )}
          {isAdminPreview && onExitAdminPreview && (
            <button
              type="button"
              className="upload-admin-toggle"
              onClick={onExitAdminPreview}
              title="Leave preview and return to the full admin view"
            >
              Admin view →
            </button>
          )}
          <div className="upload-user">
            <span>{status?.steam_name || "Steam user"}</span>
          </div>
        </div>
      </div>

      <div
        className={`upload-drop ${dragActive ? "active" : ""} ${importing ? "busy" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          const file = event.dataTransfer.files?.[0] as ElectronFile | undefined;
          submitPath(file?.path);
        }}
      >
        <div className="upload-drop-icon" aria-hidden="true">+</div>
        <div className="upload-drop-title">
          {importing
            ? importProgress?.message || "Uploading..."
            : "Drop your screenshot here"}
        </div>
        <div className="upload-drop-copy">
          Game Over screenshots are parsed locally by the desktop app before upload.
        </div>
        <button
          type="button"
          className="upload-primary"
          onClick={chooseScreenshot}
          disabled={importing}
        >
          Choose screenshot
        </button>
        {importing && (
          <div className="upload-progress">
            <div
              className="upload-progress-track"
              role="progressbar"
              aria-label="Uploading screenshot"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(importProgress?.progress ?? 0)}
            >
              <div
                className="upload-progress-fill"
                style={{ width: `${Math.round(importProgress?.progress ?? 0)}%` }}
              />
            </div>
            <div className="upload-progress-label">
              {Math.round(importProgress?.progress ?? 0)}%
            </div>
          </div>
        )}
      </div>

      {(localError || lastImportResult) && (
        <div className={`upload-result ${lastImportResult?.tone || "warning"}`}>
          <div>
            <strong>
              {lastImportResult?.imported ? "Uploaded" : "Not uploaded"}
            </strong>
            <p>{localError || lastImportResult?.message}</p>
          </div>
          <div className="upload-result-actions">
            {matchUrl && (
              <button type="button" className="upload-secondary" onClick={openMatch}>
                Open match
              </button>
            )}
            {lastImportResult?.profileUrl && (
              <button type="button" className="upload-secondary" onClick={openProfile}>
                Open profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
