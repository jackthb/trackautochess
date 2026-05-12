interface TabBarProps {
  active: string;
  onChange: (tab: string) => void;
  showConfirmBadge: boolean;
  onPreviewAsUser?: () => void;
}

const TABS = [
  { id: "history", label: "History" },
  { id: "replays", label: "Replays" },
  { id: "confirm", label: "Screenshots" },
  { id: "lab", label: "Lab" },
  { id: "settings", label: "Settings" },
  { id: "log", label: "Log" },
];

export function TabBar({ active, onChange, showConfirmBadge, onPreviewAsUser }: TabBarProps) {
  return (
    <div className="tab-bar">
      {TABS.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${active === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.id === "confirm" && showConfirmBadge && (
            <span className="badge visible" />
          )}
        </div>
      ))}
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
    </div>
  );
}
