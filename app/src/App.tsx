import { useState, useCallback, useRef, useEffect } from "react";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { HistoryTab } from "./components/HistoryTab";
import { ReplaysTab } from "./components/ReplaysTab";
import { ConfirmationTab } from "./components/ConfirmationTab";
import { LabTab } from "./components/LabTab";
import { SettingsTab } from "./components/SettingsTab";
import { LogTab } from "./components/LogTab";
import { LoginScreen } from "./components/LoginScreen";
import { UploadShell } from "./components/UploadShell";
import { NetTableHome } from "./components/NetTableHome";
import { GlobalSearch } from "./components/GlobalSearch";
import { useTrackerEvents } from "./hooks/useTrackerEvents";
import { useGames } from "./hooks/useGames";
import { useDrodo } from "./hooks/useDrodo";
import { useReplays } from "./hooks/useReplays";
import "./styles/app.css";

type TabId =
  | "home"
  | "history"
  | "replays"
  | "confirm"
  | "lab"
  | "settings"
  | "log"
  | "upload";

const ADMIN_PREVIEW_KEY = "dac.adminPreviewAsUser";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [focusGameId, setFocusGameId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [adminPreviewAsUser, setAdminPreviewAsUser] = useState<boolean>(() => {
    const saved = localStorage.getItem(ADMIN_PREVIEW_KEY);
    return saved === null ? true : saved === "true";
  });

  useEffect(() => {
    localStorage.setItem(ADMIN_PREVIEW_KEY, String(adminPreviewAsUser));
  }, [adminPreviewAsUser]);

  const gamesState = useGames();
  const drodoState = useDrodo();
  const replaysState = useReplays();

  const handleImportResult = useCallback(() => {
    gamesState.refresh();
  }, [gamesState.refresh]);

  const tracker = useTrackerEvents(handleImportResult, replaysState.refresh);
  const isAdmin = tracker.status?.admin_mode === true;
  const showLoginScreen = !tracker.status?.logged_in;
  const isUserView = Boolean(
    tracker.status?.logged_in && (!isAdmin || adminPreviewAsUser)
  );

  const hasParseResult = tracker.pendingParseResult !== null;
  const hasProcessingScreenshot = tracker.processingScreenshot !== null;
  const prevHasResult = useRef(false);

  useEffect(() => {
    if ((hasParseResult || hasProcessingScreenshot) && !prevHasResult.current) {
      setActiveTab("confirm");
    }
    prevHasResult.current = hasParseResult || hasProcessingScreenshot;
  }, [hasParseResult, hasProcessingScreenshot]);

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
  }, []);

  const handleViewGame = useCallback((gameId: number) => {
    setFocusGameId(gameId);
    setActiveTab("history");
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
            showConfirmBadge={hasParseResult}
            onPreviewAsUser={isAdmin ? () => setAdminPreviewAsUser(true) : undefined}
          />
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            {activeTab === "home" && (
              <NetTableHome
                status={tracker.status}
                isAdminPreview={isUserView && isAdmin}
                onExitAdminPreview={
                  isAdmin ? () => setAdminPreviewAsUser(false) : undefined
                }
              />
            )}
            {activeTab === "upload" && (
              <UploadShell
                status={tracker.status}
                importing={tracker.importing}
                importProgress={tracker.importProgress}
                lastImportResult={tracker.lastImportResult}
                onBeginImport={tracker.beginImport}
                onClearImportResult={tracker.clearImportResult}
                isAdminPreview={isAdmin && adminPreviewAsUser}
                onExitAdminPreview={
                  isAdmin ? () => setAdminPreviewAsUser(false) : undefined
                }
              />
            )}
            {activeTab === "history" && (
              <HistoryTab
                {...gamesState}
                drodo={drodoState.drodo}
                drodoLoading={drodoState.loading}
                refreshDrodo={drodoState.refresh}
                focusGameId={focusGameId}
                onFocusHandled={() => setFocusGameId(null)}
              />
            )}
            {activeTab === "replays" && (
              <ReplaysTab
                {...replaysState}
                recording={tracker.status?.recording ?? false}
                recordingStats={tracker.status?.recording_stats ?? null}
                games={gamesState.games}
                updateGame={gamesState.updateGame}
                onViewGame={handleViewGame}
              />
            )}
            {activeTab === "confirm" && (
              <ConfirmationTab
                processingScreenshot={tracker.processingScreenshot}
                parseResult={tracker.pendingParseResult}
                onClear={tracker.clearParseResult}
                lastImportResult={tracker.lastImportResult}
                onClearImportResult={tracker.clearImportResult}
                unitCosts={gamesState.unitCosts}
                unitsFull={gamesState.unitsFull}
                synergiesData={gamesState.synergiesData}
                relicsData={gamesState.relicsData}
                importing={tracker.importing}
                onBeginImport={tracker.beginImport}
              />
            )}
            {activeTab === "lab" && <LabTab />}
            {activeTab === "settings" && (
              <SettingsTab
                status={tracker.status}
                replayStats={replaysState.stats}
              />
            )}
            {activeTab === "log" && <LogTab entries={tracker.logEntries} />}
          </div>
          <StatusBar status={tracker.status} />
          <GlobalSearch
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            unitsFull={gamesState.unitsFull}
            unitCosts={gamesState.unitCosts}
            synergiesData={gamesState.synergiesData}
            relicsData={gamesState.relicsData}
            itemsData={gamesState.itemsData}
            talentsData={gamesState.talentsData}
          />
        </>
      )}
    </>
  );
}
