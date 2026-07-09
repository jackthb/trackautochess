import { useState, useCallback, useRef, useEffect } from "react";
import { capture, identify, reset } from "./lib/posthog";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { SettingsTab } from "./components/SettingsTab";
import { LoginScreen } from "./components/LoginScreen";
import { NetTableHome } from "./components/NetTableHome";
import { GlobalSearch } from "./components/GlobalSearch";
import { FeedbackSurveyButton } from "./components/FeedbackSurveyButton";
import { useTrackerEvents } from "./hooks/useTrackerEvents";
import { useNetTableEvents } from "./hooks/useNetTableEvents";
import { useContentData } from "./hooks/useContentData";
import "./styles/app.css";

type TabId = "home" | "settings";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [searchOpen, setSearchOpen] = useState(false);

  const content = useContentData();
  const netTable = useNetTableEvents();
  const tracker = useTrackerEvents();

  useEffect(() => {
    capture("app_opened");
  }, []);

  const identifiedRef = useRef<string | null>(null);
  const steamId = tracker.status?.steam_id;
  const steamName = tracker.status?.steam_name;
  useEffect(() => {
    if (!steamId) {
      if (identifiedRef.current !== null) {
        identifiedRef.current = null;
        reset();
      }
      return;
    }
    if (identifiedRef.current === steamId) return;
    identifiedRef.current = steamId;
    const nameProps = steamName
      ? { $name: steamName, steam_name: steamName }
      : {};
    void window.appApi
      .getVersion()
      .then((app_version) =>
        identify(steamId, { steam_id: steamId, ...nameProps, app_version }),
      )
      .catch(() => identify(steamId, { steam_id: steamId, ...nameProps }));
  }, [steamId, steamName]);

  const showLoginScreen = !tracker.status?.logged_in;

  useEffect(() => {
    if (showLoginScreen) {
      setSearchOpen(false);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showLoginScreen]);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab as TabId);
    capture("tab_viewed", { tab });
  }, []);

  return (
    <>
      <TitleBar />
      {showLoginScreen ? (
        <LoginScreen
          status={tracker.status}
          authError={tracker.authError}
          onClearAuthError={tracker.clearAuthError}
        />
      ) : (
        <>
          <TabBar
            active={activeTab}
            onChange={handleTabChange}
            userName={steamName ?? undefined}
          />
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            {activeTab === "home" && (
              <NetTableHome
                unitsFull={content.unitsFull}
                synergiesData={content.synergiesData}
                relicsData={content.relicsData}
                itemsFull={content.itemsFull}
                netTable={netTable}
              />
            )}
            {activeTab === "settings" && (
              <SettingsTab status={tracker.status} />
            )}
          </div>
          <StatusBar status={tracker.status} />
          <GlobalSearch
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            unitsFull={content.unitsFull}
            unitCosts={content.unitCosts}
            synergiesData={content.synergiesData}
            relicsData={content.relicsData}
            itemsData={content.itemsData}
            talentsData={content.talentsData}
          />
          <FeedbackSurveyButton status={tracker.status} />
        </>
      )}
    </>
  );
}
