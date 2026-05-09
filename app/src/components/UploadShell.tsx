import { useCallback, useState } from "react";
import type { TrackerStatus } from "../types";
import type { ImportResult } from "../hooks/useTrackerEvents";

interface UploadShellProps {
  status: TrackerStatus | null;
  importing: boolean;
  lastImportResult: ImportResult | null;
  onBeginImport: () => void;
  onClearImportResult: () => void;
}

type ElectronFile = File & { path?: string };

export function UploadShell({
  status,
  importing,
  lastImportResult,
  onBeginImport,
  onClearImportResult,
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

  return (
    <div className="upload-shell">
      <div className="upload-shell-header">
        <div>
          <div className="upload-eyebrow">DAC Tracker</div>
          <h1>Upload a Game Over screenshot</h1>
        </div>
        <div className="upload-user">
          <span>{status?.steam_name || "Steam user"}</span>
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
          {importing ? "Uploading..." : "Drop your screenshot here"}
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
      </div>

      {(localError || lastImportResult) && (
        <div className={`upload-result ${lastImportResult?.tone || "warning"}`}>
          <div>
            <strong>
              {lastImportResult?.imported ? "Uploaded" : "Not uploaded"}
            </strong>
            <p>{localError || lastImportResult?.message}</p>
          </div>
          {lastImportResult?.profileUrl && (
            <button type="button" className="upload-secondary" onClick={openProfile}>
              Open profile
            </button>
          )}
        </div>
      )}
    </div>
  );
}
