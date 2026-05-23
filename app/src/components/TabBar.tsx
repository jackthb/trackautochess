interface TabBarProps {
  active: string;
  onChange: (tab: string) => void;
  showConfirmBadge: boolean;
  onPreviewAsUser?: () => void;
}

// Single-view simplification: only home/lab/settings/log are surfaced.
// Other entries are parked (commented inline) so reviving them is a one-line uncomment.
const TABS = [
  { id: "home", label: "Home" },
  // { id: "history", label: "History" },        // PARKED — screenshot history
  // { id: "replays", label: "Replays" },        // PARKED — record UI
  // { id: "confirm", label: "Screenshots" },    // PARKED — screenshot UI
  // { id: "lab", label: "Lab" },                // PARKED — lab tools
  { id: "settings", label: "Settings" },
  { id: "log", label: "Log" },
  // { id: "upload", label: "Upload" },          // PARKED — upload flow
];

export function TabBar({ active, onChange, showConfirmBadge, onPreviewAsUser }: TabBarProps) {
  // `showConfirmBadge` / `onPreviewAsUser` are kept on the prop type so the
  // parked admin-preview + screenshot flows revive cleanly. Neither is
  // consumed in the unified view.
  void showConfirmBadge;
  void onPreviewAsUser;
  return (
    <div className="tab-bar">
      {TABS.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${active === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {/* PARKED — confirm-tab badge.
          {tab.id === "confirm" && showConfirmBadge && (
            <span className="badge visible" />
          )}
          */}
        </div>
      ))}
      {/* PARKED — admin "Preview as user" toggle.
      {onPreviewAsUser && (
        <button
          type="button"
          className="tab-bar-view-toggle"
          onClick={onPreviewAsUser}
          title="Switch to the upload-only view that non-admin users see"
        >
          Preview as user
        </button>
      )}
      */}
    </div>
  );
}
