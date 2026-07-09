interface TabBarProps {
  active: string;
  onChange: (tab: string) => void;
  userName?: string;
}

const TABS = [
  { id: "home", label: "Home" },
  { id: "settings", label: "Settings" },
];

export function TabBar({ active, onChange, userName }: TabBarProps) {
  return (
    <div className="tab-bar">
      {TABS.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${active === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </div>
      ))}
      {userName && <div className="tab-bar-user">{userName}</div>}
    </div>
  );
}
