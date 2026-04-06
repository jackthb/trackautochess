interface TabBarProps {
  active: string;
  onChange: (tab: string) => void;
  showConfirmBadge: boolean;
}

const TABS = [
  { id: "history", label: "History" },
  { id: "replays", label: "Replays" },
  { id: "confirm", label: "Screenshots" },
  { id: "settings", label: "Settings" },
  { id: "log", label: "Log" },
];

export function TabBar({ active, onChange, showConfirmBadge }: TabBarProps) {
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
    </div>
  );
}
