import type { TrackerStatus } from "../types";

interface StatusBarProps {
  status: TrackerStatus | null;
}

export function StatusBar({ status }: StatusBarProps) {
  const update = status?.update;
  if (!update) return null;

  const version = update.version || update.tag || "new version";
  const progress =
    update.state === "downloading" && typeof update.percent === "number"
      ? ` ${Math.round(update.percent)}%`
      : "";
  const errorDetail = update.state === "error" ? update.message?.trim() : "";
  const message =
    update.state === "downloaded"
      ? `Update ${version} is ready.`
      : update.state === "downloading"
        ? `Downloading update ${version}.${progress}`
        : update.state === "error"
          ? `Update check failed${errorDetail ? `: ${errorDetail}` : "."}`
          : `Update ${version} is available.`;

  return (
    <div className="status-bar">
      <span className="status-bar-message" title={errorDetail || undefined}>
        {message}
      </span>
      {update.state === "downloaded" && (
        <button
          className="status-bar-action"
          type="button"
          onClick={() => window.tracker.sendCommand({ cmd: "do_update" })}
        >
          Restart and install
        </button>
      )}
    </div>
  );
}
